/**
 * Audio session policy: spoken-word audio that DUCKS other audio (navigation prompts, music)
 * instead of stopping it, keeps playing in the background / with the screen locked, and is
 * released (un-ducking the other apps) between stories.
 *
 * iOS: AVAudioSession playback + duckOthers; while recording we temporarily switch to
 * play-and-record (allowsRecording) and switch back afterwards.
 * Android: audio focus "may duck" (transient) via interruptionModeAndroid 'duckOthers'.
 */
import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';

let recording = false;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

export async function configurePlayback(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      interruptionModeAndroid: 'duckOthers',
      shouldPlayInBackground: true,
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    /* non-fatal: defaults still play */
  }
}

export async function configureRecording(on: boolean): Promise<void> {
  if (recording === on) return;
  recording = on;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      interruptionModeAndroid: 'duckOthers',
      shouldPlayInBackground: true,
      allowsRecording: on,
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    /* ignore */
  }
}

/** Take the session (ducks others) before speaking. */
export function acquireAudio(): void {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  setIsAudioActiveAsync(true).catch(() => undefined);
}

/** Release shortly after speech ends so navigation/music return to full volume. */
export function releaseAudioSoon(ms = 900): void {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (!recording) setIsAudioActiveAsync(false).catch(() => undefined);
  }, ms);
}
