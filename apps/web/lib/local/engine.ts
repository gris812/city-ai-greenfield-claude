/**
 * LocalEngine — runs the REAL product brain (@city/core) in the browser for the clearly
 * labelled "Offline demo mode". It plays the role the API's session service plays in live
 * mode (D-002): it folds ContextFrames into JourneyState, runs discovery → scoring →
 * MomentDirector, builds grounded template narratives, and emits the same `Directive`s the
 * server would send. The pipeline is the same one the replay harness uses
 * (packages/replay/src/run.ts), driven by real-time audio progress instead of simulated
 * playback.
 *
 * Differences vs live mode (by design, and labelled in the UI):
 *  - places/evidence come from fixture packs (D-005), not global providers;
 *  - narration uses the deterministic template (no LLM) and the device voice (no server TTS);
 *  - free-form questions are answered only from the evidence facts (no LLM interpreter).
 */
import type {
  ContextFrame,
  Directive,
  FactKind,
  GuideProfile,
  JourneyContext,
  MapAction,
  NarrativeSegment,
  PlaceCandidate,
  PlaceKind,
  PlayableSegment,
  ScoredCandidate,
  SuppressionReason,
} from '@city/core';
import {
  adjustTalkativeness,
  answerSpoken,
  buildOrientation,
  buildStoryBrief,
  checkGrounding,
  contextOf,
  decideMoment,
  decideTool,
  densityProbeQueryFor,
  discoveryQueryFor,
  guideById,
  haversineM,
  IDA,
  ingestFrame,
  interpretUtterance,
  newJourney,
  observeDensity,
  orientationGiven,
  policyFor,
  recordDensityProbe,
  recordDiscoveryFetch,
  recordRejected,
  round,
  scoreCandidates,
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
  templateNarrative,
  trajectoryFor,
  wordCount,
  type DensityProbeRecord,
  type DiscoveryFetchRecord,
  type JourneyState,
} from '@city/core';
import type { DemoData } from './demo-data';
import type { AudioProgressMsg, ControlAction, DebugEntry, SessionOptions } from '../session/types';

interface PlanRecord {
  planId: string;
  place: PlaceCandidate;
  segments: NarrativeSegment[];
  spatialCue: string | null;
}

export interface EngineSink {
  directive(d: Directive): void;
  debug(e: DebugEntry): void;
}

const UTILITY: readonly PlaceKind[] = ['food', 'shop', 'lodging', 'fuel', 'transit'];

const BRIDGE: Record<string, { en: (p: string) => string; ru: (p: string) => string }> = {
  ida: { en: (p) => `Where was I? Ah yes, ${p}.`, ru: (p) => `На чём я остановилась? Ах да — ${p}.` },
  emil: { en: (p) => `Back to ${p}, where we left off.`, ru: (p) => `Возвращаемся к теме «${p}» — с того места, где остановились.` },
};
const QUIET_ACK: Record<string, { en: string; ru: string }> = {
  ida: { en: 'I’ll keep quiet for a while. Just say my name if you’d like me.', ru: 'Я немного помолчу. Позовите меня по имени, если захотите.' },
  emil: { en: 'Going quiet. I’ll only pipe up for something good.', ru: 'Молчу. Заговорю, только если будет что-то стоящее.' },
};
const OPENING: Record<string, { en: string; ru: string }> = {
  ida: {
    en: 'Hello, I’m Ida. I’ll keep you company while you go. When something around us has a story worth telling, I’ll tell it; otherwise I’ll let you enjoy the quiet.',
    ru: 'Здравствуйте, я Ида. Я побуду рядом, пока вы в пути. Если вокруг найдётся история, которую стоит рассказать, — расскажу, а в остальное время дам вам побыть в тишине.',
  },
  emil: {
    en: 'Emil here. I’ll speak up when there’s something worth hearing, and stay out of your way when there isn’t.',
    ru: 'Это Эмиль. Буду говорить, когда есть что сказать, а в остальное время — не мешать.',
  },
};

function isRu(locale: string): boolean {
  return locale.toLowerCase().startsWith('ru');
}

