/**
 * Segment player for `play` / `say` directives.
 *  - audioUrl present → HTMLAudioElement (server TTS, content-addressed, cacheable by the SW);
 *  - audioUrl null → device speechSynthesis (degraded, labelled in the UI);
 *  - no usable voice → text-only timer so the story still advances (F4: text stays available).
 * Barge-in: `stop()` halts output immediately and resolves with the measured stop latency.
 */
import type { Directive } from '@city/core';
import { resolveAudioUrl } from '../api';

export type AudioMode = 'server' | 'device' | 'text';
type PlayDirective = Extract<Directive, { type: 'play' }>;

export interface PlayerEvents {
  progress(p: { planId: string; segmentIndex: number; offsetMs: number; state: 'playing' | 'finished' | 'stopped' }): void;
  segment(planId: string, index: number, mode: AudioMode): void;
  sayStart(text: string, mode: AudioMode): void;
  sayEnd(): void;
}

export interface PlayerOptions {
  voiceEnabled: boolean;
  lang: string;
  rate: number;
  pitch: number;
}

function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (!speechAvailable()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const l = lang.toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === l) ?? voices.find((v) => v.lang.toLowerCase().startsWith(l.slice(0, 2))) ?? null;
}

export class SegmentPlayer {
  private gen = 0;
  private audio: HTMLAudioElement | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private current: { planId: string; index: number; startedAt: number; durationMs: number } | null = null;
  private lastReport = 0;
  /** Queue of the current say and its appended sentences (D-020). */
  private sayChain: Promise<void> | null = null;
  private sayGen = -1;
  opts: PlayerOptions = { voiceEnabled: true, lang: 'en-US', rate: 1, pitch: 1 };

  constructor(private readonly ev: PlayerEvents) {
    if (speechAvailable()) window.speechSynthesis.getVoices(); // warm the voice list
  }

  get state(): { planId: string; segmentIndex: number; offsetMs: number; playing: boolean } | null {
    if (!this.current) return null;
    return { planId: this.current.planId, segmentIndex: this.current.index, offsetMs: Math.max(0, Math.round(performance.now() - this.current.startedAt)), playing: true };
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  private haltOutput(): void {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
    }
    if (speechAvailable()) window.speechSynthesis.cancel();
  }

  /** Speak one chunk with the best available output. Resolves when done (or superseded). */
  private speak(text: string, audioUrl: string | null, estMs: number, gen: number, onMode: (m: AudioMode) => void): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const watchdog = (ms: number) => this.timers.push(setTimeout(finish, ms));
      const url = resolveAudioUrl(audioUrl);
      const viaSpeech = () => {
        const voice = this.opts.voiceEnabled ? pickVoice(this.opts.lang) : null;
        if (!voice) {
          onMode('text');
          watchdog(Math.max(1200, estMs));
          return;
        }
        onMode('device');
        const u = new SpeechSynthesisUtterance(text);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = this.opts.rate;
        u.pitch = this.opts.pitch;
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
        // Chrome sometimes never fires onend; never let the story stall.
        watchdog(Math.max(4000, estMs * 1.8 + 3000));
      };
      if (gen !== this.gen) return finish();
      if (url && this.opts.voiceEnabled) {
        onMode('server');
        const a = (this.audio ??= new Audio());
        a.preload = 'auto';
        a.src = url;
        a.onended = finish;
        a.onerror = () => {
          // F4: TTS/audio failure → degrade to device voice / text, keep going.
          a.onerror = null;
          if (gen === this.gen) viaSpeech();
        };
        a.play().catch(() => {
          if (gen === this.gen) viaSpeech();
        });
        watchdog(Math.max(6000, estMs * 2 + 5000));
      } else viaSpeech();
    });
  }

  async play(d: PlayDirective): Promise<void> {
    this.clearTimers();
    this.haltOutput();
    const gen = ++this.gen;
    this.ticker = setInterval(() => this.tick(), 250);
    if (d.bridgeText) {
      await this.speak(d.bridgeText, null, d.bridgeText.split(/\s+/).length * 400, gen, () => undefined);
      if (gen !== this.gen) return;
    }
    const segs = [...d.segments].sort((a, b) => a.index - b.index).filter((s) => s.index >= d.startAt.segmentIndex);
    for (const s of segs) {
      if (gen !== this.gen) return;
      this.current = { planId: d.planId, index: s.index, startedAt: performance.now(), durationMs: s.durationMs };
      let mode: AudioMode = 'text';
      await this.speak(s.text, s.audioUrl, s.durationMs, gen, (m) => {
        mode = m;
        this.ev.segment(d.planId, s.index, m);
      });
      void mode;
      if (gen !== this.gen) return;
    }
    if (gen !== this.gen) return;
    const last = segs.at(-1);
    this.clearTimers();
    this.current = null;
    this.ev.progress({ planId: d.planId, segmentIndex: last?.index ?? 0, offsetMs: last?.durationMs ?? 0, state: 'finished' });
  }

  /**
   * Speak a `say`. `append` (streamed answers, D-020) queues it after the say that is playing
   * (same generation) instead of replacing it; anything else (a new say, play or stop) supersedes
   * the whole queue.
   */
  async say(text: string, audioUrl: string | null, append = false): Promise<void> {
    const est = Math.max(1500, text.split(/\s+/).length * 380);
    if (append && this.sayChain && this.sayGen === this.gen) {
      const gen = this.gen;
      const job = this.sayChain.then(async () => {
        if (gen !== this.gen) return;
        await this.speak(text, audioUrl, est, gen, (m) => this.ev.sayStart(text, m));
        if (gen === this.gen) this.ev.sayEnd();
      });
      this.sayChain = job;
      return job;
    }
    this.clearTimers();
    this.haltOutput();
    const was = this.current;
    this.current = null;
    if (was) this.ev.progress({ planId: was.planId, segmentIndex: was.index, offsetMs: Math.round(performance.now() - was.startedAt), state: 'stopped' });
    const gen = ++this.gen;
    this.sayGen = gen;
    const job = (async () => {
      await this.speak(text, audioUrl, est, gen, (m) => this.ev.sayStart(text, m));
      if (gen === this.gen) this.ev.sayEnd();
    })();
    this.sayChain = job;
    return job;
  }

  private tick(): void {
    const c = this.current;
    if (!c) return;
    const now = performance.now();
    if (now - this.lastReport < 900) return;
    this.lastReport = now;
    this.ev.progress({ planId: c.planId, segmentIndex: c.index, offsetMs: Math.round(now - c.startedAt), state: 'playing' });
  }

  /** Stop output now. Resolves with the measured time until output is actually silent (ms). */
  async stop(): Promise<number> {
    const t0 = performance.now();
    const was = this.current;
    this.gen++;
    this.clearTimers();
    this.haltOutput();
    this.current = null;
    // Verify silence (speechSynthesis.cancel is async in some engines).
    const deadline = t0 + 500;
    while (performance.now() < deadline) {
      const speaking = speechAvailable() && window.speechSynthesis.speaking;
      const playing = this.audio ? !this.audio.paused : false;
      if (!speaking && !playing) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const latency = performance.now() - t0;
    if (was) this.ev.progress({ planId: was.planId, segmentIndex: was.index, offsetMs: Math.round(t0 - was.startedAt), state: 'stopped' });
    return latency;
  }

  dispose(): void {
    this.gen++;
    this.clearTimers();
    this.haltOutput();
    this.current = null;
  }
}
