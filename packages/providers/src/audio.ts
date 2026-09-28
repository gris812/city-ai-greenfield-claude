/**
 * Tiny audio utilities (no dependencies): MP3 frame scanning for duration, a valid silent
 * MP3 generator (fake TTS), and PCM16 → WAV wrapping (Gemini TTS returns raw PCM).
 */

const MPEG1_L3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Duration of an MP3 byte stream by walking Layer III frame headers (ID3v2 skipped). */
export function mp3DurationMs(b: Uint8Array): number {
  let i = 0;
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
    i = 10 + size;
  }
  let ms = 0;
  let guard = 0;
  while (i + 4 <= b.length && guard++ < 1_000_000) {
    if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const ver = (b[i + 1]! >> 3) & 0x3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b[i + 1]! >> 1) & 0x3; // 1 = Layer III
    const brIdx = (b[i + 2]! >> 4) & 0xf;
    const srIdx = (b[i + 2]! >> 2) & 0x3;
    const pad = (b[i + 2]! >> 1) & 0x1;
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) {
      i++;
      continue;
    }
    const sr = SR[ver]![srIdx]!;
    const kbps = (ver === 3 ? MPEG1_L3_KBPS : MPEG2_L3_KBPS)[brIdx]!;
    const samples = ver === 3 ? 1152 : 576;
    const frameLen = Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / sr) + pad;
    if (frameLen < 4) break;
    ms += (samples / sr) * 1000;
    i += frameLen;
  }
  return Math.round(ms);
}

/** Valid silent MP3 (MPEG-1 Layer III, 32 kHz, 32 kbps, mono): 144-byte frames of 36 ms. */
export function silentMp3(durationMs: number): Uint8Array {
  const frameMs = (1152 / 32000) * 1000;
  const frames = Math.max(1, Math.round(durationMs / frameMs));
  const out = new Uint8Array(frames * 144);
  for (let f = 0; f < frames; f++) {
    const o = f * 144;
    out[o] = 0xff;
    out[o + 1] = 0xfb; // MPEG-1, Layer III, no CRC
    out[o + 2] = 0x18; // 32 kbps, 32 kHz, no padding
    out[o + 3] = 0xc4; // mono, original
    // side info + main data all zero → decodes to silence
  }
  return out;
}

/** Wrap little-endian PCM16 mono into a WAV container. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o: number, s: string) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export function wavDurationMs(b: Uint8Array): number {
  if (b.length < 44) return 0;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const byteRate = v.getUint32(28, true);
  const dataLen = v.getUint32(40, true);
  return byteRate > 0 ? Math.round((dataLen / byteRate) * 1000) : 0;
}

export function audioDurationMs(b: Uint8Array, mime: string): number {
  return mime.includes('wav') ? wavDurationMs(b) : mp3DurationMs(b);
}
