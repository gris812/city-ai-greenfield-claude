/**
 * OpenAI adapters (fetch-based, no SDK): Chat Completions for prose + intent (JSON schema),
 * /v1/audio/speech (mp3), /v1/audio/transcriptions, Realtime client secrets.
 *
 * Model ids come from env (see config.ts) — the research found conflicting flagship names
 * across OpenAI pages, so defaults are provisional and verified by the benchmark script via
 * `listModels()` (never at request time).
 */
import { ProviderError } from '../errors.js';
import { httpBytes, httpJson, httpRequest, sseEvents, type FetchLike } from '../http.js';
import { audioDurationMs } from '../audio.js';
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

const BASE = 'https://api.openai.com/v1';

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
  /** Optional `reasoning_effort` for reasoning models (e.g. 'minimal'). */
  reasoningEffort?: string;
}

function http(o: OpenAIOptions, provider: string, ctx?: CallContext, timeoutMs?: number) {
  return { provider, timeoutMs: timeoutMs ?? o.timeoutMs ?? 15_000, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) };
}

export class OpenAITextGenerator implements TextGenerator {
  readonly name = 'openai';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: OpenAIOptions) {}

  async generate(req: GenerateRequest, ctx?: CallContext): Promise<GenerateResult> {
    const body: Record<string, unknown> = {
      model: this.o.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      max_completion_tokens: req.maxOutputTokens,
      ...(this.o.reasoningEffort ? { reasoning_effort: this.o.reasoningEffort } : {}),
      ...(req.json ? { response_format: { type: 'json_schema', json_schema: { name: req.json.name, schema: req.json.schema, strict: true } } } : {}),
    };
    if (req.onDelta) return this.stream(body, req.onDelta, ctx);
    const res = await httpJson<{
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      model?: string;
    }>(`${this.o.baseUrl ?? BASE}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${this.o.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, http(this.o, this.name, ctx));
    const text = res.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim() === '') throw new ProviderError(this.name, 'invalid_response', 'empty completion');
    return {
      text,
      model: res.model ?? this.o.model,
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0, cachedInputTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0 },
    };
  }

  /** Chat Completions SSE (D-020): `stream: true` + `include_usage` for metering. */
  private async stream(body: Record<string, unknown>, onDelta: (d: string) => void, ctx?: CallContext): Promise<GenerateResult> {
    const res = await httpRequest(
      `${this.o.baseUrl ?? BASE}/chat/completions`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.o.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }) },
      http(this.o, this.name, ctx),
    );
    let text = '';
    let model = this.o.model;
    let usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    for await (const e of sseEvents(res, this.name)) {
      if (e.data === '[DONE]') break;
      let j: { choices?: Array<{ delta?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null; model?: string };
      try {
        j = JSON.parse(e.data);
      } catch {
        continue;
      }
      if (j.model) model = j.model;
      const d = j.choices?.[0]?.delta?.content;
      if (typeof d === 'string' && d.length > 0) {
        text += d;
        onDelta(d);
      }
      if (j.usage) usage = { inputTokens: j.usage.prompt_tokens ?? 0, outputTokens: j.usage.completion_tokens ?? 0, cachedInputTokens: j.usage.prompt_tokens_details?.cached_tokens ?? 0 };
    }
    if (text.trim() === '') throw new ProviderError(this.name, 'invalid_response', 'empty completion');
    return { text, model, usage };
  }
}

export class OpenAISpeechSynthesizer implements SpeechSynthesizer {
  readonly name = 'openai';
  readonly defaultVoice = 'alloy';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: OpenAIOptions) {}

  async synthesize(req: SynthesisRequest, ctx?: CallContext): Promise<SynthesisResult> {
    const supportsInstructions = !/^tts-1/.test(this.o.model);
    const body: Record<string, unknown> = {
      model: this.o.model,
      voice: req.voice || this.defaultVoice,
      input: req.text,
      response_format: 'mp3',
      ...(Math.abs(req.speakingRate - 1) > 0.01 ? { speed: Math.max(0.25, Math.min(4, req.speakingRate)) } : {}),
      ...(supportsInstructions && req.instructions ? { instructions: req.instructions } : {}),
    };
    const r = await httpBytes(`${this.o.baseUrl ?? BASE}/audio/speech`, { method: 'POST', headers: { Authorization: `Bearer ${this.o.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, http(this.o, this.name, ctx, this.o.timeoutMs ?? 20_000));
    if (r.bytes.length < 100) throw new ProviderError(this.name, 'invalid_response', 'audio too short');
    return { audio: r.bytes, mime: 'audio/mpeg', durationMs: audioDurationMs(r.bytes, 'audio/mpeg'), ttfbMs: Math.round(r.ttfbMs) };
  }
}