/** Nearby-search category → fixture predicate (fixtures carry a few utility tags). */
function matchesCategory(p: PlaceCandidate, category: string | undefined): boolean {
  const name = p.name.toLowerCase();
  switch (category) {
    case 'coffee':
      return p.kind === 'food' && (p.tags.includes('coffee') || /caf|coffee/.test(name));
    case 'restaurant':
      return p.kind === 'food';
    case 'gas_station':
    case 'rest_area':
      return p.kind === 'fuel' || p.tags.includes('truck_stop');
    case 'lodging':
      return p.kind === 'lodging' || p.tags.includes('motel');
    case 'pharmacy':
      return p.tags.includes('pharmacy');
    case 'parking':
      return p.tags.includes('parking');
    case 'grocery':
      return p.kind === 'shop';
    default:
      return UTILITY.includes(p.kind);
  }
}

export class LocalEngine {
  st: JourneyState;
  private guide: GuideProfile;
  private units: 'metric' | 'imperial';
  private discRec: DiscoveryFetchRecord | null = null;
  private densRec: DensityProbeRecord | null = null;
  private cached: PlaceCandidate[] = [];
  private scored: ScoredCandidate[] = [];
  private plans = new Map<string, PlanRecord>();
  private lastPlan: PlanRecord | null = null;
  private playingSegment: { index: number; offsetMs: number } = { index: 0, offsetMs: 0 };
  private listening = false;
  private pendingAnswer = false;
  private pendingSince = 0;
  private lastKey = '';
  private lastSnapWall = 0;
  private lastState = '';
  private seq = 0;
  private lastRefreshReason: string | null = null;
  private greeted = false;

  constructor(
    private readonly data: DemoData,
    opts: SessionOptions,
    private readonly sink: EngineSink,
  ) {
    this.guide = guideById(opts.guideId) ?? IDA;
    this.units = opts.units;
    this.st = this.fresh(opts);
  }

  private fresh(opts: SessionOptions): JourneyState {
    const id = `local:${Math.random().toString(36).slice(2, 10)}`;
    let st = newJourney({ sessionId: id, now: Date.now(), guideId: this.guide.id, locale: opts.locale, simulated: opts.simulated });
    st = { ...st, memory: adjustTalkativeness(st.memory, opts.talkativeness) };
    return st;
  }

  get sessionId(): string {
    return this.st.sessionId;
  }

  reset(opts: SessionOptions): void {
    this.guide = guideById(opts.guideId) ?? this.guide;
    this.units = opts.units;
    this.st = this.fresh(opts);
    this.discRec = null;
    this.densRec = null;
    this.cached = [];
    this.scored = [];
    this.plans.clear();
    this.lastPlan = null;
    this.listening = false;
    this.pendingAnswer = false;
    this.lastKey = '';
    this.lastState = '';
    this.seq = 0;
    this.greeted = false;
    this.emit({ type: 'stop_audio', reason: 'session_reset' });
    this.emit({ type: 'map', action: { kind: 'clear' } });
  }

  setGuide(id: string): void {
    const g = guideById(id);
    if (!g) return;
    this.guide = g;
    this.st = { ...this.st, guideId: g.id };
  }
  setTalkativeness(n: number): void {
    const cur = this.st.memory.talkativeness;
    this.st = { ...this.st, memory: adjustTalkativeness(this.st.memory, n - cur) };
  }
  setLocale(locale: string, units: 'metric' | 'imperial'): void {
    this.units = units;
    this.st = { ...this.st, locale };
  }

  private emit(d: Directive): void {
    this.sink.directive(d);
  }

  // ─────────────────────────────────────────── context frames (the main loop)

