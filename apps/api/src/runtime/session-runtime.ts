/**
 * SessionRuntime — the server-side product authority for one session (D-002).
 *
 * Per context frame:  core ingestFrame → density probe (throttled) → shouldRefreshDiscovery →
 * PlaceSource (cached) → scoreCandidates → decideMoment → story / orientation / resume.
 * Story: evidence (cached) → buildStoryBrief → LLM prose (grounded, 1 retry, template
 * fallback) → segmentNarrative → TTS segment 0 now, 1..n pipelined → `play`.
 *
 * Conversation: utterance → rules → closed-enum LLM interpreter → handler. Every utterance
 * opens a new *turn*; anything prepared for an older turn is dropped before emission (B3
 * barge-in), and the older turn's provider calls are aborted.
 *
 * Directives carry a monotonic seq; the outbox keeps un-acked directives so a reconnecting
 * client gets exactly the ones it missed (E3), and utterance ids are de-duplicated so a
 * retried request never re-runs a tool.
 *
 * Journey time: all core reducers use the client clock domain (frames may be simulated or
 * replayed), extrapolated by server-elapsed time between frames (`jnow`).
 */
import type {
  ContextFrame,
  Directive,
  EvidencePack,
  FactKind,
  GuideProfile,
  InterpretedUtterance,
  JourneyContext,
  Locale,
  MomentDecision,
  NarrativePlan,
  PlaceCandidate,
  PlayableSegment,
  ScoredCandidate,
  StoryBrief,
} from '@city/core';
import {
  EMIL,
  GUIDES,
  IDA,
  adjustTalkativeness,
  answerSpoken,
  buildOrientation,
  buildStoryBrief,
  contextOf,
  decideMoment,
  decideResume,
  decideTool,
  densityProbeQueryFor,
  discoveryQueryFor,
  emptyToolHistory,
  geohashEncode,
  guideById,
  ingestFrame,
  interpretUtterance,
  isDriving,
  newJourney,
  observeDensity,
  orientationGiven,
  recordDensityProbe,
  recordDiscoveryFetch,
  recordQuestion,
  recordRejected,
  recordToolCall,
  round,
  scoreCandidates,
  segmentHash,
  segmentNarrative,
  shouldRefreshDensity,
  shouldRefreshDiscovery,
  storyAbandoned,
  storyCompleted,
  storyInterrupted,
  storyPaused,
  storyResumed,
  storySkipped,
  storyStarted,
  trajectoryFor,
  wordCount,
  type DensityProbeRecord,
  type DiscoveryFetchRecord,
  type JourneyState,
  type ToolHistory,
  type Units,
} from '@city/core';
import { followUpBrief, generateGroundedAnswer, generateGroundedNarrative, isProviderError, isThinFacts, type ProviderRouter } from '@city/providers';
import type { AudioStore } from '../audio-store.js';
import type { DiscoveryService } from '../discovery-service.js';
import type { KV } from '../kv.js';
import type { Telemetry } from '../telemetry.js';
import { NEARBY_RADIUS_M, nearbyAnswer, showResults, validateNearby, type ValidatedNearby } from './nearby.js';
import { phrase, type PhraseKey } from './phrases.js';

export const POLICY_VERSION = 'core-0.1.0';

export const RUNTIME = {
  OUTBOX_MAX: 300,
  LISTEN_TIMEOUT_MS: 15_000,
  /** After an answer's estimated end, treat it as finished even without a client ack. */
  ANSWER_GRACE_MS: 1500,
  /** Story considered finished this long after its estimated end if the client never confirms. */
  STORY_GRACE_MS: 20_000,
  PROCESSED_UTTERANCES: 64,
  EXPLAIN_MAX: 200,
  PLANS_KEPT: 4,
  /** Reduced mode (cache down): minimum seconds between discovery fetches per session. */
  REDUCED_MIN_INTERVAL_S: 90,
  FOLLOWUP_WORDS: { walking: 70, driving: 40 },
} as const;

export interface SessionInfo {
  id: string;
  guideId: string;
  locale: Locale;
  units: Units;
  simulated: boolean;
  ownerId: string;
}

export interface Envelope {
  type: 'directive';
  seq: number;
  /** Conversation turn this directive belongs to (null = ambient narration/state). */
  turn: number | null;
  /** Reference for acknowledging playback of a `say` (audio_progress.planId). */
  ref?: string;
  at: number;
  directive: Directive;
}

export interface Sender {
  send(e: Envelope): void;
}

/** Process-wide limiter for reduced mode (shared across sessions). */
export class ReducedModeLimiter {
  private window: number[] = [];
  constructor(private readonly perMinute = 30) {}
  allow(now = Date.now()): boolean {
    this.window = this.window.filter((t) => now - t < 60_000);
    if (this.window.length >= this.perMinute) return false;
    this.window.push(now);
    return true;
  }
}

export interface RuntimeDeps {
  router: ProviderRouter;
  discovery: DiscoveryService;
  audio: AudioStore;
  telemetry: Telemetry;
  kv: KV;
  reducedLimiter: ReducedModeLimiter;
  clock?: () => number;
  log?: { warn: (o: object, m?: string) => void };
}

interface PlanRecord {
  plan: NarrativePlan;
  brief: StoryBrief;
  place: PlaceCandidate;
  segments: PlayableSegment[];
  angle: string;
}

interface Subject {
  placeId: string;
  placeName: string;
  brief: StoryBrief;
  pack: EvidencePack;
  spokenFactIds: string[];
  at: number;
}

interface PendingAnswer {
  ref: string;
  endsAt: number;
  turn: number | null;
}

export interface UtteranceInput {
  text: string;
  utteranceId?: string;
  speechEndAt?: number;
  sttProvider?: string;
}

export type ControlAction = 'skip' | 'pause' | 'resume' | 'stop' | 'repeat' | 'not_that_one' | 'quieter' | 'chattier' | 'interrupt';

export interface AudioProgress {
  planId: string;
  segmentIndex: number;
  offsetMs: number;
  state: 'playing' | 'finished' | 'stopped';
}

