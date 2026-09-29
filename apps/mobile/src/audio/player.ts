/**
 * NativeSegmentPlayer — plays `play` / `say` directives on the phone.
 *  - audioUrl present → expo-audio player (server TTS), from the local prefetch cache when ready
 *    (current + next 2 segments are downloaded ahead: playback survives short network drops, E3);
 *  - audioUrl null, 404 or playback error → on-device TTS via expo-speech (F4, labelled "device voice");
 *  - voice turned off → text-only timer so stories still advance (captions).
 * Barge-in: `stop()` silences output immediately and resolves with the measured stop latency.
 * OS interruptions (phone call, Siri/Assistant) are detected and reported so the story is paused
 * server-side instead of silently desynchronising.
 */
import type { Directive } from '@city/core';
import { PrefetchQueue, type AudioMode, type AudioProgressMsg } from '@city/client';
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import * as Speech from 'expo-speech';
import { downloadSegment, removeCached } from './cache';
import { acquireAudio, releaseAudioSoon } from './session';

type PlayDirective = Extract<Directive, { type: 'play' }>;

export interface PlayerEvents {
  progress(p: AudioProgressMsg): void;
  segment(planId: string, index: number, mode: AudioMode): void;
  sayStart(text: string, mode: AudioMode): void;
  sayEnd(ref: string | null): void;
  /** Output stopped by the OS (call, other app took focus). */
  interrupted(planId: string | null): void;
}

