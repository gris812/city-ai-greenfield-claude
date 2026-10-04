/**
 * CompanionStore — the native client runtime. The phone is a sensor, renderer and audio player
 * (D-002): it streams ContextFrames to a transport (live SessionChannel or the offline LocalEngine)
 * and renders the Directives that come back. It never ranks or picks places itself.
 *
 * Owns: session lifecycle, transport selection (live → demo fallback), location sources (GPS
 * foreground/background, fixture trace, manual puck — the latter two always flagged simulated),
 * frame batching, directive application, audio playback + prefetch, barge-in and voice input.
 */
import type { Directive, GeoFix, LatLng } from '@city/core';
import { guideById } from '@city/core';
import {
  BargeInTracker,
  createApiClient,
  ensureGuestToken,
  FrameBatcher,
  initialView,
  LocalTransport,
  reduceDirective,
  reducePlayback,
  SessionChannel,
  TracePlayer,
  type AudioProgressMsg,
  type CompanionView,
  type ControlAction,
  type DebugEntry,
  type DirectiveMeta,
  type SessionOptions,
  type Transport,
  type TransportStatus,
} from '@city/client';
import NetInfo from '@react-native-community/netinfo';
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import * as Localization from 'expo-localization';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { clearAudioCache } from '../audio/cache';
import { NativeSegmentPlayer } from '../audio/player';
import { configurePlayback } from '../audio/session';
import { VoiceInput, type VoiceEngine } from '../audio/voice-input';
import { config } from '../config';
import { MDICTS, type MDict } from '../i18n';
import { subscribeFixes } from '../location/fix-bus';
import { LocationTracker, type LocationPermissions } from '../location/tracker';
import { puckHeading } from '../logic/location';
import { addHistory, defaultSettingsFor, localeTag, mergeSettings, type HistoryEntry, type Settings } from '../logic/settings';
import { availableScenarios, loadDemoData, loadTrace } from '../sim/demo-data';
import { guestStore, KEYS, kv, secure } from '../storage';

export type LocationMode = 'none' | 'gps' | 'trace' | 'manual';
export type Health = 'connecting' | 'online' | 'degraded' | 'offline' | 'local';

export interface ListeningState {
  active: boolean;
  engine: VoiceEngine | null;
  partial: string;
  mode: 'voice' | 'text' | 'prompt';
  note: string | null;
  /** Upload in flight (server STT) or waiting for the answer. */
  busy: boolean;
}

export interface SimState {
  scenario: string | null;
  playing: boolean;
  speed: number;
  elapsedMs: number;
  durationMs: number;
  done: boolean;
}

export interface Snapshot {
  ready: boolean;
  onboarded: boolean;
  view: CompanionView;
  transport: { kind: 'local' | 'live'; health: Health; sessionId: string | null; detail: string | null; reason: string | null };
  network: boolean;
  settings: Settings;
  history: HistoryEntry[];
  listening: ListeningState;
  sessionActive: boolean;
  locationMode: LocationMode;
  position: (LatLng & { headingDeg: number | null; accuracyM: number | null }) | null;
  trail: LatLng[];
  sim: SimState | null;
  permissions: { location: LocationPermissions; mic: 'unknown' | 'granted' | 'denied' };
  backgroundActive: boolean;
  bargeIns: Array<{ at: number; ms: number }>;
  bargeStats: { p50: number | null; p95: number | null };
  debug: DebugEntry[];
  appState: 'foreground' | 'background';
  notice: string | null;
}

const IDLE_LISTEN: ListeningState = { active: false, engine: null, partial: '', mode: 'voice', note: null, busy: false };
const EMPTY_PERMS: LocationPermissions = { foreground: 'unknown', background: 'unknown', servicesEnabled: true };

function deviceDefaults(): Settings {
  try {
    const l = Localization.getLocales()[0];
    return defaultSettingsFor(l?.languageCode ?? 'en', l?.regionCode ?? 'US');
  } catch {
    return defaultSettingsFor('en', 'US');
  }
}

