/**
 * Scenario runner: trace → ingestFrame → (throttled) discovery query → FixturePlaceSource →
 * scoreCandidates → decideMoment → brief/template/grounding/segments, with simulated
 * playback time. Uses exactly the production core entry points; nothing here is
 * city-specific (A7) — scenarios differ only by trace file, guide and locale.
 */
import type {
  DensityClass,
  DiscoveryQuery,
  FactKind,
  GuideProfile,
  JourneyContext,
  LatLng,
  MomentDecision,
  MovementRegime,
  NarrativeSegment,
  PlaceCandidate,
  ScoredCandidate,
  SuppressionReason,
} from '@city/core';
import {
  buildOrientation,
  buildStoryBrief,
  checkGrounding,
  contextOf,
  decideMoment,
  densityHintFrom,
  densityProbeQueryFor,
  discoveryQueryFor,
  geometryFor,
  ingestFrame,
  isDriving,
  newJourney,
  observeDensity,
  orientationGiven,
  policyFor,
  recordDiscoveryFetch,
  round,
  scoreCandidates,
  segmentNarrative,
  shouldRefreshDensity,
  shouldRefreshDiscovery,
  storyCompleted,
  storyStarted,
  templateNarrative,
  trajectoryFor,
  wordCount,
  recordDensityProbe,
  type DensityProbeRecord,
  type DiscoveryFetchRecord,
  type JourneyState,
} from '@city/core';
import { FixtureEvidence, FixturePlaceSource, loadTrace, type TraceFile } from './fixtures.js';

export interface Scenario {
  name: string;
  trace: string;
  guide: GuideProfile;
  locale: string;
  /** Pass the trace's route polyline as a navigation RouteHint. */
  useRoute?: boolean;
  /** Acceptance scenario ids this replay provides evidence for. */
  acceptance: string[];
  description: string;
}

export interface StoryRecord {
  t: number;
  kind: 'story' | 'orientation';
  placeId: string;
  name: string;
  placeKind: string;
  regime: MovementRegime;
  density: DensityClass;
  speedMps: number;
  courseDeg: number | null;
  trajectory: string;
  relative: string;
  side: string | null;
  distanceM: number;
  alongTrackM: number | null;
  crossTrackM: number | null;
  etaS: number | null;
  /** Significance-scaled reach (look-ahead / radius) for this target at trigger time. */
  reachM: number;
  score: number;
  mode?: string;
  angle?: string;
  preempt?: boolean;
  durationBudgetS?: number;
  maxWords?: number;
  words: number;
  playedS: number;
  segments?: number;
  grounded: boolean;
  allowQuestionsToUser?: boolean;
  spatialCue?: string | null;
  text: string;
  /** Top rejected (non-clutter) candidates at this moment, with reasons (A5 evidence). */
  rejected: Array<{ id: string; name: string; reasons: SuppressionReason[] }>;
  endedAfterPassing?: boolean;
}

export interface TimelineEntry {
  t: number;
  regime: MovementRegime;
  density: DensityClass;
  speedMps: number;
  decision: MomentDecision['kind'];
  reason?: string;
  target?: string;
  best?: string | null;
  bestScore?: number | null;
  eligible: number;
  suppressed: Partial<Record<SuppressionReason, number>>;
  policy: { nearRadiusM: number; lookAheadBaseM: number; lookAheadMaxM: number; minGapS: number; speakThreshold: number; maxStoryS: number; significanceFloor: number };
  trajectory: string;
}

export interface ReplaySummary {
  scenario: string;
  acceptance: string[];
  trace: string;
  synthetic: boolean;
  guide: string;
  locale: string;
  durationS: number;
  frames: number;
  storiesStarted: number;
  orientations: number;
  preemptions: number;
  targets: Array<{ t: number; id: string; name: string; kind: 'story' | 'orientation'; regime: MovementRegime; distanceM: number; reachM: number }>;
  silenceRatio: number;
  maxSilentGapS: number;
  regimeTransitions: Array<{ t: number; from: MovementRegime; to: MovementRegime }>;
  regimeSequence: MovementRegime[];
  densitySequence: DensityClass[];
  providerQueries: { discovery: number; densityProbe: number; total: number; perHour: number; emptyResults: number; framesPerQuery: number };
  wronglyBehindTargets: number;
  endedAfterPassing: number;
  groundingFailures: number;
  utilityStories: number;
  clutterStories: number;
  sessionRestarts: number;
  memory: { discussed: number; completed: number; mentions: number };
  rejections: Record<string, { name: string; reasons: Partial<Record<SuppressionReason, number>> }>;
}

