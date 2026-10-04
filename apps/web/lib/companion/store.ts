/**
 * CompanionStore — the WebApp's client runtime. The client is a sensor, renderer and audio
 * player (D-002): it streams ContextFrames to a transport and renders the Directives that
 * come back. It never ranks or picks places itself.
 */
import type { DensityClass, Directive, GeoFix, LatLng, MapAction, MovementRegime, PlaceKind } from '@city/core';
import { guideById } from '@city/core';
import type { NowPlayingView } from '@/components/companion/Companion';
import { api, apiConfigured } from '../api';
import { SegmentPlayer, type AudioMode } from '../audio/player';
import { PushToTalk, sttSupported } from '../audio/stt';
import { DEMO_SCENARIOS, loadTrace } from '../local/demo-data';
import { clearLocalData, DEFAULT_SETTINGS, loadHistory, loadSettings, localeTag, saveHistory, saveSettings, type HistoryEntry, type Settings } from '../settings';
import { LocationDriver, type DriverState } from '../sim/driver';
import { LiveTransport, forgetGuest, guestToken } from '../session/live';
import { LocalTransport } from '../session/local';
import type { DebugEntry, SessionOptions, Transport, TransportStatus } from '../session/types';

export interface ListeningState {
  active: boolean;
  partial: string;
  mode: 'voice' | 'text';
  note: string | null;
}

export interface Snapshot {
  ready: boolean;
  transport: (TransportStatus & { reason?: string | null }) | null;
  regime: MovementRegime;
  density: DensityClass;
  driveSafe: boolean;
  simulated: boolean;
  silence: string | null;
  nowPlaying: NowPlayingView | null;
  caption: { text: string; mode: AudioMode | null; at: number } | null;
  card: { placeId: string; name: string; kind: PlaceKind; location: LatLng; spatialCue: string | null } | null;
  focus: { placeId: string; name: string; location: LatLng } | null;
  results: Extract<MapAction, { kind: 'show_results' }>['results'] | null;
  navigate: Extract<Directive, { type: 'navigate_handoff' }> | null;
  listening: ListeningState;
  debug: DebugEntry[];
  bargeIns: Array<{ at: number; ms: number }>;
  history: HistoryEntry[];
  driver: DriverState;
  settings: Settings;
  directiveCount: number;
}

const INITIAL_DRIVER: DriverState = { mode: 'idle', scenario: null, playing: false, speed: 1, elapsedMs: 0, durationMs: 0, done: false, position: null, route: null };

export class CompanionStore {
  private snap: Snapshot = {
    ready: false,
    transport: null,
    regime: 'unknown',
    density: 'urban',
    driveSafe: false,
    simulated: false,
    silence: null,
    nowPlaying: null,
    caption: null,
    card: null,
    focus: null,
    results: null,
    navigate: null,
    listening: { active: false, partial: '', mode: 'voice', note: null },
    debug: [],
    bargeIns: [],
    history: [],
    driver: INITIAL_DRIVER,
    settings: DEFAULT_SETTINGS,
    directiveCount: 0,
  };
  private listeners = new Set<() => void>();
  private transport: Transport | null = null;
  private player: SegmentPlayer;
  private driver: LocationDriver;
  private ptt: PushToTalk;
  private micDownAt = 0;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private lastInteractionAt: number | null = null;
  private started = false;
  private pendingEmit = false;