export class CompanionStore {
  private snap: Snapshot = {
    ready: false,
    onboarded: false,
    view: initialView(),
    transport: { kind: 'local', health: 'connecting', sessionId: null, detail: null, reason: null },
    network: true,
    settings: deviceDefaults(),
    history: [],
    listening: IDLE_LISTEN,
    sessionActive: false,
    locationMode: 'none',
    position: null,
    trail: [],
    sim: null,
    permissions: { location: EMPTY_PERMS, mic: 'unknown' },
    backgroundActive: false,
    bargeIns: [],
    bargeStats: { p50: null, p95: null },
    debug: [],
    appState: 'foreground',
    notice: null,
  };
  private listeners = new Set<() => void>();
  private pendingEmit = false;
  readonly api = createApiClient({ baseUrl: config.apiBaseUrl, fetch: (url, init) => expoFetch(url, init as never) as never });
  private transport: Transport | null = null;
  private player: NativeSegmentPlayer;
  private voice: VoiceInput;
  private tracker = new LocationTracker();
  private batcher = new FrameBatcher();
  private barge = new BargeInTracker(() => Date.now());
  private trace: TracePlayer | null = null;
  private manual: { target: LatLng; last: { p: LatLng; t: number } | null; clockBase: number; elapsed: number } | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickWall = 0;
  private lastLocalFrameAt = 0;
  private lastInteractionAt: number | null = null;
  private micDownAt = 0;
  private started = false;
  private unsubs: Array<() => void> = [];
  private captionTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting: Promise<void> | null = null;