export interface ReplayResult {
  summary: ReplaySummary;
  stories: StoryRecord[];
  timeline: TimelineEntry[];
  finalState: JourneyState;
}

export interface RunOptions {
  source?: FixturePlaceSource;
  evidence?: FixtureEvidence;
  trace?: TraceFile;
  /** Timeline snapshot interval even when nothing changes (s). */
  snapshotEveryS?: number;
}

const isClutter = (p: PlaceCandidate) => p.tags.includes('synthetic_clutter');
const UTILITY = new Set(['food', 'shop', 'lodging', 'fuel', 'transit']);

function dedupe<T>(xs: T[]): T[] {
  const out: T[] = [];
  for (const x of xs) if (out.at(-1) !== x) out.push(x);
  return out;
}

function segmentAt(segments: NarrativeSegment[], elapsedMs: number): { index: number; offsetMs: number } {
  let acc = 0;
  for (const s of segments) {
    if (elapsedMs < acc + s.estDurationMs) return { index: s.index, offsetMs: Math.max(0, elapsedMs - acc) };
    acc += s.estDurationMs;
  }
  const last = segments.at(-1);
  return { index: last?.index ?? 0, offsetMs: last?.estDurationMs ?? 0 };
}

function topRejected(scored: readonly ScoredCandidate[], n = 8): StoryRecord['rejected'] {
  return scored
    .filter((c) => !c.eligible && !isClutter(c.place))
    .slice(0, n)
    .map((c) => ({ id: c.place.id, name: c.place.name, reasons: c.suppressedBy }));
}