export interface PlayerOptions {
  voiceEnabled: boolean;
  lang: string;
  rate: number;
  pitch: number;
  lockScreen: { title: string; artist: string } | null;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class NativeSegmentPlayer {
  private gen = 0;
  private player: AudioPlayer | null = null;
  private sub: { remove(): void } | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private current: { planId: string; index: number; startedAt: number; mode: AudioMode; baseOffsetMs: number } | null = null;
  private speaking: 'server' | 'device' | 'text' | null = null;
  private finishCurrent: (() => void) | null = null;
  private failCurrent: (() => void) | null = null;
  private startedPlaying = false;
  private stopping = false;
  private lastReport = 0;
  readonly prefetch: PrefetchQueue;
  opts: PlayerOptions = { voiceEnabled: true, lang: 'en-US', rate: 1, pitch: 1, lockScreen: null };

  constructor(
    private readonly ev: PlayerEvents,
    private readonly resolveUrl: (u: string | null) => string | null,
  ) {
    this.prefetch = new PrefetchQueue({ download: downloadSegment, remove: removeCached }, { lookahead: 2, maxEntries: 24, concurrency: 2 });
  }

  private ensurePlayer(): AudioPlayer {
    if (this.player) return this.player;
    const p = createAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: true });
    this.sub = p.addListener('playbackStatusUpdate', (s: AudioStatus) => this.onStatus(s));
    this.player = p;
    return p;
  }

  private onStatus(s: AudioStatus): void {
    if (this.speaking !== 'server') return;
    if (s.error) {
      this.failCurrent?.();
      return;
    }
    if (s.playing) this.startedPlaying = true;
    if (s.didJustFinish) {
      this.finishCurrent?.();
      return;
    }
    // Paused by someone other than us after it had started: phone call / focus loss.
    if (this.startedPlaying && !s.playing && !s.isBuffering && s.isLoaded && !this.stopping) {
      const planId = this.current?.planId ?? null;
      this.startedPlaying = false;
      this.ev.interrupted(planId);
    }
  }

  get state(): { planId: string; segmentIndex: number; offsetMs: number; playing: boolean } | null {
    const c = this.current;
    if (!c) return null;
    return { planId: c.planId, segmentIndex: c.index, offsetMs: this.offsetMs(), playing: true };
  }

  get outputActive(): boolean {
    return this.speaking !== null;
  }

  private offsetMs(): number {
    const c = this.current;
    if (!c) return 0;
    if (c.mode === 'server' && this.player) return Math.max(0, Math.round(this.player.currentTime * 1000));
    return Math.max(0, Math.round(c.baseOffsetMs + now() - c.startedAt));
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  private haltOutput(): void {
    this.finishCurrent = null;
    this.failCurrent = null;
    this.speaking = null;
    try {
      this.player?.pause();
    } catch {
      /* ignore */
    }
    Speech.stop().catch(() => undefined);
  }

  /** Speak one chunk with the best available output. Resolves when done (or superseded). */
  private speak(text: string, audioUrl: string | null, estMs: number, gen: number, startOffsetMs: number, onMode: (m: AudioMode) => void): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.finishCurrent = null;
        this.failCurrent = null;
        this.speaking = null;
        resolve();
      };
      const watchdog = (ms: number) => this.timers.push(setTimeout(finish, ms));
      const viaDevice = () => {
        if (gen !== this.gen) return finish();
        if (!this.opts.voiceEnabled) {
          this.speaking = 'text';
          onMode('text');
          watchdog(Math.max(1200, estMs));
          return;
        }
        this.speaking = 'device';
        onMode('device');
        this.finishCurrent = finish;
        Speech.speak(text, {
          language: this.opts.lang,
          rate: this.opts.rate,
          pitch: this.opts.pitch,
          onDone: finish,
          onStopped: finish,
          onError: finish,
        });
        watchdog(Math.max(4000, estMs * 1.8 + 3000)); // never let a story stall on a lost callback
      };
      if (gen !== this.gen) return finish();
      const remote = this.resolveUrl(audioUrl);
      if (!remote || !this.opts.voiceEnabled) return viaDevice();
      void (async () => {
        const state = this.prefetch.state(remote);
        const local = state === 'downloading' || state === 'queued' ? await this.prefetch.whenReady(remote, 1500) : this.prefetch.resolve(remote);
        if (gen !== this.gen) return finish();
        const src = local ?? remote;
        const p = this.ensurePlayer();
        this.speaking = 'server';
        this.startedPlaying = false;
        onMode('server');
        this.finishCurrent = finish;
        this.failCurrent = () => {
          // F4: segment audio failed (404 = "speak it on device", network, codec) → device voice.
          this.failCurrent = null;
          this.finishCurrent = null;
          if (gen === this.gen) viaDevice();
        };
        try {
          p.replace({ uri: src });
          if (startOffsetMs > 0) await p.seekTo(startOffsetMs / 1000).catch(() => undefined);
          p.play();
        } catch {
          this.failCurrent?.();
          return;
        }
        watchdog(Math.max(8000, estMs * 2 + 6000));
      })();
    });
  }

  async play(d: PlayDirective): Promise<void> {
    this.clearTimers();
    this.haltOutput();
    const gen = ++this.gen;
    acquireAudio();
    this.ticker = setInterval(() => this.tick(), 250);
    const segs = [...d.segments].sort((a, b) => a.index - b.index).filter((s) => s.index >= d.startAt.segmentIndex);
    const refs = d.segments.map((s) => ({ index: s.index, url: this.resolveUrl(s.audioUrl) }));
    this.prefetch.update(refs, d.startAt.segmentIndex);
    this.setLockScreen(d.placeName);
    if (d.bridgeText) {
      await this.speak(d.bridgeText, null, d.bridgeText.split(/\s+/).length * 400, gen, 0, () => undefined);
      if (gen !== this.gen) return;
    }
    for (const s of segs) {
      if (gen !== this.gen) return;
      const startOffset = s.index === d.startAt.segmentIndex ? d.startAt.offsetMs : 0;
      this.prefetch.update(refs, s.index);
      this.current = { planId: d.planId, index: s.index, startedAt: now(), mode: 'text', baseOffsetMs: startOffset };
      await this.speak(s.text, s.audioUrl, s.durationMs, gen, startOffset, (m) => {
        if (this.current) this.current = { ...this.current, mode: m, startedAt: now() };
        this.ev.segment(d.planId, s.index, m);
      });
      if (gen !== this.gen) return;
    }
    if (gen !== this.gen) return;
    const last = segs.at(-1);
    this.clearTimers();
    this.current = null;
    this.clearLockScreen();
    releaseAudioSoon();
    this.ev.progress({ planId: d.planId, segmentIndex: last?.index ?? 0, offsetMs: last?.durationMs ?? 0, state: 'finished' });
  }

  async say(text: string, audioUrl: string | null, ref: string | null): Promise<void> {
    this.clearTimers();
    const was = this.current;
    const wasOffset = this.offsetMs();
    this.haltOutput();
    this.current = null;
    if (was) this.ev.progress({ planId: was.planId, segmentIndex: was.index, offsetMs: wasOffset, state: 'stopped' });
    const gen = ++this.gen;
    acquireAudio();
    const est = Math.max(1500, text.split(/\s+/).length * 380);
    await this.speak(text, audioUrl, est, gen, 0, (m) => this.ev.sayStart(text, m));
    if (gen === this.gen) {
      releaseAudioSoon();
      this.ev.sayEnd(ref);
    }
  }

  private tick(): void {
    const c = this.current;
    if (!c) return;
    const t = now();
    if (t - this.lastReport < 900) return;
    this.lastReport = t;
    this.ev.progress({ planId: c.planId, segmentIndex: c.index, offsetMs: this.offsetMs(), state: 'playing' });
  }

  /** Stop output now. Resolves with the measured time until output is verified silent (ms). */
  async stop(): Promise<number> {
    const t0 = now();
    const was = this.current;
    const wasOffset = this.offsetMs();
    this.stopping = true;
    this.gen++;
    this.clearTimers();
    this.haltOutput();
    this.current = null;
    // Verify silence (TTS cancel is asynchronous on both platforms).
    const deadline = t0 + 500;
    while (now() < deadline) {
      let speaking = false;
      try {
        speaking = await Speech.isSpeakingAsync();
      } catch {
        speaking = false;
      }
      const playing = this.player ? this.player.playing : false;
      if (!speaking && !playing) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const latency = now() - t0;
    this.stopping = false;
    this.clearLockScreen();
    releaseAudioSoon(400);
    if (was) this.ev.progress({ planId: was.planId, segmentIndex: was.index, offsetMs: wasOffset, state: 'stopped' });
    return latency;
  }

  private setLockScreen(placeName: string): void {
    const ls = this.opts.lockScreen;
    if (!ls) return;
    try {
      this.ensurePlayer().setActiveForLockScreen(true, { title: placeName, artist: ls.artist, albumTitle: ls.title });
    } catch {
      /* lock-screen controls unavailable */
    }
  }

  private clearLockScreen(): void {
    try {
      this.player?.clearLockScreenControls();
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    this.gen++;
    this.clearTimers();
    this.haltOutput();
    this.current = null;
    this.sub?.remove();
    this.sub = null;
    try {
      this.player?.remove();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.prefetch.clear();
  }
}