  constructor() {
    this.player = new NativeSegmentPlayer(
      {
        progress: (p) => this.onPlayerProgress(p),
        segment: (planId, index, mode) => this.set({ view: reducePlayback(this.snap.view, { planId, segmentIndex: index, audio: mode }) }),
        sayStart: () => this.barge.answered(),
        sayEnd: (ref) => this.onSayEnd(ref),
        interrupted: (planId) => this.onOsInterruption(planId),
      },
      (u) => this.api.resolveAudioUrl(u),
    );
    this.voice = new VoiceInput({
      partial: (t) => this.set({ listening: { ...this.snap.listening, partial: t } }),
      final: (r) => void this.onVoiceFinal(r),
      error: (code, engine) => this.onVoiceError(code, engine),
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

  get t(): MDict {
    return MDICTS[this.snap.settings.locale];
  }

  private flash(notice: string, ms = 5000): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.set({ notice });
    this.noticeTimer = setTimeout(() => this.set({ notice: null }), ms);
  }

  // ───────────────────────────────────────── lifecycle

  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const [stored, history, onboarded] = await Promise.all([kv.get<Partial<Settings>>(KEYS.settings), kv.get<HistoryEntry[]>(KEYS.history), kv.get<boolean>(KEYS.onboarded)]);
    const settings = mergeSettings(deviceDefaults(), stored);
    this.applyPlayerSettings(settings);
    this.set({ settings, history: Array.isArray(history) ? history : [], onboarded: onboarded === true });
    await configurePlayback();
    const perms = await this.tracker.permissions();
    this.set({ permissions: { ...this.snap.permissions, location: perms } });

    this.unsubs.push(subscribeFixes((fixes) => this.onDeviceFixes(fixes)));
    this.tracker.onHeading = () => this.updatePuckHeading();
    const netUnsub = NetInfo.addEventListener((s) => {
      const up = s.isConnected !== false && s.isInternetReachable !== false;
      if (up !== this.snap.network) {
        this.set({ network: up });
        if (this.transport instanceof SessionChannel) this.transport.setNetworkAvailable(up);
      }
    });
    this.unsubs.push(netUnsub);
    const appSub = AppState.addEventListener('change', (s: AppStateStatus) => this.onAppState(s));
    this.unsubs.push(() => appSub.remove());

    this.lastTickWall = Date.now();
    this.tickTimer = setInterval(() => this.tick(), 250);
    this.set({ ready: true }); // never hold the splash on the network
    void this.connect(settings);
  }

  async requestLocationPermission(): Promise<LocationPermissions> {
    await this.tracker.requestForeground();
    await this.refreshPermissions();
    return this.snap.permissions.location;
  }

  async requestMicPermission(): Promise<boolean> {
    try {
      const r = await requestRecordingPermissionsAsync();
      this.set({ permissions: { ...this.snap.permissions, mic: r.granted ? 'granted' : 'denied' } });
      return r.granted;
    } catch {
      return false;
    }
  }

  async completeOnboarding(): Promise<void> {
    await kv.set(KEYS.onboarded, true);
    this.set({ onboarded: true });
  }

  private sessionOpts(s: Settings, simulated: boolean): SessionOptions {
    return { guideId: s.guideId, locale: localeTag(s), units: s.units, simulated, talkativeness: s.talkativeness };
  }

  private makeTransport(kind: 'local' | 'live'): Transport {
    const ev = {
      directive: (d: Directive, seq: number, meta?: DirectiveMeta) => this.onDirective(d, seq, meta),
      debug: (e: DebugEntry) => this.set({ debug: [e, ...this.snap.debug].slice(0, 100) }),
      status: (st: TransportStatus) => this.onTransportStatus(st),
    };
    if (kind === 'local') return new LocalTransport(ev, loadDemoData, 'Core pipeline running on this phone over fixture data');
    return new SessionChannel(ev, {
      api: this.api,
      guest: guestStore,
      platform: config.platform,
      appVersion: `${config.appVersion}+${config.buildNumber}`,
      capabilities: ['say_append'],
      log: __DEV__ ? (m) => console.info(`[telvey] ${m}`) : undefined,
    });
  }

  private onTransportStatus(st: TransportStatus): void {
    const health: Health = st.kind === 'local' ? 'local' : st.connected ? 'online' : this.snap.network ? 'degraded' : 'offline';
    this.set({ transport: { ...this.snap.transport, kind: st.kind, health, sessionId: st.sessionId, detail: st.detail ?? null } });
  }

  private connect(settings: Settings): Promise<void> {
    this.connecting ??= this.doConnect(settings).finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async doConnect(settings: Settings): Promise<void> {
    this.transport?.close();
    this.transport = null;
    this.batcher.reset();
    let kind: 'local' | 'live' = 'local';
    let reason: string | null = null;
    const simulated = this.snap.locationMode === 'trace' || this.snap.locationMode === 'manual';
    if (settings.transport === 'local') reason = 'Offline demo selected in Settings';
    else if (!this.api.configured) reason = this.t.apiNotConfigured;
    else {
      try {
        await this.api.health();
        kind = 'live';
      } catch {
        reason = 'API unreachable';
      }
    }
    this.set({ transport: { kind, health: kind === 'live' ? 'connecting' : 'local', sessionId: null, detail: null, reason } });
    let t = this.makeTransport(kind);
    try {
      await t.start(this.sessionOpts(settings, simulated || kind === 'local'));
    } catch (e) {
      if (kind === 'live') {
        reason = `Live session failed (${e instanceof Error ? e.message : 'error'})`;
        t = this.makeTransport('local');
        await t.start(this.sessionOpts(settings, true));
        kind = 'local';
      } else {
        this.set({ transport: { kind: 'local', health: 'offline', sessionId: null, detail: 'Demo data failed to load', reason: String(e) } });
        return;
      }
    }
    this.transport = t;
    if (t instanceof SessionChannel) t.setNetworkAvailable(this.snap.network);
    this.set({ transport: { ...this.snap.transport, kind, health: kind === 'local' ? 'local' : this.snap.transport.health, sessionId: t.sessionId, reason } });
  }

  /** Fresh journey (memory wiped) — required when switching between simulated and real location. */
  private async newSession(simulated: boolean): Promise<void> {
    void this.player.stop();
    this.voice.abort();
    this.batcher.reset();
    this.set({ view: { ...initialView(), simulated }, listening: IDLE_LISTEN, trail: [], debug: [] });
    const s = this.snap.settings;
    if (this.connecting) await this.connecting;
    if (!this.transport) await this.connect(s);
    else await this.transport.reset(this.sessionOpts(s, simulated || this.transport.kind === 'local'));
    this.set({ transport: { ...this.snap.transport, sessionId: this.transport?.sessionId ?? null } });
  }

  dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    for (const u of this.unsubs.splice(0)) u();
    this.player.dispose();
    this.voice.abort();
    void this.tracker.stopAll();
    this.transport?.close();
  }

  private onAppState(s: AppStateStatus): void {
    const appState = s === 'active' ? 'foreground' : 'background';
    if (appState === this.snap.appState) return;
    this.set({ appState });
    this.batcher.poke();
    if (appState === 'foreground') void this.refreshPermissions();
  }

  async refreshPermissions(): Promise<void> {
    const location = await this.tracker.permissions();
    this.set({ permissions: { ...this.snap.permissions, location } });
  }

  // ───────────────────────────────────────── location sources

  /** Start the companion with the device's real location (asks for permission if needed). */
  async startGps(): Promise<boolean> {
    this.touched();
    let perms = await this.tracker.permissions();
    if (perms.foreground !== 'granted') {
      await this.tracker.requestForeground();
      perms = await this.tracker.permissions();
    }
    this.set({ permissions: { ...this.snap.permissions, location: perms } });
    if (perms.foreground !== 'granted') {
      this.flash(this.t.locationDenied);
      await this.startManual();
      return false;
    }
    const wasSim = this.snap.locationMode === 'trace' || this.snap.locationMode === 'manual';
    this.stopSimSources();
    if (wasSim || !this.snap.sessionActive) await this.newSession(false);
    this.set({ locationMode: 'gps', sessionActive: true, sim: null });
    await this.tracker.startForeground();
    await this.syncBackground();
    return true;
  }

  async requestBackgroundLocation(): Promise<boolean> {
    const fg = await this.tracker.permissions();
    if (fg.foreground !== 'granted') await this.tracker.requestForeground();
    const r = await this.tracker.requestBackground();
    await this.refreshPermissions();
    await this.syncBackground();
    return r === 'granted';
  }

  /** Background location runs only while a real-location session is active and allowed (E2). */
  private async syncBackground(): Promise<void> {
    const want = this.snap.sessionActive && this.snap.locationMode === 'gps' && this.snap.settings.backgroundLocation && this.snap.permissions.location.background === 'granted';
    if (want && !this.tracker.backgroundActive) {
      const ok = await this.tracker.startBackground({ title: this.t.sessionNotification, body: this.t.sessionNotificationBody });
      this.set({ backgroundActive: ok });
    } else if (!want && this.tracker.backgroundActive) {
      await this.tracker.stopBackground();
      this.set({ backgroundActive: false });
    }
  }

  /** End the companion session: stop sensors, audio and the server session. */
  async endSession(): Promise<void> {
    this.touched();
    await this.player.stop();
    this.voice.abort();
    this.stopSimSources();
    await this.tracker.stopAll();
    if (this.transport instanceof SessionChannel) await this.transport.end();
    else this.transport?.close();
    this.transport = null;
    this.set({ sessionActive: false, locationMode: 'none', backgroundActive: false, sim: null, view: initialView(), listening: IDLE_LISTEN });
    await this.connect(this.snap.settings);
  }

  private stopSimSources(): void {
    this.trace = null;
    this.manual = null;
  }

  async selectScenario(name: string): Promise<boolean> {
    const sc = availableScenarios().find((s) => s.name === name);
    const trace = sc ? loadTrace(sc.trace) : null;
    if (!sc || !trace) return false;
    this.tracker.stopForeground();
    await this.tracker.stopBackground();
    this.stopSimSources();
    const settings = { ...this.snap.settings, guideId: sc.guide.id as Settings['guideId'] };
    await this.saveSettings(settings);
    this.set({ locationMode: 'trace', sessionActive: true, backgroundActive: false });
    await this.newSession(true);
    this.trace = new TracePlayer(trace, Date.now());
    this.trace.setSpeed(this.snap.sim?.speed ?? 4);
    const path = trace.fixes.filter((_, i) => i % 5 === 0).map((f) => ({ lat: f.lat, lng: f.lng }));
    const first = trace.fixes[0];
    this.set({
      trail: path,
      position: first ? { lat: first.lat, lng: first.lng, headingDeg: first.headingDeg ?? null, accuracyM: 5 } : null,
      sim: { scenario: sc.name, playing: false, speed: this.trace.state.speed, elapsedMs: 0, durationMs: this.trace.state.durationMs, done: false },
    });
    return true;
  }

  playSim(): void {
    this.touched();
    this.trace?.play();
    this.syncSim();
  }
  pauseSim(): void {
    this.trace?.pause();
    this.syncSim();
  }
  setSimSpeed(n: number): void {
    this.trace?.setSpeed(n);
    this.syncSim();
  }
  private syncSim(): void {
    const tr = this.trace;
    if (!tr) return;
    this.set({ sim: { ...(this.snap.sim ?? { scenario: null }), playing: tr.state.playing, speed: tr.state.speed, elapsedMs: tr.state.elapsedMs, durationMs: tr.state.durationMs, done: tr.state.done } });
  }

  /** Manual puck (simulated; also the fallback when location permission is denied). */
  async startManual(at?: LatLng): Promise<void> {
    const p = at ?? this.snap.position ?? { lat: 41.8796, lng: -87.6237 };
    const wasReal = this.snap.locationMode === 'gps' || this.snap.locationMode === 'none';
    this.tracker.stopForeground();
    await this.tracker.stopBackground();
    this.trace = null;
    if (wasReal) await this.newSession(true);
    this.manual = { target: p, last: null, clockBase: Date.now(), elapsed: 0 };
    this.set({ locationMode: 'manual', sessionActive: true, backgroundActive: false, sim: null, position: { ...p, headingDeg: null, accuracyM: 5 }, trail: [] });
  }

  moveManual(p: LatLng): void {
    this.touched();
    if (this.snap.locationMode !== 'manual') {
      void this.startManual(p);
      return;
    }
    if (this.manual) this.manual.target = p;
  }

  // ───────────────────────────────────────── frames

  private simulated(): boolean {
    return this.snap.locationMode === 'trace' || this.snap.locationMode === 'manual';
  }

  private virtualNow(): number {
    if (this.trace) return this.trace.now();
    if (this.manual) return this.manual.clockBase + this.manual.elapsed;
    return Date.now();
  }

  private onDeviceFixes(fixes: GeoFix[]): void {
    if (this.snap.locationMode !== 'gps' || fixes.length === 0) return;
    this.acceptFixes(fixes);
  }

  private acceptFixes(fixes: GeoFix[]): void {
    const last = fixes.at(-1)!;
    const heading = puckHeading(last, this.tracker.compassDeg);
    const trail = this.snap.locationMode === 'gps' ? [...this.snap.trail, { lat: last.lat, lng: last.lng }].slice(-240) : this.snap.trail;
    this.set({ position: { lat: last.lat, lng: last.lng, headingDeg: heading, accuracyM: last.accuracyM ?? null }, trail });
    if (!this.transport) return;
    if (this.transport.kind === 'local') {
      // Local engine: one frame per fix, like the replay harness (deterministic regime tracking).
      for (const f of fixes) this.transport.sendContext(this.frameBody([f], f.t));
      this.lastLocalFrameAt = Date.now();
    } else {
      this.batcher.pushAll(fixes);
      // Event-driven flush: RN pauses JS timers while the app is backgrounded (screen locked), but
      // location events keep arriving from the OS, so they must be able to push frames out (E2).
      this.flushFrames(Date.now());
    }
  }

  private flushFrames(wall: number): void {
    const t = this.transport;
    if (!t || t.kind !== 'live' || !this.snap.sessionActive || !this.batcher.due(wall)) return;
    t.sendContext(this.batcher.take(this.virtualNow(), { appState: this.snap.appState, audio: this.frameBody([], 0).audio, lastInteractionAt: this.lastInteractionAt, simulated: this.simulated() }));
  }

  private updatePuckHeading(): void {
    const p = this.snap.position;
    if (!p || this.snap.locationMode !== 'gps') return;
    const h = this.tracker.compassDeg;
    if (h !== null && (p.headingDeg === null || Math.abs(h - p.headingDeg) > 4)) this.set({ position: { ...p, headingDeg: h } });
  }

  private frameBody(fixes: GeoFix[], clientTime: number) {
    const ps = this.player.state;
    return {
      fixes,
      route: null,
      appState: this.snap.appState,
      audio: ps
        ? { playing: true, planId: ps.planId, segmentIndex: ps.segmentIndex, offsetMs: ps.offsetMs, outputRoute: 'unknown' as const }
        : { playing: this.player.outputActive, outputRoute: 'unknown' as const },
      lastInteractionAt: this.lastInteractionAt,
      clientTime,
      simulated: this.simulated(),
    };
  }

  private tick(): void {
    const wall = Date.now();
    const dt = Math.min(1000, wall - this.lastTickWall);
    this.lastTickWall = wall;
    // simulation sources
    if (this.trace) {
      const fixes = this.trace.advance(dt);
      if (fixes.length) this.acceptFixes(fixes);
      if (this.snap.sim && (fixes.length || this.snap.sim.playing !== this.trace.state.playing)) this.syncSim();
    } else if (this.manual) {
      const m = this.manual;
      m.elapsed += dt;
      const now = m.clockBase + m.elapsed;
      if (!m.last || now - m.last.t >= 1000) {
        const moved = m.last ? Math.hypot((m.target.lat - m.last.p.lat) * 111_000, (m.target.lng - m.last.p.lng) * 111_000 * Math.cos((m.target.lat * Math.PI) / 180)) : 0;
        const heading = m.last && moved > 0.5 ? (Math.atan2((m.target.lng - m.last.p.lng) * Math.cos((m.target.lat * Math.PI) / 180), m.target.lat - m.last.p.lat) * 180) / Math.PI : null;
        const fix: GeoFix = { t: now, lat: m.target.lat, lng: m.target.lng, accuracyM: 5, speedMps: null, headingDeg: heading === null ? (this.snap.position?.headingDeg ?? null) : (heading + 360) % 360, source: 'simulated' };
        m.last = { p: m.target, t: now };
        this.acceptFixes([fix]);
      }
    }
    // outbound frames
    const t = this.transport;
    if (t && this.snap.sessionActive) {
      if (t.kind === 'local') {
        if (wall - this.lastLocalFrameAt >= 1000) {
          this.lastLocalFrameAt = wall;
          t.sendContext(this.frameBody([], this.virtualNow())); // heartbeat so the director re-evaluates
        }
      } else this.flushFrames(wall); // heartbeat / stationary cadence while timers run (foreground)
    }
    // now-playing progress
    const np = this.snap.view.nowPlaying;
    const ps = this.player.state;
    if (np && ps && ps.planId === np.planId && np.status === 'playing') {
      const seg = np.segments.find((s) => s.index === ps.segmentIndex);
      const prog = seg ? Math.min(1, ps.offsetMs / Math.max(1, seg.durationMs)) : 0;
      if (Math.abs(prog - np.segmentProgress) > 0.02 || ps.segmentIndex !== np.segmentIndex) this.set({ view: reducePlayback(this.snap.view, { planId: np.planId, segmentIndex: ps.segmentIndex, progress: prog }) });
    }
    if (this.barge.expire(15_000) && this.snap.listening.busy) this.set({ listening: IDLE_LISTEN });
  }

  /** Record a touch on the companion UI (driver-distraction policy input). */
  touched(): void {
    this.lastInteractionAt = this.virtualNow();
  }

  // ───────────────────────────────────────── directives

  private onDirective(d: Directive, _seq: number, meta?: DirectiveMeta): void {
    const view = reduceDirective(this.snap.view, d, Date.now());
    this.set({ view });
    switch (d.type) {
      case 'state':
        this.tracker.setDriving(d.driveSafe);
        if (d.driveSafe && this.snap.listening.active && this.snap.listening.mode === 'text') this.cancelListening(); // D-008: no text entry while driving
        break;
      case 'play': {
        const g = guideById(this.snap.settings.guideId);
        const history = addHistory(this.snap.history, { planId: d.planId, placeName: d.placeName, guideId: g?.id ?? 'ida', at: Date.now(), simulated: this.simulated() || this.snap.transport.kind === 'local', excerpt: d.segments[0]?.text.slice(0, 180) ?? '' });
        if (history !== this.snap.history) {
          this.set({ history });
          void kv.set(KEYS.history, history);
        }
        this.barge.answered();
        this.batcher.poke();
        void this.player.play(d);
        break;
      }
      case 'stop_audio':
        void this.player.stop();
        break;
      case 'say':
        if (this.captionTimer) clearTimeout(this.captionTimer);
        void this.player.say(d.text, d.audioUrl, meta?.ref ?? null, d.append === true);
        if (this.snap.listening.busy) this.set({ listening: IDLE_LISTEN });
        break;
      case 'listen':
        // Never auto-record: show the prompt; the user taps the mic (D-008, privacy).
        if (!view.driveSafe && !this.snap.listening.active) this.set({ listening: { ...IDLE_LISTEN, active: true, mode: 'prompt' } });
        break;
      case 'navigate_handoff':
        if (view.driveSafe) void this.openNavigation(); // hands-free: the user asked by voice
        break;
      default:
        break;
    }
  }

  private onPlayerProgress(p: AudioProgressMsg): void {
    this.transport?.sendAudioProgress(p);
    if (p.state === 'finished') {
      this.set({ view: reducePlayback(this.snap.view, { planId: p.planId, status: 'finished' }) });
      this.batcher.poke();
    }
  }

  private onSayEnd(ref: string | null): void {
    if (this.transport instanceof LocalTransport) this.transport.sayFinished();
    else if (ref) this.transport?.sendAudioProgress({ planId: ref, segmentIndex: 0, offsetMs: 0, state: 'finished' });
    const c = this.snap.view.caption;
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => {
      if (this.snap.view.caption === c) this.set({ view: { ...this.snap.view, caption: null } });
    }, 6000);
  }