export interface ExplainEntry {
  t: number;
  regime: string;
  density: string;
  decision: string;
  reason?: string;
  target?: { id: string; name: string; score: number };
  top: Array<{ id: string; name: string; score: number; eligible: boolean; suppressedBy: string[]; distanceBucketM: number }>;
  providerCalls?: number;
}

interface Snapshot {
  v: 1;
  info: SessionInfo;
  state: JourneyState;
  discRec: DiscoveryFetchRecord | null;
  densRec: DensityProbeRecord | null;
  seq: number;
  acked: number;
  turn: number;
  outbox: Envelope[];
  plans: PlanRecord[];
  subject: Subject | null;
  processed: string[];
  userPaused: boolean;
  thin: string[];
  lastSay: { text: string; ref: string } | null;
  lastNearby: ValidatedNearby[];
  activeEndsAt: number | null;
}

export class SessionRuntime {
  readonly info: SessionInfo;
  guide: GuideProfile;
  state: JourneyState;
  private readonly d: RuntimeDeps;
  private readonly clock: () => number;

  // discovery
  private discRec: DiscoveryFetchRecord | null = null;
  private densRec: DensityProbeRecord | null = null;
  private candidates: PlaceCandidate[] = [];
  private lastScored: ScoredCandidate[] = [];
  private thin = new Set<string>();
  private packs = new Map<string, EvidencePack | null>();
  private factKinds: Record<string, FactKind[]> = {};
  private lastDiscoveryServerAt = 0;

  // conversation
  private turn = 0;
  private turnAbort = new AbortController();
  private listeningUntil: number | null = null;
  private pendingAnswer: PendingAnswer | null = null;
  private preparing = false;
  private userPaused = false;
  private processed: string[] = [];
  private toolHistory: ToolHistory = emptyToolHistory();
  private lastNearby: ValidatedNearby[] = [];
  private lastSay: { text: string; ref: string } | null = null;
  private lastIntent: string | null = null;
  private subject: Subject | null = null;
  private plans = new Map<string, PlanRecord>();
  private activeEndsAt: number | null = null;

  // directives
  private seq = 0;
  private acked = 0;
  private outbox: Envelope[] = [];
  private senders = new Set<Sender>();

  // scheduling
  private frameQueue: ContextFrame[] = [];
  private needTick = false;
  private draining: Promise<void> | null = null;
  private lastFrameServerAt: number;
  private persistTimer: NodeJS.Timeout | null = null;
  private lastStateKey = '';
  readonly explain: ExplainEntry[] = [];
  lastActivityAt: number;
  stats = { droppedStale: 0, discoveryFetches: 0, densityProbes: 0, frames: 0 };

  constructor(info: SessionInfo, deps: RuntimeDeps, snap?: Snapshot) {
    this.info = info;
    this.d = deps;
    this.clock = deps.clock ?? Date.now;
    this.guide = guideById(info.guideId) ?? IDA;
    this.lastFrameServerAt = this.clock();
    this.lastActivityAt = this.clock();
    this.state = newJourney({ sessionId: info.id, now: this.clock(), guideId: this.guide.id, locale: info.locale, simulated: info.simulated });
    if (snap) this.restore(snap);
  }

  // ─────────────────────────────────────────────── time

  /** Journey clock: client time domain, advanced by server-elapsed time since the last frame. */
  jnow(): number {
    return this.state.now + Math.max(0, this.clock() - this.lastFrameServerAt);
  }

  private ctxNow(): JourneyContext {
    return { ...contextOf(this.state), now: this.jnow() };
  }

  // ─────────────────────────────────────────────── directives

  attach(s: Sender): () => void {
    this.senders.add(s);
    return () => this.senders.delete(s);
  }

  get connected(): number {
    return this.senders.size;
  }

  private emit(directive: Directive, opts: { turn?: number | null; ref?: string } = {}): Envelope | null {
    const turn = opts.turn ?? null;
    if (turn !== null && turn !== this.turn) {
      this.stats.droppedStale++;
      return null;
    }
    const env: Envelope = { type: 'directive', seq: ++this.seq, turn, at: this.clock(), directive, ...(opts.ref ? { ref: opts.ref } : {}) };
    this.outbox.push(env);
    if (this.outbox.length > RUNTIME.OUTBOX_MAX) this.outbox.splice(0, this.outbox.length - RUNTIME.OUTBOX_MAX);
    for (const s of this.senders) {
      try {
        s.send(env);
      } catch {
        /* socket gone; outbox keeps it for resume */
      }
    }
    return env;
  }

  ack(seq: number): void {
    if (Number.isFinite(seq) && seq > this.acked) this.acked = Math.min(seq, this.seq);
    this.outbox = this.outbox.filter((e) => e.seq > this.acked);
  }

  /** Reconnect (E3): mark ≤ lastSeq as delivered and return only what the client missed. */
  resumeFrom(lastSeq: number): Envelope[] {
    this.ack(lastSeq);
    return this.outbox.filter((e) => e.seq > lastSeq);
  }

  get lastSeq(): number {
    return this.seq;
  }

  private since(from: number): Envelope[] {
    return this.outbox.filter((e) => e.seq > from);
  }

  private newTurn(): number {
    this.turn++;
    this.turnAbort.abort(new Error('superseded'));
    this.turnAbort = new AbortController();
    return this.turn;
  }

  // ─────────────────────────────────────────────── inbound: context

  async context(frame: ContextFrame): Promise<Envelope[]> {
    const from = this.seq;
    this.lastActivityAt = this.clock();
    this.frameQueue.push(frame);
    await this.drain();
    this.schedulePersist();
    return this.since(from);
  }