  ingest(frame: Omit<ContextFrame, 'sessionId' | 'seq'>): void {
    const full: ContextFrame = {
      ...frame,
      sessionId: this.st.sessionId,
      seq: this.seq++,
      // The engine tracks playback itself; pass through the player's report.
      audio: frame.audio,
    };
    this.st = ingestFrame(this.st, full);
    if (this.pendingAnswer && Date.now() - this.pendingSince > 30_000) this.sayFinished(); // never stall on a lost 'say' end
    let ctx: JourneyContext = contextOf(this.st);
    if (!ctx.position) {
      this.emitState(ctx, 'no_fix');
      return;
    }
    if (!this.greeted) {
      this.greeted = true;
    }

    // Density probe (throttled; D-006 density is emergent from candidate counts).
    if (shouldRefreshDensity(this.densRec, ctx)) {
      const pq = densityProbeQueryFor(ctx);
      const probe = this.data.source.querySync(pq);
      this.st = observeDensity(this.st, probe, pq.radiusM);
      this.densRec = recordDensityProbe(this.densRec, ctx, probe.length);
      ctx = contextOf(this.st);
    }

    // Discovery (throttled; F1: no provider call per fix).
    const traj = trajectoryFor(ctx);
    const q = discoveryQueryFor(ctx, traj);
    const rd = shouldRefreshDiscovery(this.discRec, ctx, q);
    this.lastRefreshReason = rd.refresh ? rd.reason : null;
    if (rd.refresh) {
      this.cached = this.data.source.querySync(q);
      this.discRec = recordDiscoveryFetch(this.discRec, ctx, q, this.cached.length);
    }

    const thin = new Set(this.cached.filter((p) => this.data.evidence.isThin(p.id)).map((p) => p.id));
    this.scored = scoreCandidates(ctx, this.cached, thin, { guide: this.guide, trajectory: traj });
    const factKinds: Record<string, FactKind[]> = {};
    for (const c of this.scored) if (c.eligible) factKinds[c.place.id] = this.data.evidence.factKinds(c.place.id) ?? [];

    const active = this.st.activeStory;
    const plan = active ? this.plans.get(active.planId) : null;
    const remainingS = plan && active ? this.remainingS(plan, active.segmentIndex, active.offsetMs) : null;

    const d = decideMoment(ctx, this.scored, {
      guide: this.guide,
      factKinds,
      // An answer being spoken holds the director like listening does (resume waits for it).
      listening: this.listening || this.pendingAnswer,
      activeStoryRemainingS: remainingS,
      activeStorySignificance: this.st.activeStorySignificance,
      currentPlanId: this.st.currentPlanId,
      answerSpokenSince: this.st.answerSpokenSinceInterrupt,
    });

    let silence: string | null = null;
    switch (d.kind) {
      case 'start_story':
        this.startStory(ctx, d);
        break;
      case 'orientation': {
        const text = buildOrientation(d.target, ctx.locale, { units: this.units });
        const policy = policyFor(ctx.regime.regime, ctx.density.density);
        const durMs = Math.round((wordCount(text) / (policy.wordsPerSecond * this.guide.voice.speakingRate)) * 1000);
        this.st = orientationGiven(this.st, d.target.place, this.st.now + durMs);
        this.emit({ type: 'card', placeId: d.target.place.id, name: d.target.place.name, kind: d.target.place.kind, location: d.target.place.location, spatialCue: null });
        this.emit({ type: 'map', action: { kind: 'focus_place', placeId: d.target.place.id, location: d.target.place.location, name: d.target.place.name } });
        this.emit({ type: 'say', text, audioUrl: null, purpose: 'ack' });
        break;
      }
      case 'resume_story': {
        const a = this.st.activeStory;
        const p = a ? this.plans.get(a.planId) : null;
        if (a && p) {
          this.st = storyResumed(this.st, d.decision.fromSegment, this.st.now);
          const bridge = d.decision.bridge ? (isRu(ctx.locale) ? BRIDGE[this.guide.id]?.ru(p.place.name) : BRIDGE[this.guide.id]?.en(p.place.name)) ?? null : null;
          this.emitPlay(p, d.decision.fromSegment, bridge);
        }
        break;
      }
      case 'abandon_story':
        this.st = storyAbandoned(this.st, this.st.now);
        this.emit({ type: 'stop_audio', reason: `abandon:${d.decision.reason}` });
        this.emit({ type: 'map', action: { kind: 'follow_user' } });
        break;
      case 'silence':
        silence = d.reason;
        break;
      default:
        break;
    }
    this.emitState(ctx, silence);
    this.logDecision(ctx, d.kind, silence ?? (d.kind === 'abandon_story' ? d.decision.reason : null), d, traj.mode);
  }

  private remainingS(plan: PlanRecord, index: number, offsetMs: number): number {
    const rest = plan.segments.slice(index).reduce((s, x) => s + x.estDurationMs, 0) - offsetMs;
    return Math.max(0, rest / 1000);
  }

  private startStory(ctx: JourneyContext, d: Extract<ReturnType<typeof decideMoment>, { kind: 'start_story' }>): void {
    const pack = this.data.evidence.get(d.target.place.id);
    if (!pack) return;
    const brief = buildStoryBrief(d, pack, this.guide, ctx, { units: this.units });
    const text = templateNarrative(brief, this.guide);
    const grounding = checkGrounding(text, brief);
    const draft = segmentNarrative(text, brief, this.guide, this.st.now, { generatedBy: { kind: 'template' }, grounding });
    if (d.preempt) this.emit({ type: 'stop_audio', reason: 'preempt' });
    this.st = storyStarted(this.st, { planId: draft.id, place: d.target.place, angle: d.angle, segmentCount: draft.segments.length, at: this.st.now });
    const rec: PlanRecord = { planId: draft.id, place: d.target.place, segments: draft.segments, spatialCue: brief.spatialCue };
    this.plans.set(draft.id, rec);
    this.lastPlan = rec;
    this.emit({ type: 'card', placeId: d.target.place.id, name: d.target.place.name, kind: d.target.place.kind, location: d.target.place.location, spatialCue: brief.spatialCue });
    this.emit({ type: 'map', action: { kind: 'focus_place', placeId: d.target.place.id, location: d.target.place.location, name: d.target.place.name } });
    this.emitPlay(rec, 0, null);
  }

