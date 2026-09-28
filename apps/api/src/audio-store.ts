/**
 * Content-addressed TTS audio (D-009, D-011). Key = sha256(segment hash + provider + model +
 * voice). Files live on a local volume behind /v1/audio/:key.:ext (immutable). Synthesis is
 * de-duplicated in flight, so the `play` directive can list every segment URL immediately
 * while segments 1..n are still being synthesized (pipelined TTS): the audio route awaits
 * the in-flight job. A failed segment returns 404 → the client speaks the segment text with
 * on-device TTS (F4: text is always in the directive).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GuideProfile, Locale } from '@city/core';
import type { CallContext, ProviderRouter, SpeechSynthesizer } from '@city/providers';
import type { Telemetry } from './telemetry.js';

export interface AudioRef {
  key: string;
  url: string;
  ext: 'mp3' | 'wav';
}

export interface AudioJobResult {
  ok: boolean;
  durationMs: number;
  cached: boolean;
  provider: string | null;
}

interface Meta {
  mime: string;
  durationMs: number;
  provider: string;
  model: string | null;
}

export class AudioStore {
  private inflight = new Map<string, Promise<AudioJobResult>>();
  /** Fallback-provider audio is served from memory only (never cached under the planned key). */
  private volatile = new Map<string, { bytes: Uint8Array; meta: Meta; at: number }>();
  private ready: Promise<void>;
  stats = { hits: 0, misses: 0, failures: 0 };

  constructor(
    private readonly dir: string,
    private readonly router: ProviderRouter,
    private readonly telemetry: Telemetry,
    private readonly baseUrl = '/v1/audio',
  ) {
    this.ready = mkdir(dir, { recursive: true }).then(() => undefined);
  }

  refFor(segmentHash: string, provider: SpeechSynthesizer | null, guide: GuideProfile): AudioRef | null {
    if (!provider) return null;
    const voice = this.router.voiceFor(provider, guide);
    const key = createHash('sha256').update(`${segmentHash}|${provider.name}|${provider.model ?? ''}|${voice}`).digest('hex').slice(0, 40);
    const ext = provider.name === 'gemini' ? 'wav' : 'mp3';
    return { key, ext, url: `${this.baseUrl}/${key}.${ext}` };
  }

  private path(key: string): string {
    return join(this.dir, key.slice(0, 2), key);
  }

  private async exists(key: string): Promise<Meta | null> {
    try {
      await stat(this.path(key) + '.bin');
      return JSON.parse(await readFile(this.path(key) + '.json', 'utf8')) as Meta;
    } catch {
      return null;
    }
  }

  /** Ensure audio for `ref` exists (synthesizing at most once concurrently). Never throws. */
  ensure(ref: AudioRef, text: string, guide: GuideProfile, locale: Locale, provider: SpeechSynthesizer, ctx: CallContext): Promise<AudioJobResult> {
    const existing = this.inflight.get(ref.key);
    if (existing) return existing;
    const job = this.run(ref, text, guide, locale, provider, ctx).finally(() => this.inflight.delete(ref.key));
    this.inflight.set(ref.key, job);
    return job;
  }

  private async run(ref: AudioRef, text: string, guide: GuideProfile, locale: Locale, provider: SpeechSynthesizer, ctx: CallContext): Promise<AudioJobResult> {
    await this.ready;
    const hit = await this.exists(ref.key);
    if (hit) {
      this.stats.hits++;
      this.telemetry.record({ sessionId: ctx.sessionId, provider: hit.provider, model: hit.model, category: 'tts', task: 'tts_segment', units: { characters: 0 }, costUsd: 0, latencyMs: 0, cacheHit: true, ok: true, at: Date.now() });
      return { ok: true, durationMs: hit.durationMs, cached: true, provider: hit.provider };
    }
    this.stats.misses++;
    try {
      const { result, provider: used } = await this.router.synthesize({ text, locale, speakingRate: guide.voice.speakingRate, instructions: guide.voice.description }, guide, ctx, provider);
      const meta: Meta = { mime: result.mime, durationMs: result.durationMs, provider: used.name, model: used.model };
      if (used !== provider) {
        this.volatile.set(ref.key, { bytes: result.audio, meta, at: Date.now() });
        this.pruneVolatile();
      } else {
        const p = this.path(ref.key);
        await mkdir(join(this.dir, ref.key.slice(0, 2)), { recursive: true });
        const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, result.audio);
        await rename(tmp, p + '.bin');
        await writeFile(p + '.json', JSON.stringify(meta));
      }
      return { ok: true, durationMs: result.durationMs, cached: false, provider: used.name };
    } catch {
      this.stats.failures++;
      return { ok: false, durationMs: 0, cached: false, provider: null };
    }
  }

  private pruneVolatile(): void {
    const cutoff = Date.now() - 3600_000;
    for (const [k, v] of this.volatile) if (v.at < cutoff || this.volatile.size > 500) this.volatile.delete(k);
  }

  /** Read audio for serving; waits (bounded) for an in-flight synthesis of the same key. */
  async read(key: string, waitMs = 15_000): Promise<{ bytes: Uint8Array; mime: string } | null> {
    if (!/^[a-f0-9]{40}$/.test(key)) return null;
    const job = this.inflight.get(key);
    if (job) await Promise.race([job, new Promise((r) => setTimeout(r, waitMs))]);
    const v = this.volatile.get(key);
    if (v) return { bytes: v.bytes, mime: v.meta.mime };
    const meta = await this.exists(key);
    if (!meta) return null;
    return { bytes: new Uint8Array(await readFile(this.path(key) + '.bin')), mime: meta.mime };
  }
}
