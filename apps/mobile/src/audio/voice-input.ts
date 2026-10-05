/**
 * Push-to-talk voice input (D-010 hybrid voice).
 *  - "device": the OS speech recognizer via expo-speech-recognition (lowest latency; on-device
 *    model when the platform supports it). Partial results stream into the listening sheet.
 *  - "server": record AAC/m4a with expo-audio and POST it to /v1/stt (submitted as an utterance
 *    server-side with an idempotent utteranceId).
 *  - "auto" (default): device when available, else server; a device-recognizer failure (no
 *    service, network, language) falls back to server recording on the next press.
 * Listening is only ever opened by an explicit user action (D-008).
 */
import { AudioModule, AudioQuality, getRecordingPermissionsAsync, IOSOutputFormat, requestRecordingPermissionsAsync, type AudioRecorder, type RecordingOptions } from 'expo-audio';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { SttMode } from '../logic/settings';
import { configurePlayback, configureRecording } from './session';

export type VoiceEngine = 'device' | 'server';

export interface VoiceInputEvents {
  partial(text: string): void;
  /** Final transcript (device) or the recorded clip for server STT. */
  final(r: { engine: 'device'; text: string; speechEndAt: number } | { engine: 'server'; uri: string; durationS: number; speechEndAt: number }): void;
  error(code: 'permission' | 'unavailable' | 'no_speech' | 'failed', engine: VoiceEngine): void;
}

/** Voice-optimised AAC (mono, 16 kHz, 48 kbps): ~6 KB/s, well under the 2 MB upload limit. */
const VOICE_PRESET: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 48000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac', audioSource: 'voice_recognition' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH },
  web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
};

const MAX_RECORD_MS = 30_000;

export class VoiceInput {
  private active: VoiceEngine | null = null;
  private recorder: AudioRecorder | null = null;
  private recStartedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private subs: Array<{ remove(): void }> = [];
  private lastPartial = '';
  private deviceBroken = false;
  private finished = false;

  constructor(private readonly ev: VoiceInputEvents) {}

  deviceAvailable(): boolean {
    if (this.deviceBroken) return false;
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  }

  /** Which engine a press would use right now. */
  pick(pref: SttMode, serverAllowed: boolean): VoiceEngine | null {
    const device = this.deviceAvailable();
    if (pref === 'device') return device ? 'device' : serverAllowed ? 'server' : null;
    if (pref === 'server') return serverAllowed ? 'server' : device ? 'device' : null;
    return device ? 'device' : serverAllowed ? 'server' : null;
  }

  get listening(): boolean {
    return this.active !== null;
  }

  async start(lang: string, pref: SttMode, serverAllowed: boolean): Promise<VoiceEngine | null> {
    this.abort();
    const engine = this.pick(pref, serverAllowed);
    if (!engine) {
      this.ev.error('unavailable', 'device');
      return null;
    }
    this.finished = false;
    this.lastPartial = '';
    return engine === 'device' ? this.startDevice(lang, serverAllowed) : this.startServer();
  }

  private async startDevice(lang: string, serverAllowed: boolean): Promise<VoiceEngine | null> {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        this.ev.error('permission', 'device');
        return null;
      }
    } catch {
      this.deviceBroken = true;
      return serverAllowed ? this.startServer() : (this.ev.error('unavailable', 'device'), null);
    }
    this.active = 'device';
    this.subs.push(
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        const text = e.results[0]?.transcript ?? '';
        if (e.isFinal) this.emitDeviceFinal(text);
        else {
          this.lastPartial = text;
          this.ev.partial(text);
        }
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        const code = String(e.error);
        if (code === 'no-speech' || code === 'speech-timeout' || code === 'aborted') this.emitDeviceFinal(this.lastPartial);
        else {
          if (code === 'service-not-allowed' || code === 'language-not-supported' || code === 'network') this.deviceBroken = true;
          this.cleanup();
          this.ev.error(code === 'not-allowed' ? 'permission' : 'failed', 'device');
        }
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => this.emitDeviceFinal(this.lastPartial)),
    );
    let onDevice = false;
    try {
      onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    } catch {
      onDevice = false;
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        requiresOnDeviceRecognition: onDevice,
        contextualStrings: ['Telvey', 'skip', 'not that one', 'quieter', 'coffee'],
        iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'duckOthers'], mode: 'measurement' },
      });
    } catch {
      this.cleanup();
      this.deviceBroken = true;
      return serverAllowed ? this.startServer() : (this.ev.error('unavailable', 'device'), null);
    }
    return 'device';
  }

  private emitDeviceFinal(text: string): void {
    if (this.finished || this.active !== 'device') return;
    this.finished = true;
    this.cleanup();
    const t = text.trim();
    if (t) this.ev.final({ engine: 'device', text: t, speechEndAt: Date.now() });
    else this.ev.error('no_speech', 'device');
  }

  private async startServer(): Promise<VoiceEngine | null> {
    try {
      const perm = await getRecordingPermissionsAsync();
      const granted = perm.granted || (await requestRecordingPermissionsAsync()).granted;
      if (!granted) {
        this.ev.error('permission', 'server');
        return null;
      }
      await configureRecording(true);
      const rec = new AudioModule.AudioRecorder(VOICE_PRESET);
      await rec.prepareToRecordAsync();
      rec.record();
      this.recorder = rec;
      this.recStartedAt = Date.now();
      this.active = 'server';
      this.maxTimer = setTimeout(() => this.stop(), MAX_RECORD_MS);
      return 'server';
    } catch {
      await configureRecording(false);
      await configurePlayback();
      this.ev.error('failed', 'server');
      return null;
    }
  }

  /** User released / tapped again: finish and deliver. */
  stop(): void {
    if (this.active === 'device') {
      try {
        ExpoSpeechRecognitionModule.stop(); // → final 'result' / 'end'
      } catch {
        this.emitDeviceFinal(this.lastPartial);
      }
      return;
    }
    if (this.active === 'server' && this.recorder) {
      const rec = this.recorder;
      const speechEndAt = Date.now();
      const durationS = (speechEndAt - this.recStartedAt) / 1000;
      this.recorder = null;
      this.active = null;
      if (this.maxTimer) clearTimeout(this.maxTimer);
      this.maxTimer = null;
      void (async () => {
        try {
          await rec.stop();
        } catch {
          /* ignore */
        }
        await configureRecording(false);
        await configurePlayback();
        if (rec.uri && durationS >= 0.4) this.ev.final({ engine: 'server', uri: rec.uri, durationS, speechEndAt });
        else this.ev.error('no_speech', 'server');
      })();
    }
  }

  /** Cancel without delivering anything. */
  abort(): void {
    if (this.active === 'device') {
      this.finished = true;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        /* ignore */
      }
    }
    if (this.recorder) {
      const rec = this.recorder;
      this.recorder = null;
      rec.stop().catch(() => undefined);
      void configureRecording(false).then(configurePlayback);
    }
    this.cleanup();
  }

  private cleanup(): void {
    for (const s of this.subs.splice(0)) s.remove();
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.maxTimer = null;
    this.active = null;
  }
}