  private emitPlay(p: PlanRecord, fromSegment: number, bridgeText: string | null): void {
    const segments: PlayableSegment[] = p.segments.map((s) => ({ segmentId: s.id, index: s.index, text: s.text, audioUrl: null, durationMs: s.estDurationMs }));
    this.playingSegment = { index: fromSegment, offsetMs: 0 };
    this.emit({ type: 'play', planId: p.planId, placeId: p.place.id, placeName: p.place.name, segments, startAt: { segmentIndex: fromSegment, offsetMs: 0 }, bridgeText });
  }

  private emitState(ctx: JourneyContext, silence: string | null): void {
    const key = `${ctx.regime.regime}|${ctx.density.density}|${ctx.safety.driveSafe}|${silence ?? ''}`;
    if (key === this.lastState) return;
    this.lastState = key;
    this.emit({
      type: 'state',
      regime: ctx.regime.regime,
      density: ctx.density.density,
      driveSafe: ctx.safety.driveSafe,
      simulated: ctx.simulated,
      silence: (silence as never) ?? null,
    });
  }

  private logDecision(ctx: JourneyContext, decision: string, reason: string | null, d: ReturnType<typeof decideMoment>, trajectory: string): void {
    const target = d.kind === 'start_story' || d.kind === 'orientation' ? d.target.place.name : null;
    const key = `${decision}|${reason ?? ''}|${target ?? ''}|${ctx.regime.regime}|${ctx.density.density}`;
    const wall = Date.now();
    if (key === this.lastKey && wall - this.lastSnapWall < 4000) return;
    this.lastKey = key;
    this.lastSnapWall = wall;
    const suppressed: Partial<Record<SuppressionReason, number>> = {};
    for (const c of this.scored) for (const r of c.suppressedBy) suppressed[r] = (suppressed[r] ?? 0) + 1;
    const best = d.kind === 'silence' ? (d.best ?? null) : null;
    const policy = policyFor(ctx.regime.regime, ctx.density.density);
    const top = this.scored
      .filter((c) => !c.place.tags.includes('synthetic_clutter'))
      .slice(0, 6)
      .map((c) => ({
        id: c.place.id,
        name: c.place.name,
        score: round(c.score, 3),
        eligible: c.eligible,
        reasons: c.suppressedBy,
        lat: c.place.location.lat,
        lng: c.place.location.lng,
        relative: c.geometry.relative,
        distanceM: Math.round(c.geometry.distanceM),
      }));
    this.sink.debug({
      wall,
      t: ctx.now,
      regime: ctx.regime.regime,
      density: ctx.density.density,
      speedMps: round(ctx.regime.smoothedSpeedMps, 1),
      decision,
      reason,
      target,
      best: best?.place.name ?? null,
      bestScore: best ? round(best.score, 3) : null,
      eligible: this.scored.filter((c) => c.eligible).length,
      suppressed,
      trajectory,
      refresh: this.lastRefreshReason,
      policy: { nearRadiusM: policy.nearRadiusM, lookAheadMaxM: policy.lookAheadMaxM, minGapS: policy.minGapS, speakThreshold: round(policy.speakThreshold, 3), maxStoryS: policy.maxStoryS },
      top,
      source: 'local-core',
    });
  }

  // ─────────────────────────────────────────── player feedback

  audioProgress(p: AudioProgressMsg): void {
    const a = this.st.activeStory;
    if (!a || a.planId !== p.planId) return;
    this.playingSegment = { index: p.segmentIndex, offsetMs: p.offsetMs };
    if (p.state === 'finished') {
      this.st = storyCompleted(this.st, this.st.now);
      this.emit({ type: 'map', action: { kind: 'follow_user' } });
      this.lastKey = '';
    } else if (p.state === 'playing' && a.status === 'playing') {
      const idx = Math.max(a.segmentIndex, Math.min(a.segmentCount - 1, p.segmentIndex));
      this.st = { ...this.st, activeStory: { ...a, segmentIndex: idx, offsetMs: idx === p.segmentIndex ? p.offsetMs : a.offsetMs } };
    }
  }