export async function runScenario(sc: Scenario, opts: RunOptions = {}): Promise<ReplayResult> {
  const source = opts.source ?? new FixturePlaceSource();
  const evidence = opts.evidence ?? new FixtureEvidence();
  const trace = opts.trace ?? loadTrace(sc.trace);
  const snapshotMs = (opts.snapshotEveryS ?? 60) * 1000;
  const before = { q: source.stats.queries, disc: source.stats.byPurpose.discovery ?? 0, dens: source.stats.byPurpose.density ?? 0, empty: source.stats.emptyResults };
  const t0 = trace.fixes[0]!.t;
  const rel = (t: number) => round((t - t0) / 1000, 1);
  const units = sc.locale.toLowerCase().endsWith('-us') ? 'imperial' : 'metric';

  let st = newJourney({ sessionId: `replay:${sc.name}`, now: t0, guideId: sc.guide.id, locale: sc.locale, simulated: true });
  const sessionId = st.sessionId;
  let sessionRestarts = 0;
  let discRec: DiscoveryFetchRecord | null = null;
  let densRec: DensityProbeRecord | null = null;
  let cached: PlaceCandidate[] = [];
  let lastDiscoveryQuery: DiscoveryQuery | null = null;
  let playing: { planId: string; place: PlaceCandidate; segments: NarrativeSegment[]; startedAt: number; endsAt: number; record: StoryRecord } | null = null;

  const stories: StoryRecord[] = [];
  const timeline: TimelineEntry[] = [];
  const speech: Array<[number, number]> = [];
  const rejections: ReplaySummary['rejections'] = {};
  let lastKey = '';
  let lastSnap = -Infinity;
  let groundingFailures = 0;
  let wronglyBehind = 0;
  let endedAfterPassing = 0;
  let preemptions = 0;
  const densitySeq: DensityClass[] = [];

  const route = sc.useRoute && trace.route ? { polyline: trace.route, source: 'replay' as const } : null;

  const completeIfDue = (ctxNow: number) => {
    if (!playing || ctxNow < playing.endsAt) return;
    // Did the target get passed before the story ended? (moving regimes only)
    const ctx = contextOf(st);
    if (ctx.position && isDriving(ctx.regime.regime)) {
      const g = geometryFor(ctx, playing.place, trajectoryFor(ctx));
      if (g.alongTrackM !== null && g.alongTrackM + playing.place.extentM < -50) {
        playing.record.endedAfterPassing = true;
        endedAfterPassing++;
      }
    }
    st = storyCompleted(st, playing.endsAt);
    playing = null;
  };

  for (let i = 0; i < trace.fixes.length; i++) {
    const fix = trace.fixes[i]!;
    const audio = playing
      ? (() => {
          const s = segmentAt(playing.segments, fix.t - playing.startedAt);
          return { playing: true, planId: playing.planId, segmentIndex: s.index, offsetMs: Math.round(s.offsetMs), outputRoute: 'bluetooth' as const };
        })()
      : { playing: false, outputRoute: 'bluetooth' as const };
    st = ingestFrame(st, { sessionId, seq: i, fixes: [fix], route, appState: 'locked', audio, lastInteractionAt: null, clientTime: fix.t, simulated: true });
    if (st.sessionId !== sessionId) sessionRestarts++;
    completeIfDue(st.now);
    let ctx: JourneyContext = contextOf(st);
    if (!ctx.position) continue;

    // Local density probe (throttled).
    if (shouldRefreshDensity(densRec, ctx, densityHintFrom(ctx, { query: lastDiscoveryQuery, candidates: cached }))) {
      const pq = densityProbeQueryFor(ctx);
      const probe = await source.as('density').query(pq);
      st = observeDensity(st, probe, pq.radiusM);
      densRec = recordDensityProbe(densRec, ctx, probe.length, st.density.density);
      ctx = contextOf(st);
    }
    densitySeq.push(st.density.density);

    // Discovery (throttled): paid provider call only when the cache no longer covers us.
    const traj = trajectoryFor(ctx);
    const q = discoveryQueryFor(ctx, traj);
    if (shouldRefreshDiscovery(discRec, ctx, q).refresh) {
      cached = await source.as('discovery').query(q);
      lastDiscoveryQuery = q;
      discRec = recordDiscoveryFetch(discRec, ctx, q, cached.length);
    }

    const thin = new Set(cached.filter((p) => evidence.isThin(p.id)).map((p) => p.id));
    const scored = scoreCandidates(ctx, cached, thin, { guide: sc.guide, trajectory: traj });
    for (const c of scored) {
      if (c.eligible || isClutter(c.place)) continue;
      const r = (rejections[c.place.id] ??= { name: c.place.name, reasons: {} });
      for (const why of c.suppressedBy) r.reasons[why] = (r.reasons[why] ?? 0) + 1;
    }
    const factKinds: Record<string, FactKind[]> = {};
    for (const c of scored) if (c.eligible) factKinds[c.place.id] = evidence.factKinds(c.place.id) ?? [];

    const d = decideMoment(ctx, scored, {
      guide: sc.guide,
      factKinds,
      activeStoryRemainingS: playing ? Math.max(0, (playing.endsAt - st.now) / 1000) : null,
      activeStorySignificance: st.activeStorySignificance,
      currentPlanId: st.currentPlanId,
      answerSpokenSince: st.answerSpokenSinceInterrupt,
    });
    const policy = policyFor(ctx.regime.regime, ctx.density.density);

    // Execute decision.
    if (d.kind === 'start_story') {
      if (playing) preemptions++;
      const pack = evidence.get(d.target.place.id)!;
      const brief = buildStoryBrief(d, pack, sc.guide, ctx, { units });
      const text = templateNarrative(brief, sc.guide);
      const grounding = checkGrounding(text, brief);
      if (!grounding.ok) groundingFailures++;
      const plan = segmentNarrative(text, brief, sc.guide, st.now, { generatedBy: { kind: 'template' }, grounding });
      const durMs = plan.segments.reduce((s, x) => s + x.estDurationMs, 0);
      const g = d.target.geometry;
      if (g.alongTrackM !== null && (g.relative === 'behind' || g.alongTrackM + d.target.place.extentM < -policy.behindToleranceM)) wronglyBehind++;
      const record: StoryRecord = {
        t: rel(st.now),
        kind: 'story',
        placeId: d.target.place.id,
        name: d.target.place.name,
        placeKind: d.target.place.kind,
        regime: ctx.regime.regime,
        density: ctx.density.density,
        speedMps: round(ctx.regime.smoothedSpeedMps, 1),
        courseDeg: ctx.regime.courseDeg === null ? null : round(ctx.regime.courseDeg, 0),
        trajectory: traj.mode,
        relative: g.relative,
        side: g.side,
        distanceM: Math.round(g.distanceM),
        alongTrackM: g.alongTrackM === null ? null : Math.round(g.alongTrackM),
        crossTrackM: g.crossTrackM === null ? null : Math.round(g.crossTrackM),
        etaS: g.etaS === null ? null : Math.round(g.etaS),
        reachM: Math.round(d.target.components.reachM ?? 0),
        score: round(d.target.score, 3),
        mode: d.mode,
        angle: d.angle,
        preempt: d.preempt,
        durationBudgetS: d.durationBudgetS,
        maxWords: d.maxWords,
        words: grounding.wordCount,
        playedS: round(durMs / 1000, 1),
        segments: plan.segments.length,
        grounded: grounding.ok,
        allowQuestionsToUser: brief.allowQuestionsToUser,
        spatialCue: brief.spatialCue,
        text,
        rejected: topRejected(scored),
      };
      stories.push(record);
      st = storyStarted(st, { planId: plan.id, place: d.target.place, angle: d.angle, segmentCount: plan.segments.length, at: st.now });
      playing = { planId: plan.id, place: d.target.place, segments: plan.segments, startedAt: st.now, endsAt: st.now + durMs, record };
      speech.push([st.now, st.now + durMs]);
    } else if (d.kind === 'orientation') {
      const text = buildOrientation(d.target, sc.locale, { units });
      const wps = policy.wordsPerSecond * sc.guide.voice.speakingRate;
      const durMs = Math.round((wordCount(text) / wps) * 1000);
      const g = d.target.geometry;
      stories.push({
        t: rel(st.now),
        kind: 'orientation',
        placeId: d.target.place.id,
        name: d.target.place.name,
        placeKind: d.target.place.kind,
        regime: ctx.regime.regime,
        density: ctx.density.density,
        speedMps: round(ctx.regime.smoothedSpeedMps, 1),
        courseDeg: ctx.regime.courseDeg === null ? null : round(ctx.regime.courseDeg, 0),
        trajectory: traj.mode,
        relative: g.relative,
        side: g.side,
        distanceM: Math.round(g.distanceM),
        alongTrackM: g.alongTrackM === null ? null : Math.round(g.alongTrackM),
        crossTrackM: g.crossTrackM === null ? null : Math.round(g.crossTrackM),
        etaS: g.etaS === null ? null : Math.round(g.etaS),
        reachM: Math.round(d.target.components.reachM ?? 0),
        score: round(d.target.score, 3),
        words: wordCount(text),
        playedS: round(durMs / 1000, 1),
        grounded: true,
        text,
        rejected: topRejected(scored),
      });
      st = orientationGiven(st, d.target.place, st.now + durMs);
      speech.push([st.now, st.now + durMs]);
    }

    // Timeline (on change + periodic snapshot).
    const target = d.kind === 'start_story' || d.kind === 'orientation' ? d.target.place.id : undefined;
    const reason = d.kind === 'silence' ? d.reason : undefined;
    const key = `${d.kind}|${reason ?? ''}|${target ?? ''}|${ctx.regime.regime}|${ctx.density.density}`;
    if (key !== lastKey || st.now - lastSnap >= snapshotMs) {
      const suppressed: TimelineEntry['suppressed'] = {};
      for (const c of scored) for (const r of c.suppressedBy) suppressed[r] = (suppressed[r] ?? 0) + 1;
      const best = d.kind === 'silence' ? (d.best ?? null) : null;
      timeline.push({
        t: rel(st.now),
        regime: ctx.regime.regime,
        density: ctx.density.density,
        speedMps: round(ctx.regime.smoothedSpeedMps, 1),
        decision: d.kind,
        ...(reason ? { reason } : {}),
        ...(target ? { target } : {}),
        ...(d.kind === 'silence' ? { best: best?.place.id ?? null, bestScore: best ? round(best.score, 3) : null } : {}),
        eligible: scored.filter((c) => c.eligible).length,
        suppressed,
        policy: {
          nearRadiusM: policy.nearRadiusM,
          lookAheadBaseM: policy.lookAheadBaseM,
          lookAheadMaxM: policy.lookAheadMaxM,
          minGapS: policy.minGapS,
          speakThreshold: round(policy.speakThreshold, 3),
          maxStoryS: policy.maxStoryS,
          significanceFloor: round(policy.significanceFloor, 3),
        },
        trajectory: traj.mode,
      });
      lastKey = key;
      lastSnap = st.now;
    }
  }
  if (playing) completeIfDue(Infinity);

  // ── summary
  const tEnd = trace.fixes.at(-1)!.t;
  const durationS = (tEnd - t0) / 1000;
  const merged = speech.map(([a, b]) => [a, Math.min(b, tEnd)] as [number, number]).sort((x, y) => x[0] - y[0]);
  let spoken = 0;
  let maxGap = 0;
  let cursor = t0;
  for (const [a, b] of merged) {
    maxGap = Math.max(maxGap, (a - cursor) / 1000);
    spoken += Math.max(0, b - Math.max(a, cursor));
    cursor = Math.max(cursor, b);
  }
  maxGap = Math.max(maxGap, (tEnd - cursor) / 1000);
  const disc = (source.stats.byPurpose.discovery ?? 0) - before.disc;
  const dens = (source.stats.byPurpose.density ?? 0) - before.dens;
  const total = source.stats.queries - before.q;
  const mem = st.memory;
  const summary: ReplaySummary = {
    scenario: sc.name,
    acceptance: sc.acceptance,
    trace: trace.name,
    synthetic: trace.synthetic,
    guide: sc.guide.id,
    locale: sc.locale,
    durationS,
    frames: trace.fixes.length,
    storiesStarted: stories.filter((s) => s.kind === 'story').length,
    orientations: stories.filter((s) => s.kind === 'orientation').length,
    preemptions,
    targets: stories.map((s) => ({ t: s.t, id: s.placeId, name: s.name, kind: s.kind, regime: s.regime, distanceM: s.distanceM, reachM: s.reachM })),
    silenceRatio: round(1 - spoken / Math.max(1, tEnd - t0), 3),
    maxSilentGapS: Math.round(maxGap),
    regimeTransitions: st.transitions.map((x) => ({ t: rel(x.at), from: x.from, to: x.to })),
    regimeSequence: dedupe(st.transitions.map((x) => x.to)),
    densitySequence: dedupe(densitySeq),
    providerQueries: {
      discovery: disc,
      densityProbe: dens,
      total,
      perHour: round((total / Math.max(1, durationS)) * 3600, 1),
      emptyResults: source.stats.emptyResults - before.empty,
      framesPerQuery: round(trace.fixes.length / Math.max(1, total), 1),
    },
    wronglyBehindTargets: wronglyBehind,
    endedAfterPassing,
    groundingFailures,
    utilityStories: stories.filter((s) => UTILITY.has(s.placeKind)).length,
    clutterStories: stories.filter((s) => s.placeId.includes(':clutter:')).length,
    sessionRestarts,
    memory: {
      discussed: Object.keys(mem.discussed).length,
      completed: mem.storiesCompleted,
      mentions: Object.values(mem.discussed).filter((x) => x.depth === 'mention').length,
    },
    rejections,
  };
  return { summary, stories, timeline, finalState: st };
}
