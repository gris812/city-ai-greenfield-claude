/** Web Speech API push-to-talk wrapper. Falls back to text input where unsupported. */
interface SRResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SR {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function ctor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function sttSupported(): boolean {
  return ctor() !== null;
}

export interface SttHandlers {
  partial(text: string): void;
  final(text: string, speechEndAt: number): void;
  error(code: string): void;
  end(): void;
}

export class PushToTalk {
  private rec: SR | null = null;
  private finalText = '';
  private delivered = false;

  constructor(private readonly h: SttHandlers) {}

  start(lang: string): boolean {
    const C = ctor();
    if (!C) return false;
    this.abort();
    const r = new C();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    this.finalText = '';
    this.delivered = false;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) this.finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      this.h.partial((this.finalText + interim).trim());
    };
    r.onerror = (e) => this.h.error(e.error);
    r.onend = () => {
      if (!this.delivered) {
        this.delivered = true;
        this.h.final(this.finalText.trim(), Date.now());
      }
      this.h.end();
      this.rec = null;
    };
    try {
      r.start();
    } catch {
      return false;
    }
    this.rec = r;
    return true;
  }

  /** Release (push-to-talk): stop listening and deliver what was heard. */
  stop(): void {
    this.rec?.stop();
  }

  abort(): void {
    if (this.rec) {
      this.delivered = true;
      this.rec.abort();
      this.rec = null;
    }
  }
}
