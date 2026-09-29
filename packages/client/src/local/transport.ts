/**
 * "Offline demo mode" transport: the core pipeline runs on the client over fixture data (D-005).
 * The data loader is injected (web fetches static JSON; mobile bundles it).
 */
import type { ContextFrame, Directive } from '@city/core';
import { LocalEngine } from './engine.js';
import type { DemoData } from './fixtures.js';
import type { AudioProgressMsg, ControlAction, SessionOptions, Transport, TransportEvents } from '../types.js';

export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  private engine: LocalEngine | null = null;
  private seq = 0;
  private queue: Array<() => void> = [];

  constructor(
    private readonly ev: TransportEvents,
    private readonly load: () => Promise<DemoData>,
    private readonly detail = 'Core pipeline running on this device over fixture data',
  ) {}

  get sessionId(): string | null {
    return this.engine?.sessionId ?? null;
  }

  async start(opts: SessionOptions): Promise<void> {
    const data = await this.load();
    this.engine = new LocalEngine(data, opts, {
      directive: (d: Directive) => {
        const seq = ++this.seq;
        this.ev.directive(d, seq, { seq, turn: null, ref: null });
      },
      debug: (e) => this.ev.debug(e),
    });
    this.ev.status({ kind: 'local', connected: true, sessionId: this.engine.sessionId, detail: this.detail });
    for (const f of this.queue.splice(0)) f();
  }

  private run(f: (e: LocalEngine) => void): void {
    if (this.engine) f(this.engine);
    else this.queue.push(() => this.engine && f(this.engine));
  }

  sendContext(frame: Omit<ContextFrame, 'sessionId' | 'seq'>): void {
    this.run((e) => e.ingest(frame));
  }
  sendControl(action: ControlAction): void {
    this.run((e) => e.control(action));
  }
  sendUtterance(text: string): void {
    this.run((e) => (text.trim() ? e.utterance(text) : e.endListening()));
  }
  sendAudioProgress(p: AudioProgressMsg): void {
    this.run((e) => e.audioProgress(p));
  }
  sayFinished(): void {
    this.run((e) => e.sayFinished());
  }
  setGuide(id: string): void {
    this.run((e) => e.setGuide(id));
  }
  setTalkativeness(n: number): void {
    this.run((e) => e.setTalkativeness(n));
  }
  setLocale(locale: string, units: 'metric' | 'imperial'): void {
    this.run((e) => e.setLocale(locale, units));
  }
  async reset(opts: SessionOptions): Promise<void> {
    this.run((e) => e.reset(opts));
    if (this.engine) this.ev.status({ kind: 'local', connected: true, sessionId: this.engine.sessionId, detail: this.detail });
  }
  close(): void {
    this.engine = null;
  }
}
