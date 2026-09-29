/**
 * SessionChannel — the live transport (docs/API.md), platform-neutral: one WebSocket per
 * session with the `hello` / `ack` / `resume` protocol, contiguous directive `seq` delivered
 * exactly once and in order (DirectiveSequencer), the turn gate, and REST fallbacks while the
 * socket is down (degraded but functional). Used by apps/mobile; apps/web keeps its own
 * LiveTransport for now (TODO: migrate web to this class — same wire protocol).
 *
 * E3 guarantees implemented here:
 *  - reconnect sends `resume {lastDirectiveSeq}`; the replay is merged through the sequencer,
 *    so nothing is applied twice and nothing is applied out of order;
 *  - gaps (REST replies, overtaking live directives) are filled via `GET /directives?after=`;
 *  - utterances carry an `utteranceId`; an utterance that could not be delivered is retried
 *    with the same id, which the server de-duplicates (a retried id never re-runs a tool).
 */
import type { ContextFrame, Directive } from '@city/core';
import { ApiError, parseDirectives, type ApiClient, type SessionCreated } from './api.js';
import { mergeFrames, type FrameBody } from './batcher.js';
import { DirectiveSequencer, TurnGate, type Envelope } from './sequencer.js';
import type { AudioProgressMsg, ControlAction, SessionOptions, Transport, TransportEvents } from './types.js';

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface GuestTokenStore {
  get(): Promise<{ guestId: string; token: string } | null>;
  set(v: { guestId: string; token: string } | null): Promise<void>;
}

export interface ChannelDeps {
  api: ApiClient;
  guest: GuestTokenStore;
  platform: string;
  appVersion: string;
  WebSocket?: WebSocketCtor;
  now?: () => number;
  newId?: () => string;
  /** How long to wait for an in-order directive before asking the server for the gap. */
  gapFillMs?: number;
  log?: (msg: string) => void;
}

const OPEN = 1;

export async function ensureGuestToken(api: ApiClient, store: GuestTokenStore, forceNew = false): Promise<string> {
  if (!forceNew) {
    const g = await store.get();
    if (g?.token) return g.token;
  }
  const created = await api.guest();
  await store.set(created);
  return created.token;
}

export type ChannelHealth = 'connecting' | 'online' | 'degraded' | 'offline';

export class SessionChannel implements Transport {
  readonly kind = 'live' as const;
  private token: string | null = null;
  private id: string | null = null;
  private ws: WebSocketLike | null = null;
  private wsUrl: string | null = null;
  private frameSeq = 0;
  private pendingFrame: FrameBody | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private closed = true;
  private restInFlight = false;
  private networkUp = true;
  private readonly seqr = new DirectiveSequencer(0);
  private readonly gate = new TurnGate();
  private readonly outbox = new Map<string, { text: string; speechEndAt: number; sttProvider: string; utteranceId: string }>();
  private opts: SessionOptions | null = null;
  health: ChannelHealth = 'offline';

  constructor(
    private readonly ev: TransportEvents,
    private readonly deps: ChannelDeps,
  ) {}

