import type { ContextFrame, Directive } from '@city/core';
import { LocalEngine } from '../local/engine';
import { loadDemoData } from '../local/demo-data';
import type { AudioProgressMsg, ControlAction, SessionOptions, Transport, TransportEvents } from './types';

/** "Offline demo mode": the core pipeline runs in this tab over fixture data (D-005). */
export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  private engine: LocalEngine | null = null;
  private seq = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly ev: TransportEvents) {}

  get sessionId(): string | null {
    return this.engine?.sessionId ?? null;
  }

  async start(opts: SessionOptions): Promise<void> {
    const data = await loadDemoData();
    this.engine = new LocalEngine(data, opts, {
      directive: (d: Directive) => this.ev.directive(d, ++this.seq),
      debug: (e) => this.ev.debug(e),
    });
    this.ev.status({ kind: 'local', connected: true, sessionId: this.engine.sessionId, detail: 'Core pipeline running in this browser over fixture data' });
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
    if (this.engine) this.ev.status({ kind: 'local', connected: true, sessionId: this.engine.sessionId });
  }
  close(): void {
    this.engine = null;
  }
}