  constructor() {
    this.player = new SegmentPlayer({
      progress: (p) => {
        this.transport?.sendAudioProgress(p);
        if (p.state === 'finished') this.set({ nowPlaying: null });
      },
      segment: (planId, index, mode) => {
        const np = this.snap.nowPlaying;
        if (np && np.planId === planId) this.set({ nowPlaying: { ...np, segmentIndex: index, segmentProgress: 0, audio: mode, bridgeText: null } });
      },
      sayStart: (text, mode) => this.set({ caption: { text, mode, at: Date.now() } }),
      sayEnd: () => {
        if (this.transport instanceof LocalTransport) this.transport.sayFinished();
        const c = this.snap.caption;
        setTimeout(() => {
          if (this.snap.caption === c) this.set({ caption: null });
        }, 6000);
      },
    });
    this.driver = new LocationDriver({
      fixes: (fixes, clientTime, route) => this.sendFixes(fixes, clientTime, route),
      heartbeat: (clientTime) => this.sendFixes([], clientTime, null),
      state: (d) => this.set({ driver: d }),
    });
    this.ptt = new PushToTalk({
      partial: (t) => this.set({ listening: { ...this.snap.listening, partial: t } }),
      final: (t, at) => this.finishUtterance(t, at),
      error: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture' || code === 'network') {
          this.set({ listening: { ...this.snap.listening, mode: this.snap.driveSafe ? 'voice' : 'text', note: 'Microphone unavailable. ' + (this.snap.driveSafe ? 'Voice input is blocked in this browser.' : 'Type your question instead.') } });
        }
      },
      end: () => undefined,
    });
  }

  // ───────────────────────────────────────── subscription

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): Snapshot => this.snap;

  private set(p: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...p };
    if (this.pendingEmit) return;
    this.pendingEmit = true;
    queueMicrotask(() => {
      this.pendingEmit = false;
      for (const l of this.listeners) l();
    });
  }

  // ───────────────────────────────────────── lifecycle

  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const settings = loadSettings();
    this.applyPlayerSettings(settings);
    this.set({ settings, history: loadHistory() });
    await this.connect(settings);
    this.progressTimer = setInterval(() => this.tickProgress(), 250);
  }

  private sessionOpts(s: Settings, simulated: boolean): SessionOptions {
    return { guideId: s.guideId, locale: localeTag(s), units: s.units, simulated, talkativeness: s.talkativeness };
  }

  private makeTransport(kind: 'local' | 'live'): Transport {
    const ev = {
      directive: (d: Directive, seq: number) => this.onDirective(d, seq),
      debug: (e: DebugEntry) => this.set({ debug: [e, ...this.snap.debug].slice(0, 250) }),
      status: (st: TransportStatus) => this.set({ transport: { ...st, reason: this.snap.transport?.reason ?? null } }),
    };
    return kind === 'live' ? new LiveTransport(ev) : new LocalTransport(ev);
  }

  private async connect(settings: Settings): Promise<void> {
    this.transport?.close();
    let kind: 'local' | 'live' = 'local';
    let reason: string | null = null;
    if (settings.transport !== 'local') {
      if (!apiConfigured()) reason = 'No API configured for this build';
      else {
        try {
          await api.health();
          kind = 'live';
        } catch {
          reason = 'API unreachable';
        }
      }
    } else reason = 'Offline demo selected in Settings';
    let t = this.makeTransport(kind);
    try {
      await t.start(this.sessionOpts(settings, this.snap.driver.mode !== 'gps'));
    } catch (e) {
      if (kind === 'live') {
        reason = `Live session failed (${e instanceof Error ? e.message : 'error'})`;
        t = this.makeTransport('local');
        await t.start(this.sessionOpts(settings, true));
        kind = 'local';
      } else {
        this.set({ transport: { kind: 'local', connected: false, sessionId: null, detail: 'Demo data failed to load', reason: String(e) }, ready: true });
        return;
      }
    }
    this.transport = t;
    this.set({ ready: true, transport: { kind, connected: true, sessionId: t.sessionId, reason } });
  }

  dispose(): void {
    this.player.dispose();
    this.driver.dispose();
    this.ptt.abort();
    this.transport?.close();
    if (this.progressTimer) clearInterval(this.progressTimer);
  }

  // ───────────────────────────────────────── frames

  private sendFixes(fixes: GeoFix[], clientTime: number, route: LatLng[] | null): void {
    if (!this.transport) return;
    const ps = this.player.state;
    this.transport.sendContext({
      fixes,
      route: route ? { polyline: route, source: 'replay' } : null,
      appState: typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'background' : 'foreground',
      audio: ps
        ? { playing: true, planId: ps.planId, segmentIndex: ps.segmentIndex, offsetMs: ps.offsetMs, outputRoute: 'speaker' }
        : { playing: false, outputRoute: 'speaker' },
      lastInteractionAt: this.lastInteractionAt,
      clientTime,
      simulated: this.snap.driver.mode === 'trace' || this.snap.driver.mode === 'manual',
    });
  }

  /** Record a touch on the companion UI (driver-distraction policy input). */
  touched(): void {
    this.lastInteractionAt = this.driver.now();
  }

  private tickProgress(): void {
    const np = this.snap.nowPlaying;
    const ps = this.player.state;
    if (!np || !ps || ps.planId !== np.planId || np.status !== 'playing') return;
    const seg = np.segments[ps.segmentIndex];
    const prog = seg ? Math.min(1, ps.offsetMs / Math.max(1, seg.durationMs)) : 0;
    if (Math.abs(prog - np.segmentProgress) > 0.01 || ps.segmentIndex !== np.segmentIndex) this.set({ nowPlaying: { ...np, segmentIndex: ps.segmentIndex, segmentProgress: prog } });
  }

  // ───────────────────────────────────────── directives

  private onDirective(d: Directive, _seq: number): void {
    this.set({ directiveCount: this.snap.directiveCount + 1 });
    switch (d.type) {
      case 'state':
        this.set({ regime: d.regime, density: d.density, driveSafe: d.driveSafe, simulated: d.simulated, silence: d.silence ?? null });
        break;
      case 'play': {
        const g = guideById(this.snap.settings.guideId);
        const card = this.snap.card && this.snap.card.placeId === d.placeId ? this.snap.card : null;
        this.set({
          nowPlaying: {
            planId: d.planId,
            guideId: g?.id ?? 'ida',
            guideName: g?.name ?? 'Ida',
            placeName: d.placeName,
            segments: d.segments.map((s) => ({ text: s.text, durationMs: s.durationMs })),
            segmentIndex: d.startAt.segmentIndex,
            segmentProgress: 0,
            status: 'playing',
            spatialCue: card?.spatialCue ?? null,
            audio: d.segments.some((s) => s.audioUrl) ? 'server' : 'device',
            bridgeText: d.bridgeText ?? null,
          },
          caption: null,
          results: null,
        });
        if (!this.snap.history.some((h) => h.planId === d.planId)) {
          const entry: HistoryEntry = { planId: d.planId, placeName: d.placeName, guideId: g?.id ?? 'ida', at: Date.now(), simulated: this.snap.simulated || this.snap.driver.mode !== 'gps', excerpt: d.segments[0]?.text.slice(0, 180) ?? '' };
          const history = [entry, ...this.snap.history].slice(0, 100);
          saveHistory(history);
          this.set({ history });
        }
        void this.player.play(d);
        break;
      }
      case 'stop_audio': {
        void this.player.stop();
        const np = this.snap.nowPlaying;
        if (np && d.reason === 'user_pause') this.set({ nowPlaying: { ...np, status: 'paused' } });
        else if (np && d.reason !== 'preempt') this.set({ nowPlaying: null });
        break;
      }
      case 'say':
        void this.player.say(d.text, d.audioUrl, d.append === true);
        break;
      case 'card':
        this.set({ card: { placeId: d.placeId, name: d.name, kind: d.kind, location: d.location, spatialCue: d.spatialCue } });
        break;
      case 'map':
        if (d.action.kind === 'focus_place') this.set({ focus: { placeId: d.action.placeId, name: d.action.name, location: d.action.location } });
        else if (d.action.kind === 'show_results') this.set({ results: d.action.results });
        else if (d.action.kind === 'clear') this.set({ focus: null, results: null, card: null });
        else if (d.action.kind === 'follow_user') this.set({ focus: null });
        break;
      case 'listen':
        // The server may open listening (never automatically while driving at speed — D-008).
        if (!this.snap.driveSafe) this.openListening(false);
        break;
      case 'navigate_handoff':
        this.set({ navigate: d });
        break;
    }
  }

  // ───────────────────────────────────────── simulation controls

  async selectScenario(name: string): Promise<void> {
    const sc = DEMO_SCENARIOS.find((s) => s.name === name);
    if (!sc) return;
    const trace = await loadTrace(sc.trace);
    await this.newSession({ guideId: sc.guide.id as Settings['guideId'] }, true);
    this.driver.loadTrace(sc.name, trace, { useRoute: sc.useRoute ?? false });
  }

  play(): void {
    this.driver.play();
  }
  pause(): void {
    this.driver.pause();
  }
  setSpeed(n: number): void {
    this.driver.setSpeed(n);
  }
  async startManual(): Promise<void> {
    const pos = this.snap.driver.position ?? undefined;
    if (this.snap.driver.mode === 'gps' || this.snap.driver.mode === 'idle') await this.newSession({}, true);
    this.driver.startManual(pos);
  }
  dragTo(p: LatLng): void {
    this.driver.dragTo(p);
  }
  async useGps(): Promise<void> {
    await this.newSession({}, false);
    this.driver.startGps();
  }
  async stopSimulation(): Promise<void> {
    this.driver.stop();
    await this.newSession({}, false);
  }

  /** A new journey (fresh memory) — required when switching between simulated and real location. */
  private async newSession(patch: Partial<Settings>, simulated: boolean): Promise<void> {
    void this.player.stop();
    const settings = { ...this.snap.settings, ...patch };
    saveSettings(settings);
    this.applyPlayerSettings(settings);
    this.set({ settings, nowPlaying: null, caption: null, card: null, focus: null, results: null, navigate: null, silence: null, regime: 'unknown', driveSafe: false, simulated, debug: [] });
    await this.transport?.reset(this.sessionOpts(settings, simulated));
    this.set({ transport: this.snap.transport ? { ...this.snap.transport, sessionId: this.transport?.sessionId ?? null } : null });
  }

  // ───────────────────────────────────────── story controls

  pauseStory(): void {
    this.touched();
    this.transport?.sendControl('pause');
    if (this.transport?.kind === 'live') {
      void this.player.stop();
      const np = this.snap.nowPlaying;
      if (np) this.set({ nowPlaying: { ...np, status: 'paused' } });
    }
  }
  resumeStory(): void {
    this.touched();
    this.transport?.sendControl('resume');
  }
  skip(): void {
    this.touched();
    void this.player.stop();
    this.set({ nowPlaying: null });
    this.transport?.sendControl('skip');
  }
  notThatOne(): void {
    this.touched();
    void this.player.stop();
    this.set({ nowPlaying: null, focus: null });
    this.transport?.sendControl('not_that_one');
  }

  // ───────────────────────────────────────── voice

  /** Mic pressed: barge-in first (measured), then open listening. */
  async micDown(): Promise<void> {
    this.micDownAt = performance.now();
    const wasPlaying = this.player.state !== null || this.snap.caption !== null;
    const ms = await this.player.stop();
    if (wasPlaying) {
      const rounded = Math.round(ms * 10) / 10;
      console.info(`[telvey] barge-in: audio stopped ${rounded} ms after mic press`);
      this.set({ bargeIns: [{ at: Date.now(), ms: rounded }, ...this.snap.bargeIns].slice(0, 50) });
      this.set({ debug: [{ wall: Date.now(), t: this.driver.now(), regime: this.snap.regime, density: this.snap.density, speedMps: 0, decision: 'barge_in', reason: `${rounded} ms to silence`, source: 'local-core' as const }, ...this.snap.debug].slice(0, 250) });
      this.transport?.sendControl('interrupt', { bargeInStopMs: rounded, cause: 'user_speech' });
    } else this.transport?.sendControl('interrupt', { cause: 'user_speech' });
    const np = this.snap.nowPlaying;
    if (np) this.set({ nowPlaying: { ...np, status: 'interrupted' } });
    this.openListening(true);
  }

  micUp(): void {
    const held = performance.now() - this.micDownAt;
    if (held > 450 && this.snap.listening.mode === 'voice') this.ptt.stop(); // push-to-talk release
  }

  private openListening(voice: boolean): void {
    const canVoice = voice && sttSupported();
    const drive = this.snap.driveSafe;
    const note = canVoice ? null : drive ? 'Voice input is not available in this browser. Say it later, or stop somewhere safe.' : null;
    this.set({ listening: { active: true, partial: '', mode: canVoice ? 'voice' : 'text', note } });
    if (canVoice) {
      const ok = this.ptt.start(localeTag(this.snap.settings));
      if (!ok) this.set({ listening: { active: true, partial: '', mode: drive ? 'voice' : 'text', note: drive ? note : null } });
    }
    if (!canVoice && drive) setTimeout(() => this.cancelListening(), 3500); // D-008: no text entry while driving
  }

  private finishUtterance(text: string, at: number): void {
    if (!this.snap.listening.active) return;
    this.set({ listening: { active: false, partial: '', mode: 'voice', note: null } });
    if (text) this.transport?.sendUtterance(text, at);
    else this.endListeningWithoutSpeech();
  }

  submitText(text: string): void {
    this.ptt.abort();
    this.set({ listening: { active: false, partial: '', mode: 'voice', note: null } });
    if (text.trim()) this.transport?.sendUtterance(text.trim(), Date.now());
    else this.endListeningWithoutSpeech();
  }

  cancelListening(): void {
    if (!this.snap.listening.active) return;
    this.ptt.abort();
    this.set({ listening: { active: false, partial: '', mode: 'voice', note: null } });
    this.endListeningWithoutSpeech();
  }

  /** Switch the open listening sheet to text entry (never while driving — D-008). */
  typeInstead(): void {
    if (this.snap.driveSafe) return;
    this.ptt.abort();
    this.set({ listening: { ...this.snap.listening, active: true, mode: 'text', note: null } });
  }

  finishListening(): void {
    if (this.snap.listening.mode === 'voice') this.ptt.stop();
  }

  private endListeningWithoutSpeech(): void {
    if (this.transport?.kind === 'local') this.transport.sendUtterance('', Date.now());
    else this.transport?.sendControl('resume');
  }

  // ───────────────────────────────────────── settings

  private applyPlayerSettings(s: Settings): void {
    const g = guideById(s.guideId);
    this.player.opts = { voiceEnabled: s.voice, lang: localeTag(s), rate: g?.voice.speakingRate ?? 1, pitch: s.guideId === 'emil' ? 1.05 : 0.95 };
  }

  updateSettings(patch: Partial<Settings>): void {
    const prev = this.snap.settings;
    const settings = { ...prev, ...patch };
    saveSettings(settings);
    this.applyPlayerSettings(settings);
    this.set({ settings });
    if (patch.guideId && patch.guideId !== prev.guideId) this.transport?.setGuide(patch.guideId);
    if (patch.talkativeness !== undefined && patch.talkativeness !== prev.talkativeness) this.transport?.setTalkativeness(patch.talkativeness);
    if ((patch.locale && patch.locale !== prev.locale) || (patch.units && patch.units !== prev.units)) this.transport?.setLocale(localeTag(settings), settings.units);
    if (patch.transport && patch.transport !== prev.transport) void this.connect(settings);
  }

  async deleteData(): Promise<{ server: 'deleted' | 'not_applicable' | 'failed' }> {
    let server: 'deleted' | 'not_applicable' | 'failed' = 'not_applicable';
    if (apiConfigured()) {
      try {
        const token = await guestToken();
        await api.deleteMe(token);
        server = 'deleted';
      } catch {
        server = 'failed';
      }
    }
    forgetGuest();
    clearLocalData();
    this.set({ history: [], settings: loadSettings() });
    await this.newSession({}, this.snap.driver.mode !== 'gps');
    return { server };
  }

  clearNavigate(): void {
    this.set({ navigate: null });
  }
}

let singleton: CompanionStore | null = null;
export function companionStore(): CompanionStore {
  singleton ??= new CompanionStore();
  return singleton;
}
