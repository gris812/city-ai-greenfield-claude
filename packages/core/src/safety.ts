/**
 * Driver-safety policy (D-008) and ToolPolicy (D-003).
 *
 * SafetyState is recomputed on every frame from the regime tracker + client signals.
 * Speech *onset* is blocked while any hold reason is present; an already-playing story
 * is not cut by the director (the client ducks audio on its own for navigation prompts).
 */
import type { AudioOutputRoute, JourneyContext, Millis, MovementRegime, RegimeState, SafetyState, ToolDecision, ToolRequest } from './contracts.js';
import { isDriving } from './regime.js';

export const SAFETY = {
  /** Heading change rate above which the vehicle is maneuvering (turning). */
  MANEUVER_TURN_RATE_DEG_S: 12,
  /** Hard braking threshold. */
  MANEUVER_DECEL_MPS2: -2.5,
  /** Braking/turning only counts above this speed (parking-lot creep is not a maneuver). */
  MANEUVER_MIN_SPEED_MPS: 4,
  /** A screen touch within this window while driving holds speech onset. */
  SCREEN_INTERACTION_HOLD_MS: 8000,
  /** Nearby-search rate limit: at most N per window. */
  NEARBY_LIMIT: 3,
  NEARBY_WINDOW_MS: 60_000,
  /** Highway: interactive result lists are converted to audio-only. */
  HIGHWAY_AUDIO_ONLY_MIN_MPS: 17,
} as const;

export type SpeechHoldReason = 'maneuvering' | 'screen_interaction_while_driving' | 'no_audio_output';

export interface SafetyInputs {
  regime: RegimeState;
  now: Millis;
  lastInteractionAt?: Millis | null;
  audioRoute: AudioOutputRoute;
  appState?: 'foreground' | 'background' | 'locked';
}

export function isManeuvering(regime: RegimeState): boolean {
  if (!isDriving(regime.regime) && regime.regime !== 'cycling') return false;
  if (regime.smoothedSpeedMps < SAFETY.MANEUVER_MIN_SPEED_MPS) return false;
  return regime.turnRateDegPerS > SAFETY.MANEUVER_TURN_RATE_DEG_S || regime.accelMps2 < SAFETY.MANEUVER_DECEL_MPS2;
}

export function evaluateSafety(i: SafetyInputs): SafetyState {
  const driving = isDriving(i.regime.regime);
  const maneuvering = isManeuvering(i.regime);
  const reasons: SpeechHoldReason[] = [];
  if (maneuvering) reasons.push('maneuvering');
  if (driving && i.lastInteractionAt !== null && i.lastInteractionAt !== undefined && i.now - i.lastInteractionAt >= 0 && i.now - i.lastInteractionAt < SAFETY.SCREEN_INTERACTION_HOLD_MS) {
    reasons.push('screen_interaction_while_driving');
  }
  // Unknown audio route is NOT a hold (at highway speed it's normally car audio / Bluetooth).
  return { driveSafe: driving, maneuvering, speechHoldReasons: reasons };
}

// ─────────────────────────────────────────────── ToolPolicy

export interface ToolHistory {
  /** Timestamps of previously allowed calls, per tool. */
  calls: Partial<Record<ToolRequest['tool'], Millis[]>>;
}

export function emptyToolHistory(): ToolHistory {
  return { calls: {} };
}

export function recordToolCall(h: ToolHistory, tool: ToolRequest['tool'], at: Millis): ToolHistory {
  const prev = h.calls[tool] ?? [];
  return { calls: { ...h.calls, [tool]: [...prev.filter((t) => at - t < 10 * 60_000), at] } };
}

const INTERACTIVE_ARGS = ['interactive', 'selectable', 'list'];

/**
 * Decide whether a requested tool may run. Pure: returns allowed (possibly with
 * rewritten, safer args) or denied with a reason. LLM-requested tools are never
 * trusted more than rule-requested ones.
 */
export function decideTool(ctx: Pick<JourneyContext, 'now' | 'regime' | 'safety'> & { position?: JourneyContext['position'] }, req: ToolRequest, history: ToolHistory = emptyToolHistory()): ToolDecision {
  const regime: MovementRegime = ctx.regime.regime;
  const driving = isDriving(regime);
  const speed = ctx.regime.smoothedSpeedMps;

  switch (req.tool) {
    case 'nearby_search': {
      const recent = (history.calls.nearby_search ?? []).filter((t) => ctx.now - t < SAFETY.NEARBY_WINDOW_MS);
      if (recent.length >= SAFETY.NEARBY_LIMIT) return { allowed: false, request: req, reason: 'rate_limited' };
      if (!ctx.position) return { allowed: false, request: req, reason: 'no_fix' };
      if (driving) {
        // Results are spoken; map shows glanceable pins only; along-route bias.
        return { allowed: true, request: { ...req, args: { ...req.args, presentation: 'audio_first', maxResults: Math.min(Number(req.args.maxResults ?? 3), 3), alongRoute: true } } };
      }
      return { allowed: true, request: req };
    }
    case 'show_on_map': {
      const interactive = INTERACTIVE_ARGS.some((k) => req.args[k] === true);
      if (driving && speed >= SAFETY.HIGHWAY_AUDIO_ONLY_MIN_MPS && interactive) {
        const args: Record<string, unknown> = { ...req.args, presentation: 'audio_only' };
        for (const k of INTERACTIVE_ARGS) delete args[k];
        return { allowed: true, request: { ...req, args } };
      }
      if (driving && interactive) return { allowed: true, request: { ...req, args: { ...req.args, presentation: 'glanceable' } } };
      return { allowed: true, request: req };
    }
    case 'navigate_handoff': {
      if (ctx.safety.maneuvering) return { allowed: false, request: req, reason: 'maneuvering' };
      if (typeof req.args.lat !== 'number' || typeof req.args.lng !== 'number') return { allowed: false, request: req, reason: 'missing_destination' };
      return { allowed: true, request: req };
    }
    case 'place_details':
    case 'evidence_lookup':
      return { allowed: true, request: req };
  }
}
