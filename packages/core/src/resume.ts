/**
 * ResumePolicy (D-009): after an interruption, resume exactly at the START of the
 * interrupted segment (optionally with a bridge phrase), or abandon deterministically.
 *
 * Order: superseded → target passed (driving/cycling) / moved away (walking) → stale →
 * nearly done → resume.
 */
import type { ActiveStoryState, CandidateGeometry, Id, JourneyContext, ResumeDecision } from './contracts.js';
import { isDriving } from './regime.js';

export const RESUME = {
  /** Walking/stationary: abandon when the target is farther than this. */
  WALK_MAX_DISTANCE_M: 400,
  /** Moving regimes: abandon when target is behind by more than this (beyond its extent). */
  BEHIND_TOLERANCE_M: 50,
  STALE_WALK_MS: 3 * 60_000,
  STALE_DRIVE_MS: 90_000,
  /** Fraction of segments completed (before the interrupted one) considered "nearly done". */
  NEARLY_DONE_FRACTION: 0.85,
  /** Interruptions longer than this get a bridge phrase ("As I was saying…"). */
  BRIDGE_AFTER_MS: 8000,
} as const;

export interface ResumeOptions {
  /** Most recent plan id started by the session; ≠ story.planId → superseded. */
  currentPlanId?: Id | null;
  /** True if the Guide spoke an answer during the interruption. */
  answerSpokenSince?: boolean;
  /** Target extent (m) for 'behind' tolerance of large features. */
  targetExtentM?: number;
}

export function decideResume(story: ActiveStoryState, ctx: Pick<JourneyContext, 'now' | 'regime'>, target: CandidateGeometry | null, opts: ResumeOptions = {}): ResumeDecision {
  if (opts.currentPlanId && opts.currentPlanId !== story.planId) return { action: 'abandon', reason: 'superseded' };
  if (story.status === 'completed' || story.status === 'abandoned' || story.status === 'skipped') return { action: 'abandon', reason: 'user_moved_on' };

  const regime = ctx.regime.regime;
  const moving = isDriving(regime) || regime === 'cycling';
  if (target) {
    if (moving) {
      const along = target.alongTrackM;
      const extent = opts.targetExtentM ?? 0;
      if (along !== null && along + extent < -RESUME.BEHIND_TOLERANCE_M) return { action: 'abandon', reason: 'target_passed' };
      if (along === null && target.relative === 'behind' && target.distanceM - extent > RESUME.BEHIND_TOLERANCE_M) return { action: 'abandon', reason: 'target_passed' };
    } else if (target.distanceM - (opts.targetExtentM ?? 0) > RESUME.WALK_MAX_DISTANCE_M) {
      return { action: 'abandon', reason: 'target_passed' };
    }
  }

  const interruptedAt = story.interruptedAt ?? ctx.now;
  const pausedMs = Math.max(0, ctx.now - interruptedAt);
  const staleMs = isDriving(regime) ? RESUME.STALE_DRIVE_MS : RESUME.STALE_WALK_MS;
  if (pausedMs > staleMs) return { action: 'abandon', reason: 'stale' };

  if (story.segmentCount > 0 && story.segmentIndex / story.segmentCount >= RESUME.NEARLY_DONE_FRACTION) return { action: 'abandon', reason: 'nearly_done' };

  const fromSegment = Math.max(0, Math.min(story.segmentIndex, Math.max(0, story.segmentCount - 1)));
  return { action: 'resume', fromSegment, bridge: pausedMs > RESUME.BRIDGE_AFTER_MS || (opts.answerSpokenSince ?? false) };
}
