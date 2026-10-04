/**
 * Google Gemini API adapters (fetch-based): generateContent for prose + intent (JSON schema),
 * Gemini TTS (PCM → WAV), audio transcription via generateContent, and Live API ephemeral
 * tokens (v1alpha auth_tokens). Model ids are env-configurable; Flash/TTS promo prices double
 * on 2027-01-01 (pricing.ts handles the switch).
 */
import { ProviderError } from '../errors.js';
import { httpJson, httpRequest, sseEvents, type FetchLike } from '../http.js';
import { pcm16ToWav, wavDurationMs } from '../audio.js';
import type {
  CallContext,
  GenerateRequest,
  GenerateResult,
  RealtimeToken,
  RealtimeTokenIssuer,
  RealtimeTokenRequest,
  SpeechRecognizer,
  SpeechSynthesizer,
  SynthesisRequest,
  SynthesisResult,
  TextGenerator,
  TranscriptionRequest,
  TranscriptionResult,
} from '../types.js';

const BASE = 'https://generativelanguage.googleapis.com';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

interface GenResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  modelVersion?: string;
}

function http(o: GeminiOptions, ctx?: CallContext, timeoutMs?: number) {
  return { provider: 'gemini', timeoutMs: timeoutMs ?? o.timeoutMs ?? 15_000, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) };
}

async function generateContent(o: GeminiOptions, body: unknown, ctx?: CallContext, timeoutMs?: number): Promise<GenResponse> {
  return httpJson<GenResponse>(
    `${BASE}/v1beta/models/${encodeURIComponent(o.model)}:generateContent`,
    { method: 'POST', headers: { 'x-goog-api-key': o.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    http(o, ctx, timeoutMs),
  );
}

export class GeminiTextGenerator implements TextGenerator {
  readonly name = 'gemini';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: GeminiOptions) {}

  async generate(req: GenerateRequest, ctx?: CallContext): Promise<GenerateResult> {
    const payload = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.json ? { responseMimeType: 'application/json', responseJsonSchema: req.json.schema } : {}),
      },
    };
    if (req.onDelta) return this.stream(payload, req.onDelta, ctx);
    const res = await generateContent(this.o, payload, ctx);
    const text = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text.trim()) throw new ProviderError(this.name, 'invalid_response', `empty completion (${res.candidates?.[0]?.finishReason ?? 'no candidate'})`);
    return {
      text,
      model: res.modelVersion ?? this.o.model,
      usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0, cachedInputTokens: res.usageMetadata?.cachedContentTokenCount ?? 0 },
    };
  }

  /** streamGenerateContent with `alt=sse` (D-020); the last chunk carries usageMetadata. */
  private async stream(payload: unknown, onDelta: (d: string) => void, ctx?: CallContext): Promise<GenerateResult> {
    const res = await httpRequest(
      `${BASE}/v1beta/models/${encodeURIComponent(this.o.model)}:streamGenerateContent?alt=sse`,
      { method: 'POST', headers: { 'x-goog-api-key': this.o.apiKey, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(payload) },
      http(this.o, ctx),
    );
    let text = '';
    let model = this.o.model;
    let usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    for await (const e of sseEvents(res, this.name)) {
      let j: GenResponse;
      try {
        j = JSON.parse(e.data) as GenResponse;
      } catch {
        continue;
      }
      if (j.modelVersion) model = j.modelVersion;
      const d = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (d) {
        text += d;
        onDelta(d);
      }
      if (j.usageMetadata) usage = { inputTokens: j.usageMetadata.promptTokenCount ?? 0, outputTokens: j.usageMetadata.candidatesTokenCount ?? 0, cachedInputTokens: j.usageMetadata.cachedContentTokenCount ?? 0 };
    }
    if (!text.trim()) throw new ProviderError(this.name, 'invalid_response', 'empty completion');
    return { text, model, usage };
  }
}

export class GeminiSpeechSynthesizer implements SpeechSynthesizer {
  readonly name = 'gemini';
  readonly defaultVoice = 'Kore';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: GeminiOptions) {}

  async synthesize(req: SynthesisRequest, ctx?: CallContext): Promise<SynthesisResult> {
    const t0 = performance.now();
    const prompt = req.instructions ? `${req.instructions}\n\n${req.text}` : req.text;
    const res = await generateContent(
      this.o,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice || this.defaultVoice } } } },
      },
      ctx,
      this.o.timeoutMs ?? 25_000,
    );
    const inline = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new ProviderError(this.name, 'invalid_response', 'no audio');
    const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1] ?? 24000);
    const wav = pcm16ToWav(new Uint8Array(Buffer.from(inline.data, 'base64')), rate);
    return { audio: wav, mime: 'audio/wav', durationMs: wavDurationMs(wav), ttfbMs: Math.round(performance.now() - t0) };
  }
}

export class GeminiSpeechRecognizer implements SpeechRecognizer {
  readonly name = 'gemini';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: GeminiOptions) {}

  async transcribe(req: TranscriptionRequest, ctx?: CallContext): Promise<TranscriptionResult> {
    const res = await generateContent(
      this.o,
      {
        contents: [
          {
            parts: [
              { text: `Transcribe this short spoken request verbatim (language: ${req.locale}). Output only the transcript.` },
              { inlineData: { mimeType: req.mime, data: Buffer.from(req.audio).toString('base64') } },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 200, temperature: 0 },
      },
      ctx,
    );
    const text = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
    return { text, durationS: req.durationS ?? 0 };
  }
}

export class GeminiLiveTokenIssuer implements RealtimeTokenIssuer {
  readonly name = 'gemini';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: GeminiOptions) {}

  async issue(req: RealtimeTokenRequest, ctx?: CallContext): Promise<RealtimeToken> {
    const now = Date.now();
    const expire = new Date(now + Math.min(30 * 60, req.maxSeconds + 60) * 1000).toISOString();
    const newSession = new Date(now + 60_000).toISOString();
    const res = await httpJson<{ name?: string }>(
      `${BASE}/v1alpha/auth_tokens`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': this.o.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uses: 1,
          expireTime: expire,
          newSessionExpireTime: newSession,
          liveConnectConstraints: {
            model: `models/${this.o.model}`,
            config: {
              responseModalities: ['AUDIO'],
              systemInstruction: { parts: [{ text: req.instructions }] },
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice } } },
            },
          },
        }),
      },
      http(this.o, ctx, 8000),
    );
    if (!res.name) throw new ProviderError(this.name, 'invalid_response', 'no token');
    return {
      provider: this.name,
      model: this.o.model,
      clientSecret: res.name,
      expiresAt: Date.parse(expire),
      maxSeconds: req.maxSeconds,
      idleTimeoutS: req.idleTimeoutS,
      connectUrl: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained',
    };
  }
}

export async function geminiListModels(apiKey: string, fetchImpl?: FetchLike): Promise<string[]> {
  const res = await httpJson<{ models?: Array<{ name: string }> }>(`${BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }, { provider: 'gemini', timeoutMs: 10_000, ...(fetchImpl ? { fetchImpl } : {}) });
  return (res.models ?? []).map((m) => m.name.replace(/^models\//, '')).sort();
}
