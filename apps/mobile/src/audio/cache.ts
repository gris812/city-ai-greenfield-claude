/**
 * On-disk cache for content-addressed TTS segments (`/v1/audio/<hash>.mp3` is immutable), used
 * by the PrefetchQueue. Lives in the OS cache directory (the OS may purge it; that only costs a
 * re-download). Cleared by "Delete my data".
 */
import { Directory, File, Paths } from 'expo-file-system';

const DIR_NAME = 'telvey-audio';

function dir(): Directory {
  const d = new Directory(Paths.cache, DIR_NAME);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

function nameFor(url: string): string {
  const last = url.split('?')[0]!.split('/').pop() ?? '';
  return /^[A-Za-z0-9._-]{4,120}$/.test(last) ? last : `seg-${Math.abs(hash(url)).toString(36)}.mp3`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export async function downloadSegment(url: string): Promise<string> {
  const target = new File(dir(), nameFor(url));
  if (target.exists && (target.size ?? 0) > 0) return target.uri;
  const f = await File.downloadFileAsync(url, target, { idempotent: true });
  return f.uri;
}

export function removeCached(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* ignore */
  }
}

export function clearAudioCache(): void {
  try {
    const d = new Directory(Paths.cache, DIR_NAME);
    if (d.exists) d.delete();
  } catch {
    /* ignore */
  }
}