  /** Phone call / another app took audio focus mid-story: pause server-side, offer resume. */
  private onOsInterruption(planId: string | null): void {
    const np = this.snap.view.nowPlaying;
    if (!np || (planId && np.planId !== planId)) return;
    void this.player.stop();
    this.set({ view: { ...this.snap.view, nowPlaying: { ...np, status: 'paused' } } });
    this.transport?.sendControl('pause');
  }

  async openNavigation(): Promise<void> {
    const n = this.snap.view.navigate;
    if (!n) return;
    const url = config.platform === 'ios' && n.urls.apple ? n.urls.apple : n.urls.google;
    try {
      await Linking.openURL(url);
    } catch {
      /* no handler */
    }
    this.set({ view: { ...this.snap.view, navigate: null } });
  }
  clearNavigate(): void {
    this.set({ view: { ...this.snap.view, navigate: null } });
  }

  // ───────────────────────────────────────── story controls

  private control(a: ControlAction): void {
    this.touched();
    this.transport?.sendControl(a);
  }
  pauseStory(): void {
    this.control('pause');
    if (this.transport?.kind === 'live') {
      void this.player.stop();
      const np = this.snap.view.nowPlaying;
      if (np) this.set({ view: { ...this.snap.view, nowPlaying: { ...np, status: 'paused' } } });
    }
  }
  resumeStory(): void {
    this.control('resume');
  }
  skip(): void {
    void this.player.stop();
    this.set({ view: { ...this.snap.view, nowPlaying: null } });
    this.control('skip');
  }
  notThatOne(): void {
    void this.player.stop();
    this.set({ view: { ...this.snap.view, nowPlaying: null, focus: null } });
    this.control('not_that_one');
  }
  repeat(): void {
    this.control('repeat');
  }

