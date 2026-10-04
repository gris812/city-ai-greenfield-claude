import type { ContextFrame, Directive } from '@city/core';
import { api, ApiError, parseDirectives, wsUrlFor } from '../api';
import { config } from '../config';
import type { AudioProgressMsg, ControlAction, SessionOptions, Transport, TransportEvents } from './types';

const GUEST_KEY = 'telvey.guest.v1';

function readGuest(): { guestId: string; token: string } | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? (JSON.parse(raw) as { guestId: string; token: string }) : null;
  } catch {
    return null;
  }
}
function writeGuest(g: { guestId: string; token: string } | null): void {
  try {
    if (g) localStorage.setItem(GUEST_KEY, JSON.stringify(g));
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function guestToken(): Promise<string> {
  const g = readGuest();
  if (g?.token) return g.token;
  const created = await api.guest();
  writeGuest(created);
  return created.token;
}
export function forgetGuest(): void {
  writeGuest(null);
}

/**
 * Live transport (docs/API.md): one WebSocket per session with ACKed, monotonic
 * directiveSeq; REST fallbacks when the socket is down (degraded, still functional).
 */
export class LiveTransport implements Transport {
  readonly kind = 'live' as const;
  private token: string | null = null;
  private id: string | null = null;
  private ws: WebSocket | null = null;
  private wsUrl: string | null = null;
  private lastSeq = 0;
  private frameSeq = 0;
  private pending: Omit<ContextFrame, 'sessionId' | 'seq'> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private closed = false;
  private restInFlight = false;

  constructor(private readonly ev: TransportEvents) {}

  get sessionId(): string | null {
    return this.id;
  }

  async start(opts: SessionOptions): Promise<void> {
    this.closed = false;
    try {
      this.token = await guestToken();
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(0, 'unreachable', String(e));
    }
    let created;
    try {
      created = await api.createSession(this.token, { guideId: opts.guideId, locale: opts.locale, units: opts.units, simulated: opts.simulated, client: { platform: 'web', appVersion: config.buildSha, capabilities: ['say_append'] } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        forgetGuest();
        this.token = await guestToken();
        created = await api.createSession(this.token, { guideId: opts.guideId, locale: opts.locale, units: opts.units, simulated: opts.simulated, client: { platform: 'web', appVersion: config.buildSha, capabilities: ['say_append'] } });
      } else throw e;
    }
    this.id = created.sessionId;
    this.wsUrl = wsUrlFor(created, this.token);
    this.lastSeq = 0;
    this.connect();
    this.flushTimer = setInterval(() => this.flush(), 1000);
    this.pingTimer = setInterval(() => this.send({ type: 'ping', t: Date.now() }), 20_000);
    if (opts.talkativeness !== 0) this.setTalkativeness(opts.talkativeness);
  }

  private connect(): void {
    if (!this.wsUrl || this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectDelay = 1000;
      if (this.lastSeq > 0) this.send({ type: 'resume', lastDirectiveSeq: this.lastSeq });
      this.ev.status({ kind: 'live', connected: true, sessionId: this.id, degraded: false });
    };
    ws.onmessage = (m) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(m.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === 'directive') {
        const d = (msg.directive ?? msg.payload) as Directive | undefined;
        const seq = typeof msg.directiveSeq === 'number' ? msg.directiveSeq : typeof msg.seq === 'number' ? msg.seq : null;
        if (!d) return;
        if (seq !== null) {
          if (seq <= this.lastSeq) return; // E3: never replay an already-applied directive
          this.lastSeq = seq;
          this.send({ type: 'ack', seq });
        }
        this.deliver(d, seq ?? this.lastSeq);
      } else if (msg.type === 'error') {
        this.ev.status({ kind: 'live', connected: true, sessionId: this.id, detail: `Server error: ${String(msg.code ?? 'unknown')}` });
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      this.ev.status({ kind: 'live', connected: false, sessionId: this.id, degraded: true, detail: 'Realtime channel down, using REST fallback' });
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const d = this.reconnectDelay;
    this.reconnectDelay = Math.min(15_000, d * 2);
    setTimeout(() => this.connect(), d + Math.random() * 300);
  }

  private deliver(d: Directive, seq: number): void {
    this.ev.directive(d, seq);
    if (d.type === 'state') {
      this.ev.debug({ wall: Date.now(), t: Date.now(), regime: d.regime, density: d.density, speedMps: 0, decision: d.silence ? 'silence' : 'state', reason: d.silence ?? null, source: 'server' });
    } else if (d.type === 'play') {
      this.ev.debug({ wall: Date.now(), t: Date.now(), regime: 'unknown', density: 'urban', speedMps: 0, decision: 'start_story', target: d.placeName, source: 'server', note: 'regime/density: see last state' });
    }
  }

  private open(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private send(msg: Record<string, unknown>): boolean {
    if (!this.open()) return false;
    try {
      this.ws!.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  sendContext(frame: Omit<ContextFrame, 'sessionId' | 'seq'>): void {
    if (!this.pending) this.pending = { ...frame, fixes: [...frame.fixes] };
    else this.pending = { ...frame, fixes: [...this.pending.fixes, ...frame.fixes], route: frame.route ?? this.pending.route ?? null };
  }

  private flush(): void {
    if (!this.pending || !this.id) return;
    const frame: ContextFrame = { ...this.pending, sessionId: this.id, seq: ++this.frameSeq };
    this.pending = null;
    if (this.send({ type: 'context', ...frame })) return;
    if (this.restInFlight || !this.token) return;
    this.restInFlight = true;
    api
      .context(this.token, this.id, frame)
      .then((r) => {
        for (const x of parseDirectives(r)) {
          if (x.seq !== null && x.seq <= this.lastSeq) continue;
          if (x.seq !== null) this.lastSeq = x.seq;
          this.deliver(x.directive, x.seq ?? this.lastSeq);
        }
      })
      .catch(() => this.ev.status({ kind: 'live', connected: false, sessionId: this.id, degraded: true, detail: 'API unreachable' }))
      .finally(() => (this.restInFlight = false));
  }

  sendControl(action: ControlAction, extra: Record<string, unknown> = {}): void {
    const body = { action, at: Date.now(), ...extra };
    if (this.send({ type: 'control', ...body })) return;
    if (this.token && this.id)
      api
        .control(this.token, this.id, body)
        .then((r) => parseDirectives(r).forEach((x) => this.deliver(x.directive, x.seq ?? this.lastSeq)))
        .catch(() => undefined);
  }

  sendUtterance(text: string, speechEndAt: number): void {
    const body = { text, speechEndAt, sttProvider: 'web_speech' };
    if (this.send({ type: 'utterance', ...body })) return;
    if (this.token && this.id)
      api
        .utterance(this.token, this.id, body)
        .then((r) => parseDirectives(r).forEach((x) => this.deliver(x.directive, x.seq ?? this.lastSeq)))
        .catch(() => undefined);
  }

  sendAudioProgress(p: AudioProgressMsg): void {
    this.send({ type: 'audio_progress', ...p });
  }

  setGuide(guideId: string): void {
    // Guide changes take effect for the next session on the server; ask via the conversation channel meanwhile.
    this.send({ type: 'utterance', text: `change guide to ${guideId}`, speechEndAt: Date.now(), sttProvider: 'ui' });
  }
  setTalkativeness(n: number): void {
    // Server-side talkativeness is adjusted in steps via controls.
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
    if (token && id) api.endSession(token, id).catch(() => undefined);
    await this.start(opts);
  }

  close(): void {
    this.closed = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.flushTimer = null;
    this.pingTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
