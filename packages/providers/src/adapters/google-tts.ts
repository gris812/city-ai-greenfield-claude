/**
 * Google Cloud Text-to-Speech adapter (D-019): the cheap TTS tier. REST `text:synthesize` with an
 * API key (restrict the key to the Text-to-Speech API in the Cloud console), MP3 output.
 *
 * One adapter instance = one voice family, because the price is per family (per 1M characters,
 * benchmark/research/provider_pricing.json, retrieved 2026-09-27):
 *   standard $4 · wavenet $4 · neural2 $16  (monthly free tiers ignored in estimates).
 * `model` is the family name, so metering prices every call at its family's rate.
 *
 * Voice ids are per language ("en-US-Wavenet-F", "ru-RU-Wavenet-C"); the Guide profiles carry
 * candidates per tier and language (`voice.byTier`), pending the D-010 rubric. When a voice is
 * missing for the request's language, only `languageCode` is sent and Google picks its default
 * voice for that language (never a wrong-language voice).
 */
import { audioDurationMs } from '../audio.js';
import { ProviderError } from '../errors.js';
import { httpJson, type FetchLike } from '../http.js';
import type { CallContext, SpeechSynthesizer, SynthesisRequest, SynthesisResult } from '../types.js';

export type GoogleVoiceFamily = 'standard' | 'wavenet' | 'neural2';

export const GOOGLE_TTS_FAMILIES: readonly GoogleVoiceFamily[] = ['standard', 'wavenet', 'neural2'];

const BASE = 'https://texttospeech.googleapis.com/v1';

export interface GoogleTtsOptions {
  apiKey: string;
  family: GoogleVoiceFamily;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
}

/** BCP-47 language code for the API from our locale ("en" → "en-US", "ru" → "ru-RU"). */
export function googleLanguageCode(locale: string): string {
  const l = String(locale).replace('_', '-');
  if (/^[a-z]{2,3}-[A-Za-z]{2}$/.test(l)) return `${l.split('-')[0]!.toLowerCase()}-${l.split('-')[1]!.toUpperCase()}`;
  const lang = l.slice(0, 2).toLowerCase();
  return lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`;
}

/** Voice id → family (by naming convention "xx-XX-Family-X"). */
export function googleVoiceFamily(voice: string): GoogleVoiceFamily | null {
  const m = /^[a-z]{2,3}-[A-Z]{2}-(Standard|Wavenet|Neural2)-[A-Z]$/.exec(voice);
  return m ? (m[1]!.toLowerCase() as GoogleVoiceFamily) : null;
}

export class GoogleCloudSpeechSynthesizer implements SpeechSynthesizer {
  readonly name = 'google_tts';
  readonly defaultVoice = '';
  get model(): string {
    return this.o.family;
  }
  constructor(private readonly o: GoogleTtsOptions) {}

  async synthesize(req: SynthesisRequest, ctx?: CallContext): Promise<SynthesisResult> {
    const t0 = performance.now();
    const languageCode = googleLanguageCode(String(req.locale));
    // Only send a voice name that belongs to this adapter's family and the request's language:
    // a mismatched family would be billed at another price, a mismatched language mispronounces.
    const voiceOk = !!req.voice && googleVoiceFamily(req.voice) === this.o.family && req.voice.toLowerCase().startsWith(languageCode.toLowerCase());
    const body = {
      input: { text: req.text },
      voice: { languageCode, ...(voiceOk ? { name: req.voice } : {}) },
      audioConfig: { audioEncoding: 'MP3', speakingRate: Math.max(0.25, Math.min(4, req.speakingRate || 1)) },
    };
    const res = await httpJson<{ audioContent?: string }>(
      `${this.o.baseUrl ?? BASE}/text:synthesize`,
      { method: 'POST', headers: { 'x-goog-api-key': this.o.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { provider: this.name, timeoutMs: this.o.timeoutMs ?? 15_000, ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) },
    );
    if (!res.audioContent) throw new ProviderError(this.name, 'invalid_response', 'no audio');
    const audio = new Uint8Array(Buffer.from(res.audioContent, 'base64'));
    if (audio.length < 100) throw new ProviderError(this.name, 'invalid_response', 'audio too short');
    return { audio, mime: 'audio/mpeg', durationMs: audioDurationMs(audio, 'audio/mpeg'), ttfbMs: Math.round(performance.now() - t0) };
  }
}

/** GET /v1/voices — for the benchmark script to verify the Guide voice candidates exist (not per request). */
export async function googleTtsListVoices(apiKey: string, languageCode?: string, fetchImpl?: FetchLike): Promise<Array<{ name: string; languageCodes: string[]; ssmlGender: string }>> {
  const q = languageCode ? `?languageCode=${encodeURIComponent(languageCode)}` : '';
  const res = await httpJson<{ voices?: Array<{ name: string; languageCodes: string[]; ssmlGender: string }> }>(`${BASE}/voices${q}`, { headers: { 'x-goog-api-key': apiKey } }, { provider: 'google_tts', timeoutMs: 10_000, ...(fetchImpl ? { fetchImpl } : {}) });
  return res.voices ?? [];
}