  private drain(): Promise<void> {
    if (!this.draining) {
      this.draining = (async () => {
        while (this.frameQueue.length > 0 || this.needTick) {
          const frames = this.frameQueue.splice(0);
          this.needTick = false;
          for (const f of frames) this.ingest(f);
          try {
            await this.tick();
          } catch (e) {
            this.d.log?.warn({ err: (e as Error).message, session: this.info.id }, 'tick failed');
          }
        }
      })().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  private kick(): Promise<void> {
    this.needTick = true;
    return this.drain();
  }

  private ingest(frame: ContextFrame): void {
    const t0 = performance.now();
    const before = this.state;
    const next = ingestFrame(before, { ...frame, sessionId: this.info.id });
    if (next === before) return;
    this.stats.frames++;
    this.state = next;
    this.lastFrameServerAt = this.clock();
    if (next.regime.regime !== before.regime.regime) {
      this.d.telemetry.event({ name: 'regime_change', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: next.regime.regime, props: { from: before.regime.regime } });
    }
    this.d.telemetry.latency({ sessionId: this.info.id, interaction: 'context_ingest', ms: performance.now() - t0, at: this.clock() });
  }

  private geohash5(): string | null {
    return this.state.position ? geohashEncode(this.state.position, 5) : null;
  }

  private emitStateIfChanged(silence: string | null): void {
    const s = this.state;
    const key = `${s.regime.regime}|${s.density.density}|${s.safety.driveSafe}|${s.simulated}`;
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    this.emit({ type: 'state', regime: s.regime.regime, density: s.density.density, driveSafe: s.safety.driveSafe, simulated: s.simulated, silence: (silence as never) ?? null });
  }

  private reducedAllows(): boolean {
    if (!this.d.kv.reduced) return true;
    if (this.clock() - this.lastDiscoveryServerAt < RUNTIME.REDUCED_MIN_INTERVAL_S * 1000) return false;
    return this.d.reducedLimiter.allow(this.clock());
  }

  private async tick(): Promise<void> {
    let ctx = this.ctxNow();
    // answer/listen/story bookkeeping by time
    if (this.pendingAnswer && ctx.now >= this.pendingAnswer.endsAt + RUNTIME.ANSWER_GRACE_MS) this.finishAnswerState();
    if (this.listeningUntil !== null && ctx.now > this.listeningUntil) this.listeningUntil = null;
    const a = this.state.activeStory;
    if (a && a.status === 'playing' && this.activeEndsAt !== null && ctx.now > this.activeEndsAt + RUNTIME.STORY_GRACE_MS) this.completeStory(ctx.now);
    if (!ctx.position) return;
    const callCtx = { sessionId: this.info.id };

    // Density probe (throttled, cached).
    if (shouldRefreshDensity(this.densRec, ctx) && this.reducedAllows()) {
      const pq = densityProbeQueryFor(ctx);
      this.stats.densityProbes++;
      this.lastDiscoveryServerAt = this.clock();
      try {
        const r = await this.d.discovery.places(pq, callCtx, 'density_probe');
        this.state = observeDensity(this.state, r.places, pq.radiusM);
        this.densRec = recordDensityProbe(this.densRec, ctx, r.places.length);
      } catch {
        this.densRec = recordDensityProbe(this.densRec, ctx, 0); // failure backs off like an empty result (F2)
      }
      ctx = this.ctxNow();
    }

    // Discovery (throttled): paid call only when the cached result no longer covers us.
    const traj = trajectoryFor(ctx);
    const q = discoveryQueryFor(ctx, traj);
    const rd = shouldRefreshDiscovery(this.discRec, ctx, q);
    if (rd.refresh && this.reducedAllows()) {
      this.stats.discoveryFetches++;
      this.lastDiscoveryServerAt = this.clock();
      try {
        const r = await this.d.discovery.places(q, callCtx);
        this.candidates = r.places;
        this.discRec = recordDiscoveryFetch(this.discRec, ctx, q, r.places.length);
      } catch (e) {
        this.discRec = recordDiscoveryFetch(this.discRec, ctx, q, 0); // F2: failure → backoff, never a tight loop
        this.d.telemetry.event({ name: 'provider_error', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: ctx.regime.regime, props: { task: 'discovery', kind: isProviderError(e) ? e.kind : 'unknown' } });
      }
    }

    for (let pass = 0; pass < 2; pass++) {
      ctx = this.ctxNow();
      const scored = scoreCandidates(ctx, this.candidates, this.thin, { guide: this.guide, trajectory: traj });
      this.lastScored = scored;
      const d = decideMoment(ctx, scored, {
        guide: this.guide,
        factKinds: this.factKinds,
        listening: this.listeningUntil !== null || this.pendingAnswer !== null || this.preparing,
        userPaused: this.userPaused,
        activeStoryRemainingS: this.activeEndsAt !== null ? Math.max(0, (this.activeEndsAt - ctx.now) / 1000) : null,
        activeStorySignificance: this.state.activeStorySignificance,
        currentPlanId: this.state.currentPlanId,
        answerSpokenSince: this.state.answerSpokenSinceInterrupt,
      });
      this.recordExplain(ctx, d, scored);
      this.emitStateIfChanged(d.kind === 'silence' ? d.reason : null);
      const again = await this.execute(d, ctx);
      if (!again) break; // a thin-evidence discovery triggers one re-decision (A4 orientation)
    }
  }

  private recordExplain(ctx: JourneyContext, d: MomentDecision, scored: readonly ScoredCandidate[]): void {
    const last = this.explain.at(-1);
    const target = d.kind === 'start_story' || d.kind === 'orientation' ? d.target : null;
    const reason = d.kind === 'silence' ? d.reason : d.kind === 'abandon_story' ? d.decision.reason : undefined;
    if (last && last.decision === d.kind && last.reason === reason && !target && ctx.now - last.t < 60_000) return;
    const e: ExplainEntry = {
      t: ctx.now,
      regime: ctx.regime.regime,
      density: ctx.density.density,
      decision: d.kind,
      ...(reason ? { reason } : {}),
      ...(target ? { target: { id: target.place.id, name: target.place.name, score: round(target.score, 3) } } : {}),
      top: scored.slice(0, 6).map((c) => ({ id: c.place.id, name: c.place.name, score: round(c.score, 3), eligible: c.eligible, suppressedBy: c.suppressedBy, distanceBucketM: Math.round(c.geometry.distanceM / 50) * 50 })),
    };
    this.explain.push(e);
    if (this.explain.length > RUNTIME.EXPLAIN_MAX) this.explain.shift();
    void this.d.kv.pushCapped(`explain:${this.info.id}`, JSON.stringify(e), 500, 24 * 3600);
  }

  /** Returns true when the decision should be re-evaluated immediately (evidence turned out thin). */
  private async execute(d: MomentDecision, ctx: JourneyContext): Promise<boolean> {
    switch (d.kind) {
      case 'start_story':
        return this.startStory(d, ctx);
      case 'orientation':
        await this.orientation(d.target);
        return false;
      case 'resume_story':
        this.resume(d.decision.fromSegment, d.decision.bridge, null);
        return false;
      case 'abandon_story': {
        const a = this.state.activeStory;
        this.state = storyAbandoned(this.state, ctx.now);
        this.activeEndsAt = null;
        if (a) {
          this.d.telemetry.event({ name: 'story_abandoned', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: ctx.regime.regime, props: { planId: a.planId, reason: d.decision.reason } });
          this.d.telemetry.storyStatusChange(a.planId, 'abandoned', this.clock());
        }
        return false;
      }
      default:
        return false;
    }
  }

  // ─────────────────────────────────────────────── stories

  private async evidenceFor(place: PlaceCandidate, signal?: AbortSignal): Promise<EvidencePack | null> {
    if (this.packs.has(place.id)) return this.packs.get(place.id)!;
    let pack: EvidencePack | null = null;
    try {
      pack = await this.d.discovery.evidence(place, this.info.locale, { sessionId: this.info.id, ...(signal ? { signal } : {}) });
    } catch {
      return null; // not cached: a transient failure should not permanently mark the place thin
    }
    this.packs.set(place.id, pack);
    if (this.packs.size > 200) this.packs.delete(this.packs.keys().next().value!);
    if (pack) this.factKinds[place.id] = [...new Set(pack.facts.map((f) => f.kind))];
    return pack;
  }

  private async startStory(d: Extract<MomentDecision, { kind: 'start_story' }>, ctx: JourneyContext, forcedTurn?: number): Promise<boolean> {
    const turn = forcedTurn ?? this.turn;
    const signal = this.turnAbort.signal;
    const t0 = this.clock();
    const place = d.target.place;
    this.preparing = true;
    try {
      const pack = await this.evidenceFor(place, signal);
      if (!pack || pack.thin || isThinFacts(pack.facts)) {
        this.thin.add(place.id);
        return forcedTurn === undefined; // re-decide without this candidate (maybe orientation)
      }
      const brief = buildStoryBrief(d, pack, this.guide, ctx, { units: this.info.units });
      const g = await generateGroundedNarrative(brief, this.guide, this.d.router.generator('story', { sessionId: this.info.id, signal }));
      if (turn !== this.turn) return this.dropStale();
      const draft = segmentNarrative(g.text, brief, this.guide, ctx.now, { generatedBy: g.generatedBy, grounding: g.grounding });
      const plan = draft as NarrativePlan;
      // F3 invariant: the plan is about the decided target, whatever the generator said.
      if (plan.placeId !== place.id) throw new Error('target substitution');

      const tts = this.d.router.plannedTts();
      const refs = plan.segments.map((s) => this.d.audio.refFor(s.hash, tts, this.guide));
      const ttsCtx = { sessionId: this.info.id };
      const first = refs[0] && tts ? await this.d.audio.ensure(refs[0], plan.segments[0]!.text, this.guide, this.info.locale, tts, ttsCtx) : null;
      if (turn !== this.turn) return this.dropStale();
      const audioOk = !!first?.ok;
      if (audioOk && tts) {
        // Pipelined synthesis of the remaining segments (sequential, bounded; the audio route awaits in-flight jobs).
        void (async () => {
          for (let i = 1; i < plan.segments.length; i++) await this.d.audio.ensure(refs[i]!, plan.segments[i]!.text, this.guide, this.info.locale, tts, ttsCtx);
        })();
      }
      const segments: PlayableSegment[] = plan.segments.map((s, i) => ({
        segmentId: s.id,
        index: i,
        text: s.text,
        audioUrl: audioOk && refs[i] ? refs[i]!.url : null,
        durationMs: i === 0 && audioOk ? first!.durationMs : s.estDurationMs,
      }));
      const now = this.jnow();
      if (d.preempt) this.emit({ type: 'stop_audio', reason: 'preempted' }, { turn });
      this.state = storyStarted(this.state, { planId: plan.id, place, angle: d.angle, segmentCount: plan.segments.length, at: now });
      this.activeEndsAt = now + segments.reduce((s, x) => s + x.durationMs, 0);
      this.emit({ type: 'card', placeId: place.id, name: place.name, kind: place.kind, location: place.location, spatialCue: brief.spatialCue }, { turn });
      this.emit({ type: 'map', action: { kind: 'focus_place', placeId: place.id, location: place.location, name: place.name } }, { turn });
      this.emit({ type: 'play', planId: plan.id, placeId: place.id, placeName: brief.placeName, segments, startAt: { segmentIndex: 0, offsetMs: 0 }, bridgeText: null }, { turn });
      const ms = this.clock() - t0;
      this.d.telemetry.latency({ sessionId: this.info.id, interaction: first?.cached ? 'cached_story_to_first_audio' : 'trigger_to_first_audio', ms, at: this.clock(), props: { generatedBy: g.generatedBy.kind, audio: audioOk } });
      this.d.telemetry.event({ name: 'story_started', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: ctx.regime.regime, props: { planId: plan.id, placeId: place.id, mode: d.mode, angle: d.angle, generatedBy: g.generatedBy.kind, fallback: g.fallbackReason, audio: audioOk } });
      this.d.telemetry.story({
        id: plan.id,
        sessionId: this.info.id,
        placeId: place.id,
        placeName: brief.placeName,
        placeKind: place.kind,
        angle: d.angle,
        mode: d.mode,
        guideId: this.guide.id,
        locale: String(this.info.locale),
        regime: ctx.regime.regime,
        geohash5: this.geohash5(),
        generatedBy: g.generatedBy.kind,
        provider: g.generatedBy.kind === 'llm' ? g.generatedBy.provider : null,
        model: g.generatedBy.kind === 'llm' ? g.generatedBy.model : null,
        groundingOk: g.grounding.ok,
        fallbackReason: g.fallbackReason,
        segments: plan.segments.length,
        words: g.grounding.wordCount,
      });
      this.plans.set(plan.id, { plan, brief, place, segments, angle: d.angle });
      while (this.plans.size > RUNTIME.PLANS_KEPT) this.plans.delete(this.plans.keys().next().value!);
      this.subject = { placeId: place.id, placeName: brief.placeName, brief, pack, spokenFactIds: brief.facts.map((f) => f.id), at: now };
      return false;
    } catch (e) {
      if (!(isProviderError(e) && e.kind === 'aborted')) this.d.log?.warn({ err: (e as Error).message, session: this.info.id }, 'story failed');
      return false;
    } finally {
      this.preparing = false;
    }
  }

  private dropStale(): false {
    this.stats.droppedStale++;
    return false;
  }

  private async orientation(target: ScoredCandidate, turn: number | null = null): Promise<void> {
    const text = buildOrientation(target, this.info.locale, { units: this.info.units });
    this.emit({ type: 'card', placeId: target.place.id, name: target.place.name, kind: target.place.kind, location: target.place.location, spatialCue: null }, { turn });
    const env = await this.say(text, 'ack', turn);
    const dur = env ? this.pendingAnswer?.endsAt ?? this.jnow() : this.jnow();
    this.state = orientationGiven(this.state, target.place, dur);
    this.d.telemetry.event({ name: 'story_offered', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: this.state.regime.regime, props: { placeId: target.place.id, kind: 'orientation' } });
  }

  private resume(fromSegment: number, bridge: boolean, turn: number | null): void {
    const a = this.state.activeStory;
    if (!a) return;
    const rec = this.plans.get(a.planId);
    if (!rec) {
      this.state = storyAbandoned(this.state, this.jnow());
      return;
    }
    const now = this.jnow();
    this.state = storyResumed(this.state, fromSegment, now);
    this.activeEndsAt = now + rec.segments.slice(fromSegment).reduce((s, x) => s + x.durationMs, 0);
    this.emit(
      { type: 'play', planId: rec.plan.id, placeId: rec.place.id, placeName: rec.brief.placeName, segments: rec.segments, startAt: { segmentIndex: fromSegment, offsetMs: 0 }, bridgeText: bridge ? phrase('bridge', this.info.locale) : null },
      { turn },
    );
    this.d.telemetry.event({ name: 'story_resumed', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: this.state.regime.regime, props: { planId: a.planId, fromSegment, bridge } });
  }

  private completeStory(at: number): void {
    const a = this.state.activeStory;
    if (!a) return;
    this.state = storyCompleted(this.state, at);
    this.activeEndsAt = null;
    this.d.telemetry.event({ name: 'story_completed', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: this.state.regime.regime, props: { planId: a.planId } });
    this.d.telemetry.storyStatusChange(a.planId, 'completed', this.clock());
  }

  // ─────────────────────────────────────────────── speech output

  /** Speak a short line (TTS, cached by text). Returns null when superseded. */
  private async say(text: string, purpose: 'answer' | 'ack' | 'error', turn: number | null): Promise<Envelope | null> {
    const tts = this.d.router.plannedTts();
    const ref = this.d.audio.refFor(segmentHash(text, this.guide, String(this.info.locale)), tts, this.guide);
    let audioUrl: string | null = null;
    let durationMs = Math.round((wordCount(text) / 2.5) * 1000);
    if (ref && tts) {
      const r = await this.d.audio.ensure(ref, text, this.guide, this.info.locale, tts, { sessionId: this.info.id });
      if (r.ok) {
        audioUrl = ref.url;
        durationMs = r.durationMs;
      }
    }
    if (turn !== null && turn !== this.turn) {
      this.stats.droppedStale++;
      return null;
    }
    const sayRef = `say_${this.info.id.slice(0, 8)}_${this.seq + 1}`;
    const env = this.emit({ type: 'say', text, audioUrl, purpose }, { turn, ref: sayRef });
    if (env) {
      this.pendingAnswer = { ref: sayRef, endsAt: this.jnow() + durationMs, turn };
      this.lastSay = { text, ref: sayRef };
    }
    return env;
  }

  private finishAnswerState(): void {
    if (!this.pendingAnswer) return;
    this.pendingAnswer = null;
    const a = this.state.activeStory;
    if (a && a.status === 'interrupted') this.state = answerSpoken(this.state, this.jnow());
  }

  // ─────────────────────────────────────────────── inbound: audio progress / ack

  async audioProgress(p: AudioProgress): Promise<Envelope[]> {
    const from = this.seq;
    this.lastActivityAt = this.clock();
    const a = this.state.activeStory;
    if (a && p.planId === a.planId) {
      if (a.status === 'playing') {
        const idx = Math.max(0, Math.min(a.segmentCount - 1, Math.round(p.segmentIndex)));
        if (idx > a.segmentIndex || (idx === a.segmentIndex && p.offsetMs >= a.offsetMs)) this.state = { ...this.state, activeStory: { ...a, segmentIndex: idx, offsetMs: Math.max(0, Math.round(p.offsetMs)) } };
        if (p.state === 'finished' && idx >= a.segmentCount - 1) this.completeStory(this.jnow());
      }
    } else if (this.pendingAnswer && p.planId === this.pendingAnswer.ref && p.state !== 'playing') {
      this.finishAnswerState();
      await this.kick(); // resume decision right after the answer (C1 step 7)
    }
    this.schedulePersist();
    return this.since(from);
  }

  // ─────────────────────────────────────────────── inbound: controls

  async control(action: ControlAction): Promise<Envelope[]> {
    const from = this.seq;
    const t0 = this.clock();
    this.lastActivityAt = t0;
    const turn = this.newTurn();
    switch (action) {
      case 'interrupt': {
        this.bargeIn(turn, 'user_speech', t0);
        this.listeningUntil = this.jnow() + RUNTIME.LISTEN_TIMEOUT_MS;
        this.emit({ type: 'listen', mode: 'push_to_talk', timeoutMs: RUNTIME.LISTEN_TIMEOUT_MS }, { turn });
        break;
      }
      case 'skip':
        this.skip(turn, false);
        break;
      case 'not_that_one':
        this.skip(turn, true);
        break;
      case 'stop':
        this.stop(turn);
        break;
      case 'pause':
        this.pause(turn);
        break;
      case 'resume':
        this.explicitResume(turn);
        break;
      case 'repeat':
        await this.repeat(turn);
        break;
      case 'quieter':
      case 'chattier':
        this.state = { ...this.state, memory: adjustTalkativeness(this.state.memory, action === 'quieter' ? -1 : 1) };
        if (action === 'chattier') this.userPaused = false;
        break;
    }
    if (action === 'skip' || action === 'not_that_one') this.d.telemetry.event({ name: action === 'skip' ? 'story_skipped' : 'not_that_one', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: this.state.regime.regime, props: { via: 'control' } });
    this.schedulePersist();
    return this.since(from);
  }

  /** Stop whatever is audible for a new turn; preserve the story state (C1 steps 1–2). */
  private bargeIn(turn: number, cause: 'user_speech' | 'user_tap', t0: number): boolean {
    let stopped = false;
    const a = this.state.activeStory;
    if (a && a.status === 'playing') {
      this.state = storyInterrupted(this.state, this.jnow(), cause, { segmentIndex: a.segmentIndex, offsetMs: a.offsetMs });
      this.activeEndsAt = null;
      this.emit({ type: 'stop_audio', reason: cause }, { turn });
      this.d.telemetry.event({ name: 'story_interrupted', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: this.state.regime.regime, props: { planId: a.planId, segmentIndex: a.segmentIndex, cause } });
      this.d.telemetry.storyStatusChange(a.planId, 'interrupted', this.clock());
      stopped = true;
    } else if (this.pendingAnswer) {
      this.pendingAnswer = null;
      this.emit({ type: 'stop_audio', reason: 'superseded' }, { turn });
      stopped = true;
    }
    if (stopped) this.d.telemetry.latency({ sessionId: this.info.id, interaction: 'bargein_stop', ms: this.clock() - t0, at: this.clock() });
    return stopped;
  }

  private skip(turn: number, reject: boolean): void {
    const a = this.state.activeStory;
    if (a) {
      if (a.status === 'playing') this.emit({ type: 'stop_audio', reason: reject ? 'not_that_one' : 'skip' }, { turn });
      if (reject) this.state = { ...this.state, memory: recordRejected(this.state.memory, a.placeId, this.jnow()) };
      this.state = storySkipped(this.state, this.jnow());
      this.activeEndsAt = null;
      this.d.telemetry.storyStatusChange(a.planId, 'skipped', this.clock());
    } else if (this.pendingAnswer) {
      this.pendingAnswer = null;
      this.emit({ type: 'stop_audio', reason: 'skip' }, { turn });
    }
    // C3: the old subject no longer anchors follow-ups
    if (reject) this.subject = null;
  }

  private stop(turn: number): void {
    const a = this.state.activeStory;
    if (a) {
      this.state = storyAbandoned(this.state, this.jnow());
      this.activeEndsAt = null;
      this.d.telemetry.storyStatusChange(a.planId, 'abandoned', this.clock());
    }
    this.pendingAnswer = null;
    this.userPaused = true;
    this.emit({ type: 'stop_audio', reason: 'stop' }, { turn });
  }

  private pause(turn: number): void {
    const a = this.state.activeStory;
    if (a && a.status === 'playing') this.state = storyPaused(this.state, this.jnow());
    this.activeEndsAt = null;
    this.userPaused = true;
    this.emit({ type: 'stop_audio', reason: 'pause' }, { turn });
  }

  private explicitResume(turn: number): void {
    this.userPaused = false;
    const a = this.state.activeStory;
    if (a && (a.status === 'paused' || a.status === 'interrupted')) {
      const d = decideResume({ ...a, interruptedAt: this.jnow() }, this.ctxNow(), null, {});
      this.resume(d.action === 'resume' ? d.fromSegment : a.segmentIndex, false, turn);
    }
  }

  private async repeat(turn: number): Promise<void> {
    const a = this.state.activeStory;
    if (a && this.plans.has(a.planId)) {
      if (a.status === 'playing') this.emit({ type: 'stop_audio', reason: 'repeat' }, { turn });
      this.resume(a.segmentIndex, false, turn);
      return;
    }
    if (this.lastSay) await this.say(this.lastSay.text, 'answer', turn);
    else await this.say(phrase('nothingToRepeat', this.info.locale), 'ack', turn);
  }

  // ─────────────────────────────────────────────── inbound: utterances

  async utterance(u: UtteranceInput): Promise<Envelope[]> {
    const from = this.seq;
    const t0 = this.clock();
    this.lastActivityAt = t0;
    if (u.utteranceId) {
      if (this.processed.includes(u.utteranceId)) return []; // E3: a retried utterance never re-runs a tool
      this.processed.push(u.utteranceId);
      if (this.processed.length > RUNTIME.PROCESSED_UTTERANCES) this.processed.shift();
    }
    const text = u.text.trim().slice(0, 500);
    const turn = this.newTurn();
    const signal = this.turnAbort.signal;
    this.listeningUntil = null;
    this.bargeIn(turn, 'user_speech', t0);
    if (!text) {
      await this.sayPhrase('notUnderstood', turn);
      return this.finishTurn(from);
    }

    let iu: InterpretedUtterance | null = interpretUtterance(text, this.info.locale);
    if (!iu) {
      try {
        iu = await this.d.router.interpret(text, this.info.locale, { activeSubject: this.subject?.placeName ?? null, previousIntent: this.lastIntent }, { sessionId: this.info.id, signal });
      } catch {
        if (turn !== this.turn) return this.finishTurn(from);
        iu = { text, intent: 'unknown', slots: {}, confidence: 0, interpretedBy: 'llm' };
      }
    }
    if (turn !== this.turn) return this.finishTurn(from); // superseded while interpreting (B3)
    this.lastIntent = iu.intent;
    this.state = { ...this.state, memory: recordQuestion(this.state.memory, text, iu.intent, this.jnow()) };
    this.d.telemetry.event({ name: 'question_asked', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: this.state.regime.regime, props: { intent: iu.intent, by: iu.interpretedBy } });

    const sayT0 = t0;
    let firstAudio: Envelope | null = null;
    switch (iu.intent) {
      case 'nearby_search':
        firstAudio = await this.nearby(iu, turn, signal, t0);
        break;
      case 'ask_question':
      case 'tell_more':
        firstAudio = await this.followUp(text, iu.intent, turn, signal);
        break;
      case 'what_is_that':
        firstAudio = await this.whatIsThat(text, turn, signal);
        break;
      case 'skip':
        this.skip(turn, false);
        firstAudio = await this.sayPhrase('ackSkip', turn);
        break;
      case 'not_that_one':
        this.skip(turn, true);
        this.d.telemetry.event({ name: 'not_that_one', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: this.state.regime.regime, props: { via: 'voice' } });
        firstAudio = await this.sayPhrase('ackTopic', turn);
        break;
      case 'stop':
        this.stop(turn);
        break;
      case 'pause':
        this.pause(turn);
        break;
      case 'resume':
        this.explicitResume(turn);
        break;
      case 'repeat':
        await this.repeat(turn);
        break;
      case 'quieter':
      case 'chattier':
        this.state = { ...this.state, memory: adjustTalkativeness(this.state.memory, iu.intent === 'quieter' ? -1 : 1) };
        if (iu.intent === 'chattier') this.userPaused = false;
        firstAudio = await this.sayPhrase(iu.intent === 'quieter' ? 'ackQuieter' : 'ackChattier', turn);
        break;
      case 'navigate_to':
        firstAudio = await this.navigate(iu, turn);
        break;
      case 'change_guide': {
        const named = GUIDES.find((g) => iu!.slots.guideRef && g.name.toLowerCase() === iu!.slots.guideRef.toLowerCase());
        this.guide = named ?? (this.guide.id === IDA.id ? EMIL : IDA);
        this.state = { ...this.state, guideId: this.guide.id };
        this.d.telemetry.event({ name: 'guide_selected', sessionId: this.info.id, at: this.clock(), geohash5: null, props: { guideId: this.guide.id } });
        firstAudio = await this.sayPhrase('guideChanged', turn);
        break;
      }
      case 'smalltalk':
        firstAudio = await this.sayPhrase('smalltalk', turn);
        break;
      default:
        firstAudio = await this.sayPhrase('notUnderstood', turn);
    }
    if (firstAudio) this.d.telemetry.latency({ sessionId: this.info.id, interaction: 'speech_end_to_first_audio', ms: this.clock() - sayT0, at: this.clock(), props: { intent: iu.intent, by: iu.interpretedBy } });
    return this.finishTurn(from);
  }

  private finishTurn(from: number): Envelope[] {
    this.schedulePersist();
    return this.since(from);
  }

  private sayPhrase(key: PhraseKey, turn: number): Promise<Envelope | null> {
    return this.say(phrase(key, this.info.locale), 'ack', turn);
  }

  /** C1: NearbySearch independent of discovery filtering; validated; grounded answer; map. */
  private async nearby(iu: InterpretedUtterance, turn: number, signal: AbortSignal, t0: number): Promise<Envelope | null> {
    const ctx = this.ctxNow();
    const decision = decideTool(ctx, { tool: 'nearby_search', args: { category: iu.slots.category ?? null, query: iu.slots.query ?? iu.text, maxResults: 5 }, requestedBy: iu.interpretedBy }, this.toolHistory);
    if (!decision.allowed) return this.sayPhrase(decision.reason === 'no_fix' ? 'noFix' : 'nearbyLimited', turn);
    this.toolHistory = recordToolCall(this.toolHistory, 'nearby_search', ctx.now);
    const pos = ctx.position!;
    const driving = isDriving(ctx.regime.regime);
    const radiusM = NEARBY_RADIUS_M[ctx.regime.regime];
    const max = Number(decision.request.args.maxResults ?? 5);
    const category = iu.slots.category ?? null;
    let raw: unknown[];
    const tCall = this.clock();
    try {
      raw = (await this.d.router.nearby({ location: { lat: pos.lat, lng: pos.lng }, category, query: iu.slots.query ?? iu.text, radiusM, maxResults: max, locale: this.info.locale }, { sessionId: this.info.id, signal })).result;
    } catch (e) {
      if (turn !== this.turn || (isProviderError(e) && e.kind === 'aborted')) return null;
      return this.sayPhrase('nearbyFailed', turn);
    }
    if (turn !== this.turn) return null; // B3: superseded by a newer turn — stale results never surface
    const { results, invalid } = validateNearby(raw, pos, radiusM, max);
    this.d.telemetry.latency({ sessionId: this.info.id, interaction: 'nearby_to_result', ms: this.clock() - tCall, at: this.clock(), props: { category: category ?? 'free_text' } });
    this.d.telemetry.event({ name: 'nearby_search', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: ctx.regime.regime, props: { category: category ?? 'free_text', results: results.length, invalidDropped: invalid } });
    this.lastNearby = results;
    if (results.length > 0) {
      const mapDecision = decideTool(ctx, { tool: 'show_on_map', args: { interactive: !driving }, requestedBy: 'rules' }, this.toolHistory);
      if (mapDecision.allowed && this.emit({ type: 'map', action: showResults(results) }, { turn })) {
        this.d.telemetry.latency({ sessionId: this.info.id, interaction: 'tool_to_map', ms: this.clock() - t0, at: this.clock() });
      }
    }
    return this.say(nearbyAnswer(results, category, String(this.info.locale), this.info.units, driving), 'answer', turn);
  }

  /** C2 / B1: answer from the current brief/evidence — never a place search. */
  private async followUp(question: string, intent: 'ask_question' | 'tell_more' | 'what_is_that', turn: number, signal: AbortSignal): Promise<Envelope | null> {
    const s = this.subject;
    if (!s) return this.sayPhrase('noSubject', turn);
    const words = isDriving(this.state.regime.regime) ? RUNTIME.FOLLOWUP_WORDS.driving : RUNTIME.FOLLOWUP_WORDS.walking;
    const fb = followUpBrief(s.brief, s.pack, question, intent === 'what_is_that' ? 'ask_question' : intent, new Set(s.spokenFactIds), words);
    const r = await generateGroundedAnswer(question, fb, this.guide, this.d.router.generator('followup', { sessionId: this.info.id, signal }));
    if (turn !== this.turn) return null;
    s.spokenFactIds = [...new Set([...s.spokenFactIds, ...fb.facts.map((f) => f.id)])];
    this.state = { ...this.state, memory: { ...this.state.memory, discussed: { ...this.state.memory.discussed, ...(this.state.memory.discussed[s.placeId] ? { [s.placeId]: { ...this.state.memory.discussed[s.placeId]!, depth: 'followup' as const } } : {}) } } };
    this.d.telemetry.event({ name: 'question_asked', sessionId: this.info.id, at: this.clock(), geohash5: null, props: { kind: 'followup_answered', grounded: r.grounding.ok, generatedBy: r.generatedBy.kind, facts: fb.facts.length } });
    return this.say(r.text, 'answer', turn);
  }

  private async whatIsThat(question: string, turn: number, signal: AbortSignal): Promise<Envelope | null> {
    const s = this.subject;
    const a = this.state.activeStory;
    if (s && (a?.placeId === s.placeId || this.jnow() - s.at < 120_000)) return this.followUp(question, 'what_is_that', turn, signal);
    // Nothing active: name the most relevant nearby place (user-requested, bypasses cadence).
    const best = this.lastScored.find((c) => c.eligible) ?? this.lastScored.find((c) => c.suppressedBy.length === 1 && c.suppressedBy[0] === 'evidence_thin') ?? null;
    if (!best) return this.sayPhrase('noSubject', turn);
    await this.orientation(best, turn);
    return this.lastSay ? this.outbox.at(-1) ?? null : null;
  }

  private async navigate(iu: InterpretedUtterance, turn: number): Promise<Envelope | null> {
    const ref = (iu.slots.placeRef ?? iu.slots.query ?? '').toLowerCase();
    const byName = (n: string) => ref.length > 2 && (n.toLowerCase().includes(ref) || ref.includes(n.toLowerCase()));
    const ordinal = /\b(first|closest|nearest|that one|it)\b|перв|ближайш/i.test(ref) ? this.lastNearby[0] : undefined;
    const hit =
      this.lastNearby.find((r) => byName(r.name)) ??
      ordinal ??
      this.lastScored.map((c) => c.place).find((p) => byName(p.name)) ??
      (this.subject && byName(this.subject.placeName) ? this.plans.get(this.state.currentPlanId ?? '')?.place : undefined);
    if (!hit) return this.sayPhrase('navigateUnknown', turn);
    const loc = hit.location;
    const name = hit.name;
    const d = decideTool(this.ctxNow(), { tool: 'navigate_handoff', args: { lat: loc.lat, lng: loc.lng, name }, requestedBy: iu.interpretedBy }, this.toolHistory);
    if (!d.allowed) return this.sayPhrase('notUnderstood', turn);
    const ll = `${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
    this.emit(
      { type: 'navigate_handoff', destination: loc, name, urls: { google: `https://www.google.com/maps/dir/?api=1&destination=${ll}`, apple: `https://maps.apple.com/?daddr=${ll}`, waze: `https://waze.com/ul?ll=${ll}&navigate=yes` } },
      { turn },
    );
    this.d.telemetry.event({ name: 'navigate_handoff', sessionId: this.info.id, at: this.clock(), geohash5: this.geohash5(), regime: this.state.regime.regime, props: {} });
    return this.sayPhrase('navigating', turn);
  }

  // ─────────────────────────────────────────────── persistence

  summary() {
    const m = this.state.memory;
    return {
      sessionId: this.info.id,
      guideId: this.guide.id,
      locale: this.info.locale,
      simulated: this.state.simulated,
      regime: this.state.regime.regime,
      density: this.state.density.density,
      driveSafe: this.state.safety.driveSafe,
      activeStory: this.state.activeStory ? { planId: this.state.activeStory.planId, placeId: this.state.activeStory.placeId, status: this.state.activeStory.status, segmentIndex: this.state.activeStory.segmentIndex, segmentCount: this.state.activeStory.segmentCount } : null,
      lastDirectiveSeq: this.seq,
      memory: {
        discussed: Object.values(m.discussed)
          .sort((a, b) => b.at - a.at)
          .slice(0, 50)
          .map((x) => ({ placeId: x.placeId, placeName: x.placeName, depth: x.depth, completed: x.completed, angle: x.angle ?? null })),
        storiesCompleted: m.storiesCompleted,
        storiesSkipped: m.storiesSkipped,
        questions: m.questions.length,
        talkativeness: m.talkativeness,
      },
    };
  }

  snapshot(): Snapshot {
    return {
      v: 1,
      info: this.info,
      state: this.state,
      discRec: this.discRec,
      densRec: this.densRec,
      seq: this.seq,
      acked: this.acked,
      turn: this.turn,
      outbox: this.outbox.slice(-100),
      plans: [...this.plans.values()],
      subject: this.subject,
      processed: this.processed,
      userPaused: this.userPaused,
      thin: [...this.thin].slice(-200),
      lastSay: this.lastSay,
      lastNearby: this.lastNearby,
      activeEndsAt: this.activeEndsAt,
    };
  }

  private restore(s: Snapshot): void {
    this.state = s.state;
    this.discRec = s.discRec;
    this.densRec = s.densRec;
    this.seq = s.seq;
    this.acked = s.acked;
    this.turn = s.turn;
    this.outbox = s.outbox;
    this.plans = new Map(s.plans.map((p) => [p.plan.id, p]));
    this.subject = s.subject;
    this.processed = s.processed;
    this.userPaused = s.userPaused;
    this.thin = new Set(s.thin);
    this.lastSay = s.lastSay;
    this.lastNearby = s.lastNearby;
    this.activeEndsAt = s.activeEndsAt;
    this.guide = guideById(s.state.guideId) ?? this.guide;
    // Candidates are not persisted: the next frame re-reads them (discovery cache → usually a hit).
    this.discRec = null;
  }

  static snapshotKey(id: string): string {
    return `sess:v1:${id}`;
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 200);
    this.persistTimer.unref?.();
  }

  async persist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      await this.d.kv.set(SessionRuntime.snapshotKey(this.info.id), JSON.stringify(this.snapshot()), 24 * 3600);
    } catch {
      /* KV is best effort; ResilientKV already falls back to memory */
    }
  }

  /** Test/ops helper: wait until queued frame work is done. */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  close(): void {
    this.turnAbort.abort(new Error('session closed'));
    if (this.persistTimer) clearTimeout(this.persistTimer);
  }
}

export type { Snapshot as RuntimeSnapshot };