  /** A `say` directive finished playing (answers, acks, orientation). */
  sayFinished(): void {
    if (this.pendingAnswer) {
      this.pendingAnswer = false;
      this.st = answerSpoken(this.st, this.st.now);
    }
  }

  // ─────────────────────────────────────────── user intents

  control(action: ControlAction): void {
    const now = this.st.now;
    const a = this.st.activeStory;
    switch (action) {
      case 'interrupt':
        this.listening = true;
        if (a && a.status === 'playing') this.st = storyInterrupted(this.st, now, 'user_speech', { segmentIndex: this.playingSegment.index, offsetMs: this.playingSegment.offsetMs });
        break;
      case 'pause':
        if (a && a.status === 'playing') {
          this.st = storyPaused(this.st, now);
          this.emit({ type: 'stop_audio', reason: 'user_pause' });
        } else if (a && a.status === 'interrupted') {
          this.st = { ...this.st, activeStory: { ...a, status: 'paused' } };
        }
        break;
      case 'resume':
        if (a && (a.status === 'paused' || a.status === 'interrupted')) {
          const p = this.plans.get(a.planId);
          this.st = storyResumed(this.st, a.segmentIndex, now);
          if (p) this.emitPlay(p, a.segmentIndex, null);
        }
        break;
      case 'skip':
      case 'stop':
        if (a) {
          this.st = storySkipped(this.st, now);
          this.emit({ type: 'stop_audio', reason: action });
          this.emit({ type: 'map', action: { kind: 'follow_user' } });
        }
        break;
      case 'not_that_one': {
        const placeId = a?.placeId ?? this.lastPlan?.place.id ?? null;
        if (placeId) this.st = { ...this.st, memory: recordRejected(this.st.memory, placeId, now) };
        if (a) {
          this.st = storySkipped(this.st, now);
          this.emit({ type: 'stop_audio', reason: 'not_that_one' });
        }
        this.emit({ type: 'map', action: { kind: 'follow_user' } });
        break;
      }
      case 'repeat': {
        const p = a ? this.plans.get(a.planId) : this.lastPlan;
        if (p) {
          if (!a) this.st = storyStarted(this.st, { planId: p.planId, place: p.place, angle: 'origin', segmentCount: p.segments.length, at: now });
          else this.st = storyResumed(this.st, 0, now);
          this.emitPlay(p, 0, null);
        }
        break;
      }
      case 'quieter':
      case 'chattier':
        this.st = { ...this.st, memory: adjustTalkativeness(this.st.memory, action === 'quieter' ? -1 : 1) };
        break;
    }
    this.lastKey = '';
  }

  /** Listening closed without an utterance: let ResumePolicy decide on the next tick. */
  endListening(): void {
    this.listening = false;
  }

  utterance(text: string): void {
    const ctx = contextOf(this.st);
    const ru = isRu(ctx.locale);
    const it = interpretUtterance(text, ctx.locale);
    const intent = it?.intent ?? 'unknown';
    const say = (t: string, answer = true) => {
      this.pendingAnswer = answer;
      this.pendingSince = Date.now();
      this.emit({ type: 'say', text: t, audioUrl: null, purpose: 'answer' });
    };
    this.listening = false;
    switch (intent) {
      case 'skip':
      case 'stop':
      case 'pause':
      case 'resume':
      case 'repeat':
      case 'not_that_one':
        this.control(intent);
        return;
      case 'quieter':
      case 'chattier':
        this.control(intent);
        say(intent === 'quieter' ? (ru ? QUIET_ACK[this.guide.id]!.ru : QUIET_ACK[this.guide.id]!.en) : ru ? 'Хорошо, буду рассказывать чаще.' : 'All right, I’ll speak up a little more.');
        return;
      case 'change_guide': {
        const next = guideById(this.guide.id === 'ida' ? 'emil' : 'ida')!;
        this.setGuide(next.id);
        say(ru ? OPENING[next.id]!.ru : OPENING[next.id]!.en);
        return;
      }
      case 'nearby_search':
        this.nearby(ctx, it?.slots.category, ru);
        return;
      case 'navigate_to': {
        const target = this.lastPlan?.place;
        if (target) {
          const dest = target.location;
          this.emit({
            type: 'navigate_handoff',
            destination: dest,
            name: target.name,
            urls: { google: `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`, apple: `https://maps.apple.com/?daddr=${dest.lat},${dest.lng}` },
          });
          say(ru ? `Открываю маршрут до «${target.name}» в навигаторе.` : `Handing ${target.name} over to your navigation app.`);
        } else say(ru ? 'Я пока не знаю, куда именно. Сначала найдите место.' : 'I’m not sure where to. Try asking for a place first.');
        return;
      }
      default:
        this.answerFromEvidence(intent, ru);
    }
  }

