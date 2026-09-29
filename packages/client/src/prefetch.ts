/**
 * Segment prefetch (D-002 degraded mode, E3): the client keeps a bounded prefetch of
 * already-decided audio segments so playback survives short connectivity drops. It never
 * decides *what* to play — only downloads segments of a `play` directive it already has.
 *
 * Audio URLs are content-addressed (`/v1/audio/<hash>.mp3`, immutable), so a URL is a safe
 * cache key. The downloader is injected (expo-file-system on mobile; fakes in tests).
 */

export interface SegmentRef {
  index: number;
  url: string | null;
}

/** Which URLs to have locally, in priority order: the current segment, then the next `lookahead`. */
export function planPrefetch(segments: SegmentRef[], currentIndex: number, lookahead = 2): string[] {
  const out: string[] = [];
  const sorted = [...segments].sort((a, b) => a.index - b.index);
  for (const s of sorted) {
    if (s.index < currentIndex || s.index > currentIndex + lookahead) continue;
    if (s.url && !out.includes(s.url)) out.push(s.url);
  }
  return out;
}

export type PrefetchState = 'queued' | 'downloading' | 'ready' | 'failed';

interface Entry {
  url: string;
  state: PrefetchState;
  local: string | null;
  lastUsed: number;
  attempts: number;
  waiters: Array<(local: string | null) => void>;
}

export interface PrefetchDeps {
  download(url: string): Promise<string>;
  remove?(local: string): void;
  now?: () => number;
}

export interface PrefetchOptions {
  lookahead: number;
  maxEntries: number;
  concurrency: number;
  maxAttempts: number;
}

export class PrefetchQueue {
  private entries = new Map<string, Entry>();
  private queue: string[] = [];
  private active = 0;
  private pinned = new Set<string>();
  readonly opts: PrefetchOptions;

  constructor(
    private readonly deps: PrefetchDeps,
    opts: Partial<PrefetchOptions> = {},
  ) {
    this.opts = { lookahead: 2, maxEntries: 24, concurrency: 2, maxAttempts: 2, ...opts };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Re-plan for the current position of a plan; enqueues what is missing, highest priority first. */
  update(segments: SegmentRef[], currentIndex: number): string[] {
    const want = planPrefetch(segments, currentIndex, this.opts.lookahead);
    this.pinned = new Set(want);
    // Priority: drop queued items no longer wanted, then put wanted ones first in order.
    this.queue = this.queue.filter((u) => want.includes(u));
    for (const url of want) {
      const e = this.entries.get(url);
      if (e && (e.state === 'ready' || e.state === 'downloading')) continue;
      if (e && e.state === 'failed' && e.attempts >= this.opts.maxAttempts) continue;
      if (!e) this.entries.set(url, { url, state: 'queued', local: null, lastUsed: this.now(), attempts: 0, waiters: [] });
      else e.state = 'queued';
      if (!this.queue.includes(url)) this.queue.push(url);
    }
    this.queue.sort((a, b) => want.indexOf(a) - want.indexOf(b));
    this.pump();
    return want;
  }

  private pump(): void {
    while (this.active < this.opts.concurrency && this.queue.length > 0) {
      const url = this.queue.shift()!;
      const e = this.entries.get(url);
      if (!e || e.state !== 'queued') continue;
      e.state = 'downloading';
      e.attempts++;
      this.active++;
      this.deps
        .download(url)
        .then((local) => {
          e.state = 'ready';
          e.local = local;
          e.lastUsed = this.now();
          for (const w of e.waiters.splice(0)) w(local);
        })
        .catch(() => {
          e.state = 'failed';
          for (const w of e.waiters.splice(0)) w(null);
        })
        .finally(() => {
          this.active--;
          this.evict();
          this.pump();
        });
    }
  }

  private evict(): void {
    const ready = [...this.entries.values()].filter((e) => e.state === 'ready' || e.state === 'failed');
    if (this.entries.size <= this.opts.maxEntries) return;
    ready.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of ready) {
      if (this.entries.size <= this.opts.maxEntries) break;
      if (this.pinned.has(e.url)) continue;
      this.entries.delete(e.url);
      if (e.local) this.deps.remove?.(e.local);
    }
  }

  state(url: string): PrefetchState | null {
    return this.entries.get(url)?.state ?? null;
  }

  /** Local URI when prefetched, else the remote URL (stream it). */
  resolve(url: string): string {
    const e = this.entries.get(url);
    if (e?.state === 'ready' && e.local) {
      e.lastUsed = this.now();
      return e.local;
    }
    return url;
  }

  /**
   * Wait (bounded) for a segment that is downloading. Resolves to the local URI, or null when it
   * failed / timed out — the caller then streams or falls back to on-device TTS (F4).
   */
  whenReady(url: string, timeoutMs: number): Promise<string | null> {
    const e = this.entries.get(url);
    if (!e) return Promise.resolve(null);
    if (e.state === 'ready') return Promise.resolve(this.resolve(url));
    if (e.state === 'failed') return Promise.resolve(null);
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs);
      e.waiters.push((local) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(local);
      });
    });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    for (const e of this.entries.values()) {
      for (const w of e.waiters.splice(0)) w(null);
      if (e.local) this.deps.remove?.(e.local);
    }
    this.entries.clear();
    this.queue = [];
    this.pinned.clear();
  }
}