  // ───────────────────────────────────────── voice

  /** Mic pressed: barge-in first (measured), then open listening. Tap again (or release after a hold) to send. */
  async micDown(): Promise<void> {
    this.touched();
    this.micDownAt = Date.now();
    const l = this.snap.listening;
    if (l.active && l.engine) {
      this.finishListening();
      return;
    }
    const wasPlaying = this.player.outputActive;
    if (!this.barge.press(wasPlaying)) return;
    if (this.transport instanceof SessionChannel) this.transport.bargeIn();
    const ms = await this.player.stop();
    this.barge.silent();
    const rounded = Math.round(ms * 10) / 10;
    if (wasPlaying) {
      if (__DEV__) console.info(`[telvey] barge-in: audio stopped ${rounded} ms after mic press`);
      this.set({ bargeIns: [{ at: Date.now(), ms: rounded }, ...this.snap.bargeIns].slice(0, 50), bargeStats: { p50: this.barge.stopP50, p95: this.barge.stopP95 } });
      this.transport?.sendControl('interrupt', { bargeInStopMs: rounded, cause: 'user_speech' });
    } else this.transport?.sendControl('interrupt', { cause: 'user_speech' });
    const np = this.snap.view.nowPlaying;
    if (np) this.set({ view: { ...this.snap.view, nowPlaying: { ...np, status: 'interrupted' } } });
    await this.openListening();
  }

