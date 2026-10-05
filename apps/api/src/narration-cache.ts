/**
 * Shared story-body cache (D-018). Stores the grounded prose of a context-free story body under
 * its deterministic body key (core `storyBodyKey`: place, angle, facts, Guide, language, mode,
 * question policy, budget bucket, primitive version). The segment audio of that prose is already
 * shared through the content-addressed AudioStore (same text + voice → same file), so a hit
 * skips the LLM entirely and usually the body TTS too.
 *
 * Why this cannot leak user data across users: neither the key nor the value is derived from
 * anything session-specific. The body brief that produced the prose has no session id, time,
 * position, spatial cue, journey callback or user utterance (core `buildStoryParts`), and the
 * LLM input for a body is exactly (system prompt of the Guide, body prompt of that brief) — both
 * pure functions of the key. Session-specific speech (the spatial cue and journey callbacks) is
 * the template-built prefix, which is never cached as prose. Only LLM output that passed
 * GroundingCheck against the body brief is stored; template fallbacks are not (a temporary LLM
 * outage must not pin the template for the TTL).
 *
 * Storage: Redis via the KV layer (in-process LRU when Redis is down, F5), TTL 30 days. Concurrent
 * requests for the same key share one generation (in-flight de-duplication).
 */
import type { GroundingResult, NarrativePlan } from '@city/core';
import type { KV } from './kv.js';
import type { Telemetry } from './telemetry.js';

export const NARRATION_TTL_S = 30 * 24 * 3600;

export interface CachedBody {
  text: string;
  generatedBy: NarrativePlan['generatedBy'];
  grounding: GroundingResult;
  /** 'hit' = served from the shared cache (no LLM call); 'miss' = generated now. */
  source: 'hit' | 'miss';
  fallbackReason: string | null;
  usage?: { inputTokens: number; outputTokens: number };
}

export class NarrationCache {
  stats = { hits: 0, misses: 0, writes: 0, notCached: 0, inflightJoins: 0 };
  private inflight = new Map<string, Promise<CachedBody>>();

  constructor(
    private readonly kv: KV,
    private readonly telemetry: Telemetry,
    private readonly ttlS = NARRATION_TTL_S,
  ) {}

  static key(bodyKey: string): string {
    return `nb:v1:${bodyKey}`;
  }

  private record(sessionId: string | null, hit: boolean): void {
    this.telemetry.record({ sessionId, provider: 'cache', model: null, category: 'llm', task: 'narration_body', units: { requests: 0 }, costUsd: 0, latencyMs: 0, cacheHit: hit, ok: true, at: Date.now() });
  }

  async get(bodyKey: string): Promise<Omit<CachedBody, 'source'> | null> {
    try {
      const raw = await this.kv.get(NarrationCache.key(bodyKey));
      if (!raw) return null;
      const v = JSON.parse(raw) as Omit<CachedBody, 'source'>;
      return typeof v.text === 'string' && v.text.length > 0 ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Cached body for `bodyKey`, or generate it (once per key concurrently) and store it when it is
   * grounded LLM prose.
   */
  async getOrGenerate(bodyKey: string, sessionId: string | null, generate: () => Promise<Omit<CachedBody, 'source'>>): Promise<CachedBody> {
    const cached = await this.get(bodyKey);
    if (cached) {
      this.stats.hits++;
      this.record(sessionId, true);
      return { ...cached, source: 'hit' };
    }
    const running = this.inflight.get(bodyKey);
    if (running) {
      this.stats.inflightJoins++;
      return running;
    }
    this.stats.misses++;
    this.record(sessionId, false);
    const job = (async (): Promise<CachedBody> => {
      const g = await generate();
      if (g.generatedBy.kind === 'llm' && g.grounding.ok) {
        try {
          await this.kv.set(NarrationCache.key(bodyKey), JSON.stringify({ text: g.text, generatedBy: g.generatedBy, grounding: g.grounding, fallbackReason: null }), this.ttlS);
          this.stats.writes++;
        } catch {
          /* best effort */
        }
      } else this.stats.notCached++;
      return { ...g, source: 'miss' };
    })().finally(() => this.inflight.delete(bodyKey));
    this.inflight.set(bodyKey, job);
    return job;
  }
}
