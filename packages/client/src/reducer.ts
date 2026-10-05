/**
 * Directive reducer — pure `(view, directive) → view` for everything a client renders from
 * server directives (D-002: the client renders, it does not decide). Audio side effects
 * (start/stop playback) are performed by the caller alongside the reducer; this module only
 * derives the view state, so web and mobile present identical semantics and it is unit-tested.
 */
import type { DensityClass, Directive, LatLng, MapAction, MovementRegime, PlaceKind, SilenceReason } from '@city/core';
import type { Dict } from './i18n.js';

export type AudioMode = 'server' | 'device' | 'text';

export interface NowPlaying {
  planId: string;
  placeId: string;
  placeName: string;
  segments: Array<{ index: number; text: string; durationMs: number; audioUrl: string | null }>;
  segmentIndex: number;
  /** 0..1 within the current segment. */
  segmentProgress: number;
  status: 'playing' | 'paused' | 'interrupted';
  spatialCue: string | null;
  audio: AudioMode;
  bridgeText: string | null;
}

export interface CompanionView {
  regime: MovementRegime;
  density: DensityClass;
  driveSafe: boolean;
  simulated: boolean;
  silence: SilenceReason | null;
  nowPlaying: NowPlaying | null;
  caption: { text: string; purpose: 'answer' | 'ack' | 'error'; at: number; audioUrl: string | null } | null;
  card: { placeId: string; name: string; kind: PlaceKind; location: LatLng; spatialCue: string | null } | null;
  focus: { placeId: string; name: string; location: LatLng } | null;
  results: Extract<MapAction, { kind: 'show_results' }>['results'] | null;
  navigate: Extract<Directive, { type: 'navigate_handoff' }> | null;
  /** Server asked to open listening (never honoured automatically while driving — D-008). */
  listenRequest: { mode: 'push_to_talk' | 'open'; timeoutMs: number; at: number } | null;
  directiveCount: number;
}

export function initialView(): CompanionView {
  return {
    regime: 'unknown',
    density: 'urban',
    driveSafe: false,
    simulated: false,
    silence: null,
    nowPlaying: null,
    caption: null,
    card: null,
    focus: null,
    results: null,
    navigate: null,
    listenRequest: null,
    directiveCount: 0,
  };
}

export function reduceDirective(v: CompanionView, d: Directive, now: number): CompanionView {
  const n = { ...v, directiveCount: v.directiveCount + 1 };
  switch (d.type) {
    case 'state':
      return { ...n, regime: d.regime, density: d.density, driveSafe: d.driveSafe, simulated: d.simulated, silence: d.silence ?? null, listenRequest: d.driveSafe ? null : n.listenRequest };
    case 'play': {
      const card = v.card && v.card.placeId === d.placeId ? v.card : null;
      return {
        ...n,
        nowPlaying: {
          planId: d.planId,
          placeId: d.placeId,
          placeName: d.placeName,
          segments: [...d.segments].sort((a, b) => a.index - b.index).map((s) => ({ index: s.index, text: s.text, durationMs: s.durationMs, audioUrl: s.audioUrl })),
          segmentIndex: d.startAt.segmentIndex,
          segmentProgress: 0,
          status: 'playing',
          spatialCue: card?.spatialCue ?? null,
          audio: d.segments.some((s) => s.audioUrl) ? 'server' : 'device',
          bridgeText: d.bridgeText ?? null,
        },
        caption: null,
        results: null,
      };
    }
    case 'stop_audio': {
      const np = v.nowPlaying;
      if (np && d.reason === 'user_pause') return { ...n, nowPlaying: { ...np, status: 'paused' } };
      if (np && d.reason !== 'preempt') return { ...n, nowPlaying: null, caption: null };
      return { ...n, caption: null };
    }
    case 'say':
      // D-020: an appended sentence of a streamed answer extends the caption instead of replacing it.
      if (d.append && v.caption) return { ...n, caption: { ...v.caption, text: `${v.caption.text} ${d.text}` } };
      return { ...n, caption: { text: d.text, purpose: d.purpose, at: now, audioUrl: d.audioUrl } };
    case 'card':
      return { ...n, card: { placeId: d.placeId, name: d.name, kind: d.kind, location: d.location, spatialCue: d.spatialCue } };
    case 'map':
      switch (d.action.kind) {
        case 'focus_place':
          return { ...n, focus: { placeId: d.action.placeId, name: d.action.name, location: d.action.location } };
        case 'show_results':
          return { ...n, results: d.action.results };
        case 'clear':
          return { ...n, focus: null, results: null, card: null };
        case 'follow_user':
          return { ...n, focus: null };
        default:
          return n;
      }
    case 'listen':
      return v.driveSafe ? n : { ...n, listenRequest: { mode: d.mode, timeoutMs: d.timeoutMs, at: now } };
    case 'navigate_handoff':
      return { ...n, navigate: d };
    default:
      return n;
  }
}

/** Local player feedback folded into the view (segment advanced, output mode, finished). */
export function reducePlayback(v: CompanionView, e: { planId: string; segmentIndex?: number; progress?: number; audio?: AudioMode; status?: NowPlaying['status'] | 'finished' }): CompanionView {
  const np = v.nowPlaying;
  if (!np || np.planId !== e.planId) return v;
  if (e.status === 'finished') return { ...v, nowPlaying: null };
  return {
    ...v,
    nowPlaying: {
      ...np,
      segmentIndex: e.segmentIndex ?? np.segmentIndex,
      segmentProgress: e.progress ?? (e.segmentIndex !== undefined && e.segmentIndex !== np.segmentIndex ? 0 : np.segmentProgress),
      audio: e.audio ?? np.audio,
      status: e.status ?? np.status,
      bridgeText: e.segmentIndex !== undefined ? null : np.bridgeText,
    },
  };
}

/**
 * Drive HUD (E1): exactly one glanceable line — never a list, never body copy.
 * Priority: listening > speaking (place name) > answer caption > silence reason > regime.
 */
export function driveStatusLine(v: CompanionView, t: Dict, listening: boolean): string {
  if (listening) return t.listening;
  if (v.nowPlaying) return v.nowPlaying.status === 'playing' ? v.nowPlaying.placeName : `${t.paused} · ${v.nowPlaying.placeName}`;
  if (v.caption) return t.answering;
  if (v.silence) return t.silence[v.silence] ?? t.quietTitle;
  return t.regime[v.regime] ?? t.regime.unknown ?? '';
}