  micUp(): void {
    const held = Date.now() - this.micDownAt;
    if (held > 450 && this.snap.listening.active && this.snap.listening.engine) this.voice.stop(); // push-to-talk release
  }

  private async openListening(): Promise<void> {
    const drive = this.snap.view.driveSafe;
    const serverAllowed = this.transport?.kind === 'live';
    this.set({ listening: { ...IDLE_LISTEN, active: true, mode: 'voice' } });
    const engine = await this.voice.start(localeTag(this.snap.settings), this.snap.settings.stt, serverAllowed);
    if (!this.snap.listening.active) {
      this.voice.abort();
      return;
    }
    if (engine) {
      this.set({ listening: { ...this.snap.listening, engine, mode: 'voice' }, permissions: { ...this.snap.permissions, mic: 'granted' } });
      return;
    }
    // onVoiceError has already explained why; fall back per D-008.
    if (drive) setTimeout(() => this.cancelListening(), 3500);
    else if (this.snap.listening.active) this.set({ listening: { ...this.snap.listening, mode: 'text', engine: null } });
  }

  private async onVoiceFinal(r: { engine: 'device'; text: string; speechEndAt: number } | { engine: 'server'; uri: string; durationS: number; speechEndAt: number }): Promise<void> {
    if (!this.snap.listening.active) return;
    if (r.engine === 'device') {
      this.finishUtterance(r.text, r.speechEndAt, 'device');
      return;
    }
    const t = this.transport;
    if (!(t instanceof SessionChannel)) {
      this.cancelListening();
      return;
    }
    this.barge.submit();
    this.set({ listening: { ...this.snap.listening, busy: true, partial: '…' } });
    let bytes: Uint8Array | null = null;
    try {
      bytes = await new File(r.uri).bytes();
    } catch {
      bytes = null;
    }
    const text = bytes ? await t.submitAudio(bytes, 'audio/mp4', r.durationS) : null;
    try {
      new File(r.uri).delete(); // never keep voice recordings (D-012)
    } catch {
      /* ignore */
    }
    if (text === null) {
      this.flash(this.snap.view.driveSafe ? this.t.voiceUnavailableDrive : this.t.typeQuestion);
      this.set({ listening: this.snap.view.driveSafe ? IDLE_LISTEN : { ...IDLE_LISTEN, active: true, mode: 'text' } });
      return;
    }
    if (!text.trim()) {
      this.set({ listening: IDLE_LISTEN });
      this.endListeningWithoutSpeech();
      return;
    }
    this.set({ listening: { ...this.snap.listening, partial: text, busy: true } });
  }