  get sessionId(): string | null {
    return this.id;
  }
  get lastDirectiveSeq(): number {
    return this.seqr.lastSeq;
  }
  get stats(): { duplicates: number; skipped: number } {
    return { duplicates: this.seqr.duplicates, skipped: this.seqr.skipped };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
  private newId(): string {
    return this.deps.newId?.() ?? `u-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  private log(m: string): void {
    this.deps.log?.(m);
  }

  // ─────────────────────────────────────────── lifecycle

  async start(opts: SessionOptions): Promise<void> {
    this.opts = opts;
    this.closed = false;
    this.health = 'connecting';
    const { api } = this.deps;
    this.token = await ensureGuestToken(api, this.deps.guest);
    const body = { guideId: opts.guideId, locale: opts.locale, units: opts.units, simulated: opts.simulated, client: { platform: this.deps.platform, appVersion: this.deps.appVersion } };
    let created: SessionCreated;
    try {
      created = await api.createSession(this.token, body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.token = await ensureGuestToken(api, this.deps.guest, true);
        created = await api.createSession(this.token, body);
      } else throw e;
    }
    this.id = created.sessionId;
    this.wsUrl = api.wsUrlFor(created, this.token);
    this.seqr.reset(0);
    this.gate.reset();
    this.frameSeq = 0;
    this.pendingFrame = null;
    this.connect();
    this.pingTimer = setInterval(() => this.send({ type: 'ping', t: this.now() }), 20_000);
    if (opts.talkativeness !== 0) this.setTalkativeness(opts.talkativeness);
  }

  /** Connectivity hint from the OS (NetInfo): reconnect immediately when the network returns. */
  setNetworkAvailable(up: boolean): void {
    const was = this.networkUp;
    this.networkUp = up;
    if (!up) {
      this.setHealth('offline', 'No network connection');
      return;
    }
    if (!was && !this.closed && !this.isOpen()) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.reconnectDelay = 1000;
      this.connect();
    }
  }

  private setHealth(h: ChannelHealth, detail?: string): void {
    this.health = h;
    this.ev.status({ kind: 'live', connected: h === 'online', sessionId: this.id, degraded: h !== 'online', ...(detail ? { detail } : {}) });
  }

  private connect(): void {
    if (!this.wsUrl || this.closed) return;
    const Ctor = this.deps.WebSocket ?? (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Ctor) {
      this.setHealth('degraded', 'WebSocket unavailable, using REST fallback');
      return;
    }
    let ws: WebSocketLike;
    try {
      ws = new Ctor(this.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectDelay = 1000;
      // Always resume (also at 0): directives emitted before the socket attached are replayed once.
      this.send({ type: 'resume', lastDirectiveSeq: this.seqr.lastSeq });
      this.setHealth('online');
      this.flushOutbox();
      this.flushFrame();
    };
    ws.onmessage = (m) => {
      if (this.ws !== ws) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(m.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      this.setHealth(this.networkUp ? 'degraded' : 'offline', this.networkUp ? 'Realtime channel down, using REST fallback' : 'No network connection');
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const d = this.reconnectDelay;
    this.reconnectDelay = Math.min(15_000, d * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, d + Math.random() * 300);
  }

  private onMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'directive': {
        const d = (msg.directive ?? msg.payload) as Directive | undefined;
        const seq = typeof msg.seq === 'number' ? msg.seq : typeof msg.directiveSeq === 'number' ? msg.directiveSeq : null;
        if (!d) return;
        if (seq === null) {
          this.apply({ seq: this.seqr.lastSeq, turn: null, directive: d }); // unsequenced (legacy) — apply as-is
          return;
        }
        this.offer([{ seq, turn: typeof msg.turn === 'number' ? msg.turn : null, ref: typeof msg.ref === 'string' ? msg.ref : null, directive: d }]);
        return;
      }
      case 'hello': {
        const serverLast = typeof msg.lastDirectiveSeq === 'number' ? msg.lastDirectiveSeq : 0;
        if (serverLast > this.seqr.lastSeq) this.armGapFill(); // resume replay should cover it; fill if not
        return;
      }
      case 'error':
        this.log(`server error: ${String(msg.code ?? 'unknown')}`);
        if (msg.retryable === false) this.ev.status({ kind: 'live', connected: this.isOpen(), sessionId: this.id, detail: `Server error: ${String(msg.code ?? 'unknown')}` });
        return;
      default:
        return;
    }
  }

  /** Feed REST replies (context/utterance/control/stt submit/directives-after) through the sequencer. */
  ingest(raw: unknown): void {
    const envs: Envelope[] = [];
    for (const x of parseDirectives(raw)) {
      if (x.seq === null) this.apply({ seq: this.seqr.lastSeq, turn: x.turn ?? null, directive: x.directive });
      else envs.push({ seq: x.seq, turn: x.turn ?? null, ref: x.ref ?? null, directive: x.directive });
    }
    if (envs.length) this.offer(envs);
  }

  private offer(envs: Envelope[]): void {
    const ready = this.seqr.accept(envs);
    for (const e of ready) this.apply(e);
    if (ready.length) this.send({ type: 'ack', seq: this.seqr.lastSeq });
    if (this.seqr.hasGap) this.armGapFill();
  }

  private armGapFill(): void {
    if (this.gapTimer) return;
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      void this.fillGap();
    }, this.deps.gapFillMs ?? 1500);
  }

  private async fillGap(): Promise<void> {
    if (!this.token || !this.id || this.closed) return;
    const before = this.seqr.lastSeq;
    try {
      const r = await this.deps.api.directivesAfter(this.token, this.id, before);
      this.ingest(r);
    } catch {
      /* network — try again on the next event */
    }
    if (this.seqr.hasGap && this.seqr.lastSeq === before) {
      const released = this.seqr.skipGap();
      for (const e of released) this.apply(e);
      if (released.length) this.send({ type: 'ack', seq: this.seqr.lastSeq });
      this.log(`gap skipped after ${before}`);
    }
  }

  private apply(e: Envelope): void {
    if (!this.gate.admit(e.directive, e.turn)) {
      this.log(`dropped stale ${e.directive.type} (turn ${e.turn})`);
      return;
    }
    this.ev.directive(e.directive, e.seq, { seq: e.seq, turn: e.turn, ref: e.ref ?? null });
  }

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === OPEN;
  }

  private send(msg: Record<string, unknown>): boolean {
    if (!this.isOpen()) return false;
    try {
      this.ws!.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────── outbound

  /** Queue a frame body; it is sent immediately when possible, otherwise merged into the next one. */
  sendContext(frame: Omit<ContextFrame, 'sessionId' | 'seq'>): void {
    this.pendingFrame = mergeFrames(this.pendingFrame, frame);
    this.flushFrame();
  }

  private flushFrame(): void {
    if (!this.pendingFrame || !this.id) return;
    // Frame seq only has to be monotonic (the server ignores out-of-order frames); gaps are fine.
    if (this.isOpen() && this.send({ type: 'context', ...this.pendingFrame, sessionId: this.id, seq: ++this.frameSeq })) {
      this.pendingFrame = null;
      return;
    }
    if (this.restInFlight || !this.token || !this.networkUp) return;
    this.restInFlight = true;
    const sending = this.pendingFrame;
    this.pendingFrame = null;
    const restFrame: ContextFrame = { ...sending, sessionId: this.id, seq: ++this.frameSeq };
    this.deps.api
      .context(this.token, this.id, restFrame)
      .then((r) => {
        if (this.health !== 'online') this.setHealth('degraded', 'Realtime channel down, using REST fallback');
        this.ingest(r);
      })
      .catch(() => {
        // Keep the fixes (merged ahead of anything newer) for the next attempt.
        this.pendingFrame = this.pendingFrame ? mergeFrames(sending, this.pendingFrame) : sending;
        this.setHealth('offline', 'API unreachable');
      })
      .finally(() => (this.restInFlight = false));
  }

  sendControl(action: ControlAction, extra: Record<string, unknown> = {}): void {
    if (action === 'interrupt') this.gate.bargeIn();
    const body = { action, at: this.now(), ...extra };
    if (this.send({ type: 'control', ...body })) return;
    if (this.token && this.id)
      this.deps.api
        .control(this.token, this.id, body)
        .then((r) => this.ingest(r))
        .catch(() => undefined);
  }

  /** Mark the start of a local barge-in (drops in-flight audio of the current turns). */
  bargeIn(): void {
    this.gate.bargeIn();
  }

  sendUtterance(text: string, speechEndAt: number, sttProvider = 'device', utteranceId?: string): void {
    const u = { text, speechEndAt, sttProvider, utteranceId: utteranceId ?? this.newId() };
    this.outbox.set(u.utteranceId, u);
    this.deliverUtterance(u);
  }

  private deliverUtterance(u: { text: string; speechEndAt: number; sttProvider: string; utteranceId: string }): void {
    if (this.send({ type: 'utterance', ...u })) {
      this.outbox.delete(u.utteranceId);
      return;
    }
    if (!this.token || !this.id || !this.networkUp) return; // stays in the outbox until reconnect
    this.deps.api
      .utterance(this.token, this.id, u)
      .then((r) => {
        this.outbox.delete(u.utteranceId);
        this.ingest(r);
      })
      .catch(() => undefined);
  }

  /**
   * Hybrid voice (D-010): upload a recorded clip to /v1/stt with `submit=1` so the server runs it as
   * an utterance (idempotent utteranceId); the returned directives go through the sequencer.
   * Resolves to the transcript, or null when the upload failed (caller shows a retry/typing hint).
   */
  async submitAudio(audio: unknown, contentType: string, durationS: number): Promise<string | null> {
    if (!this.token || !this.id) return null;
    const utteranceId = this.newId();
    try {
      const r = await this.deps.api.stt(this.token, audio, contentType, { sessionId: this.id, locale: this.opts?.locale, durationS, submit: true, utteranceId });
      if (r.directives) this.ingest(r.directives);
      return typeof r.text === 'string' ? r.text : '';
    } catch {
      return null;
    }
  }

  private flushOutbox(): void {
    for (const u of [...this.outbox.values()]) this.deliverUtterance(u);
  }

  get pendingUtterances(): number {
    return this.outbox.size;
  }

  sendAudioProgress(p: AudioProgressMsg): void {
    if (this.send({ type: 'audio_progress', ...p })) return;
    // Only terminal states matter for REST (resume/abandon decisions); 'playing' ticks are dropped.
    if (p.state !== 'playing' && this.token && this.id && this.networkUp)
      this.deps.api
        .audioProgress(this.token, this.id, p)
        .then((r) => this.ingest(r))
        .catch(() => undefined);
  }

  setGuide(guideId: string): void {
    // Guide changes take effect for the next session on the server; ask via the conversation channel meanwhile.
    this.sendUtterance(`change guide to ${guideId}`, this.now(), 'ui');
  }
  setTalkativeness(n: number): void {
    const steps = Math.max(-2, Math.min(2, Math.round(n)));
    for (let i = 0; i < Math.abs(steps); i++) this.sendControl(steps < 0 ? 'quieter' : 'chattier');
  }
  setLocale(): void {
    /* locale is fixed per server session; applied on the next session */
  }

  async reset(opts: SessionOptions): Promise<void> {
    const token = this.token;
    const id = this.id;
    this.close();
    if (token && id) this.deps.api.endSession(token, id).catch(() => undefined);
    await this.start(opts);
  }

  /** End the server session (best effort) and close. */
  async end(): Promise<void> {
    const token = this.token;
    const id = this.id;
    this.close();
    if (token && id) await this.deps.api.endSession(token, id).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.gapTimer = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    this.health = 'offline';
  }

  get options(): SessionOptions | null {
    return this.opts;
  }
}
