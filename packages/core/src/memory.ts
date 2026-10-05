/**
 * Journey memory reducers — pure, immutable. Memory drives novelty, continuity callbacks,
 * suppression of repeats and user-set talkativeness.
 */
import type { Intent, JourneyMemory, Millis, PlaceCandidate, StoryAngle } from './contracts.js';

export const MEMORY = {
  MAX_QUESTIONS: 50,
  TALKATIVENESS_MIN: -2,
  TALKATIVENESS_MAX: 2,
} as const;

export function emptyMemory(): JourneyMemory {
  return { discussed: {}, rejected: {}, themes: {}, questions: [], storiesCompleted: 0, storiesSkipped: 0, talkativeness: 0 };
}

type PlaceLike = Pick<PlaceCandidate, 'id' | 'name' | 'kind' | 'tags'>;

function bumpThemes(themes: Record<string, number>, place: PlaceLike, angle: StoryAngle | undefined, w: number): Record<string, number> {
  const out = { ...themes };
  const keys = [...place.tags, `kind:${place.kind}`, ...(angle ? [`angle:${angle}`] : [])];
  for (const k of keys) out[k] = (out[k] ?? 0) + w;
  return out;
}

export function recordStoryStarted(m: JourneyMemory, place: PlaceLike, angle: StoryAngle, at: Millis, depth: 'mention' | 'story' | 'followup' = 'story'): JourneyMemory {
  return {
    ...m,
    discussed: {
      ...m.discussed,
      [place.id]: { placeId: place.id, placeName: place.name, at, depth, completed: false, angle, kind: place.kind, tags: [...place.tags] },
    },
    themes: bumpThemes(m.themes, place, angle, 1),
  };
}

/** A short mention (orientation line): marks the place as discussed without a story/angle. */
export function recordMention(m: JourneyMemory, place: PlaceLike, at: Millis): JourneyMemory {
  if (m.discussed[place.id]) return m;
  return {
    ...m,
    discussed: { ...m.discussed, [place.id]: { placeId: place.id, placeName: place.name, at, depth: 'mention', completed: true, kind: place.kind, tags: [...place.tags] } },
  };
}

export function recordStoryCompleted(m: JourneyMemory, placeId: string, _at: Millis): JourneyMemory {
  const d = m.discussed[placeId];
  if (!d) return { ...m, storiesCompleted: m.storiesCompleted + 1 };
  return { ...m, discussed: { ...m.discussed, [placeId]: { ...d, completed: true } }, storiesCompleted: m.storiesCompleted + 1 };
}

/** Interrupted stories stay "discussed" (not re-offered unprompted); resume is ResumePolicy's job. */
export function recordStoryInterrupted(m: JourneyMemory, placeId: string, at: Millis): JourneyMemory {
  const d = m.discussed[placeId];
  if (!d) return m;
  return { ...m, discussed: { ...m.discussed, [placeId]: { ...d, at } } };
}

/** Skip counts as a soft rejection of that place and nudges talkativeness down after repeated skips. */
export function recordStorySkipped(m: JourneyMemory, placeId: string, at: Millis): JourneyMemory {
  const skipped = m.storiesSkipped + 1;
  const next: JourneyMemory = { ...m, storiesSkipped: skipped, rejected: { ...m.rejected, [placeId]: at } };
  return skipped % 3 === 0 ? adjustTalkativeness(next, -1) : next;
}

export function recordRejected(m: JourneyMemory, placeId: string, at: Millis): JourneyMemory {
  return { ...m, rejected: { ...m.rejected, [placeId]: at } };
}

export function recordQuestion(m: JourneyMemory, text: string, intent: Intent, at: Millis): JourneyMemory {
  const qs = [...m.questions, { at, text, intent }];
  return { ...m, questions: qs.slice(-MEMORY.MAX_QUESTIONS) };
}

export function adjustTalkativeness(m: JourneyMemory, delta: number): JourneyMemory {
  const t = Math.max(MEMORY.TALKATIVENESS_MIN, Math.min(MEMORY.TALKATIVENESS_MAX, Math.round(m.talkativeness + delta)));
  return { ...m, talkativeness: t };
}

/**
 * Seed a new session's memory with cross-session history (D-023): place id → last told at
 * (epoch ms). Only the most recent `max` entries are kept; entries are never promoted to
 * `discussed` (no journey callbacks to last week's trip, only repeat suppression).
 */
export function withHistory(m: JourneyMemory, history: Readonly<Record<string, number>>, max = 2000): JourneyMemory {
  const entries = Object.entries(history)
    .filter(([id, at]) => id.length > 0 && Number.isFinite(at))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, max);
  return { ...m, history: Object.fromEntries(entries) };
}

/** Places this session told as a story or answered a follow-up on (history candidates; mentions excluded). */
export function toldPlaces(m: JourneyMemory): Array<{ placeId: string; at: number }> {
  return Object.values(m.discussed)
    .filter((d) => d.depth !== 'mention')
    .map((d) => ({ placeId: d.placeId, at: d.at }));
}