  private onVoiceError(code: 'permission' | 'unavailable' | 'no_speech' | 'failed', _engine: VoiceEngine): void {
    if (code === 'no_speech') {
      this.cancelListening();
      return;
    }
    const drive = this.snap.view.driveSafe;
    const note = code === 'permission' ? this.t.micDenied : drive ? this.t.voiceUnavailableDrive : null;
    if (code === 'permission') this.set({ permissions: { ...this.snap.permissions, mic: 'denied' } });
    if (this.snap.listening.active) this.set({ listening: { ...this.snap.listening, engine: null, mode: drive ? 'voice' : 'text', note } });
    if (drive) setTimeout(() => this.cancelListening(), 3500);
  }

  private finishUtterance(text: string, at: number, provider: string): void {
    this.set({ listening: { ...IDLE_LISTEN, active: true, busy: true, partial: text } });
    this.barge.submit();
    const t = this.transport;
    if (t instanceof SessionChannel) t.sendUtterance(text, at, provider);
    else t?.sendUtterance(text, at);
    setTimeout(() => {
      if (this.snap.listening.busy) this.set({ listening: IDLE_LISTEN });
    }, 2500);
  }

  finishListening(): void {
    if (this.snap.listening.engine) this.voice.stop();
  }

  submitText(text: string): void {
    this.touched();
    this.voice.abort();
    if (text.trim()) this.finishUtterance(text.trim(), Date.now(), 'typed');
    else {
      this.set({ listening: IDLE_LISTEN });
      this.endListeningWithoutSpeech();
    }
  }