  private answerFromEvidence(intent: string, ru: boolean): void {
    const a = this.st.activeStory;
    const plan = (a ? this.plans.get(a.planId) : null) ?? this.lastPlan;
    const say = (t: string) => {
      this.pendingAnswer = true;
      this.pendingSince = Date.now();
      this.emit({ type: 'say', text: t, audioUrl: null, purpose: 'answer' });
    };
    if (!plan) {
      say(ru ? 'Здесь мне пока нечего рассказать. В офлайн-демо я отвечаю только по фактам о местах, о которых рассказываю.' : 'I don’t have anything to go on here yet. In the offline demo I can only answer from the facts about places I’ve told you about.');
      return;
    }
    const pack = this.data.evidence.get(plan.place.id);
    const told = plan.segments.map((s) => s.text).join(' ');
    const facts = (pack?.facts ?? []).filter((f) => f.confidence >= 0.5);
    if (intent === 'what_is_that') {
      const id = facts.find((f) => f.kind === 'identity') ?? facts[0];
      say(id ? id.text : ru ? `Это ${plan.place.name}.` : `That’s ${plan.place.name}.`);
      return;
    }
    const fresh = facts.find((f) => !told.includes(f.text.slice(0, 40)));
    if (fresh) {
      const prefix = intent === 'tell_more' ? '' : ru ? 'В офлайн-демо я отвечаю только по источникам. Вот что есть: ' : 'In the offline demo I can only answer from my sources. Here’s one more thing: ';
      say(prefix + fresh.text);
    } else if (a && a.segmentIndex < a.segmentCount - 1) {
      say(ru ? 'Дальше в истории есть ещё — продолжаю.' : 'There’s more in the story itself. Let me carry on.');
    } else {
      say(ru ? `Это всё, что у меня есть о «${plan.place.name}» из источников.` : `That’s everything my sources say about ${plan.place.name}.`);
    }
  }

  private nearby(ctx: JourneyContext, category: string | undefined, ru: boolean): void {
    const say = (t: string) => {
      this.pendingAnswer = true;
      this.pendingSince = Date.now();
      this.emit({ type: 'say', text: t, audioUrl: null, purpose: 'answer' });
    };
    const decision = decideTool(ctx, { tool: 'nearby_search', args: { category: category ?? null }, requestedBy: 'rules' });
    if (!decision.allowed) {
      say(ru ? 'Сейчас не могу поискать — попробуйте чуть позже.' : `I can’t search right now (${decision.reason}).`);
      return;
    }
    if (!ctx.position) return;
    const radius = ctx.safety.driveSafe ? 15000 : 1500;
    const hits = this.data.source.places
      .filter((p) => matchesCategory(p, category))
      .map((p) => ({ p, d: haversineM(ctx.position!, p.location) }))
      .filter((x) => x.d <= radius)
      .sort((x, y) => Number(x.p.tags.includes('synthetic_clutter')) - Number(y.p.tags.includes('synthetic_clutter')) || x.d - y.d)
      .slice(0, 5);
    if (hits.length === 0) {
      say(ru ? 'Поблизости ничего подходящего не нашлось.' : 'I couldn’t find one nearby.');
      return;
    }
    const action: MapAction = {
      kind: 'show_results',
      results: hits.map((h) => ({ placeId: h.p.id, name: h.p.name, location: h.p.location, distanceM: Math.round(h.d), kind: h.p.kind })),
    };
    this.emit({ type: 'map', action });
    const first = hits[0]!;
    const dist = this.units === 'imperial' ? `${Math.max(0.1, first.d / 1609.344).toFixed(1)} miles` : first.d < 1000 ? `${Math.round(first.d / 10) * 10} metres` : `${(first.d / 1000).toFixed(1)} kilometres`;
    say(ru ? `Ближайшее — ${first.p.name}, примерно ${dist}.` : `The closest is ${first.p.name}, about ${dist} away.${hits.length > 1 ? ` I’ve put ${hits.length} options on the map.` : ''}`);
  }
}