export class OpenAISpeechRecognizer implements SpeechRecognizer {
  readonly name = 'openai';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: OpenAIOptions) {}

  async transcribe(req: TranscriptionRequest, ctx?: CallContext): Promise<TranscriptionResult> {
    const form = new FormData();
    const ext = req.mime.includes('wav') ? 'wav' : req.mime.includes('mp4') || req.mime.includes('m4a') ? 'm4a' : req.mime.includes('ogg') ? 'ogg' : req.mime.includes('mpeg') ? 'mp3' : 'webm';
    form.append('file', new Blob([new Uint8Array(req.audio)], { type: req.mime }), `utterance.${ext}`);
    form.append('model', this.o.model);
    form.append('language', String(req.locale).slice(0, 2));
    form.append('response_format', 'json');
    const res = await httpJson<{ text?: string; usage?: { seconds?: number } }>(`${this.o.baseUrl ?? BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${this.o.apiKey}` }, body: form }, http(this.o, this.name, ctx, this.o.timeoutMs ?? 15_000));
    if (typeof res.text !== 'string') throw new ProviderError(this.name, 'invalid_response', 'no transcript');
    return { text: res.text.trim(), durationS: res.usage?.seconds ?? req.durationS ?? 0 };
  }
}

export class OpenAIRealtimeTokenIssuer implements RealtimeTokenIssuer {
  readonly name = 'openai';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: OpenAIOptions) {}

  async issue(req: RealtimeTokenRequest, ctx?: CallContext): Promise<RealtimeToken> {
    const ttl = Math.max(10, Math.min(600, Math.round(req.maxSeconds)));
    const body = {
      expires_after: { anchor: 'created_at', seconds: ttl },
      session: {
        type: 'realtime',
        model: this.o.model,
        instructions: req.instructions,
        audio: {
          output: { voice: req.voice },
          input: { turn_detection: { type: 'server_vad', idle_timeout_ms: Math.round(req.idleTimeoutS * 1000) } },
        },
      },
    };
    const res = await httpJson<{ value?: string; expires_at?: number }>(`${this.o.baseUrl ?? BASE}/realtime/client_secrets`, { method: 'POST', headers: { Authorization: `Bearer ${this.o.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, http(this.o, this.name, ctx, 8000));
    if (!res.value) throw new ProviderError(this.name, 'invalid_response', 'no client secret');
    return {
      provider: this.name,
      model: this.o.model,
      clientSecret: res.value,
      expiresAt: (res.expires_at ?? Math.floor(Date.now() / 1000) + ttl) * 1000,
      maxSeconds: req.maxSeconds,
      idleTimeoutS: req.idleTimeoutS,
      connectUrl: `${this.o.baseUrl ?? BASE}/realtime/calls`,
    };
  }
}

/** GET /v1/models — used by the benchmark script to verify configured model ids (not per request). */
export async function openaiListModels(apiKey: string, fetchImpl?: FetchLike): Promise<string[]> {
  const res = await httpJson<{ data?: Array<{ id: string }> }>(`${BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }, { provider: 'openai', timeoutMs: 10_000, ...(fetchImpl ? { fetchImpl } : {}) });
  return (res.data ?? []).map((m) => m.id).sort();
}