  cancelListening(): void {
    if (!this.snap.listening.active) return;
    this.voice.abort();
    this.barge.cancel();
    this.set({ listening: IDLE_LISTEN });
    this.endListeningWithoutSpeech();
  }

  /** Switch the open sheet to text entry (never while driving — D-008). */
  typeInstead(): void {
    if (this.snap.view.driveSafe) return;
    this.voice.abort();
    this.set({ listening: { ...IDLE_LISTEN, active: true, mode: 'text' } });
  }

  private endListeningWithoutSpeech(): void {
    if (this.transport?.kind === 'local') this.transport.sendUtterance('', Date.now());
    else this.transport?.sendControl('resume');
  }

  // ───────────────────────────────────────── settings & data

  private applyPlayerSettings(s: Settings): void {
    const g = guideById(s.guideId);
    this.player.opts = {
      voiceEnabled: s.voice,
      lang: localeTag(s),
      rate: g?.voice.speakingRate ?? 1,
      pitch: s.guideId === 'emil' ? 1.05 : 0.95,
      lockScreen: { title: 'Telvey', artist: g?.name ?? 'Telvey' },
    };
  }

  private async saveSettings(settings: Settings): Promise<void> {
    this.applyPlayerSettings(settings);
    this.set({ settings });
    await kv.set(KEYS.settings, settings);
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.touched();
    const prev = this.snap.settings;
    const settings = mergeSettings(prev, { ...prev, ...patch });
    await this.saveSettings(settings);
    const t = this.transport;
    if (patch.guideId && patch.guideId !== prev.guideId) t?.setGuide(patch.guideId);
    if (patch.talkativeness !== undefined && patch.talkativeness !== prev.talkativeness) {
      // Local engine takes the absolute level; the server adjusts in quieter/chattier steps.
      if (t?.kind === 'local') t.setTalkativeness(settings.talkativeness);
      else t?.setTalkativeness(settings.talkativeness - prev.talkativeness);
    }
    if ((patch.locale && patch.locale !== prev.locale) || (patch.units && patch.units !== prev.units)) t?.setLocale(localeTag(settings), settings.units);
    if (patch.transport && patch.transport !== prev.transport) {
      await this.connect(settings);
    }
    if (patch.backgroundLocation !== undefined) await this.syncBackground();
  }

  async fetchServerHistory(): Promise<Array<{ placeId: string; placeName: string; at: number }>> {
    if (!this.api.configured || this.snap.transport.kind !== 'live') return [];
    try {
      const token = await ensureGuestToken(this.api, guestStore);
      const r = await this.api.history(token);
      return Array.isArray(r) ? r : r.items;
    } catch {
      return [];
    }
  }

  async deleteData(): Promise<{ server: 'deleted' | 'not_applicable' | 'failed' }> {
    let server: 'deleted' | 'not_applicable' | 'failed' = 'not_applicable';
    const guest = await guestStore.get();
    if (this.api.configured && guest?.token) {
      try {
        await this.api.deleteMe(guest.token);
        server = 'deleted';
      } catch {
        server = 'failed';
      }
    }
    await guestStore.set(null);
    await kv.clearTelvey();
    await secure.set(KEYS.guest, null);
    clearAudioCache();
    this.player.prefetch.clear();
    const settings = deviceDefaults();
    this.applyPlayerSettings(settings);
    this.set({ history: [], settings, onboarded: false });
    await this.endSession();
    return { server };
  }
}

let singleton: CompanionStore | null = null;
export function companionStore(): CompanionStore {
  singleton ??= new CompanionStore();
  return singleton;
}
