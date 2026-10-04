/**
 * Grounded generation pipeline (D-003 / D-009, acceptance F3):
 *   prompt → LLM → checkGrounding → (one constrained retry) → deterministic template.
 * The brief fixes the target: generated text can only change HOW a place is described,
 * never WHICH place (the plan is always built from the brief's placeId).
 */
import type { EvidenceFact, EvidencePack, FactKind, GroundingResult, GuideProfile, Intent, NarrativePlan, StoryBrief } from '@city/core';
import { checkGrounding, cmpStr, isRussian, stableId, templateBody, templateNarrative, wordCount } from '@city/core';
import { followUpPrompt, retryPayload, retryPrompt, storyBodyPrompt, storyPrompt, storySystemPrompt } from './prompts.js';
import type { GenerateRequest, GenerateResult } from './types.js';

export type GenerateFn = (req: GenerateRequest) => Promise<GenerateResult & { provider: string }>;

export interface GroundedText {
  text: string;
  generatedBy: NarrativePlan['generatedBy'];
  grounding: GroundingResult;
  /** LLM attempts made (0 = no generator). */
  attempts: number;
  fallbackReason: 'no_generator' | 'generator_error' | 'grounding_failed' | null;
  usage: { inputTokens: number; outputTokens: number };
}

/** Strip formatting an LLM may add despite instructions. */
export function cleanProse(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^["“](.*)["”]$/s, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function maxTokensFor(words: number): number {
  // ~1.4 tokens/word (EN) … ~2.5 (RU); generous headroom, bounded.
  return Math.min(1200, Math.max(120, Math.round(words * 3)));
}

async function groundedLoop(brief: StoryBrief, guide: GuideProfile, generate: GenerateFn | null, first: GenerateRequest, retry: (prev: string, g: GroundingResult) => GenerateRequest, fallback: () => string): Promise<GroundedText> {
  const allow = [guide.name];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const fb = (reason: GroundedText['fallbackReason'], attempts: number): GroundedText => {
    const text = fallback();
    return { text, generatedBy: { kind: 'template' }, grounding: checkGrounding(text, brief, { allow }), attempts, fallbackReason: reason, usage };
  };
  if (!generate) return fb('no_generator', 0);
  let attempts = 0;
  let req = first;
  for (let i = 0; i < 2; i++) {
    let r: GenerateResult & { provider: string };
    try {
      attempts++;
      r = await generate(req);
    } catch {
      return fb('generator_error', attempts);
    }
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
    const text = cleanProse(r.text);
    const g = checkGrounding(text, brief, { allow });
    if (g.ok && text.length > 0) return { text, generatedBy: { kind: 'llm', provider: r.provider, model: r.model }, grounding: g, attempts, fallbackReason: null, usage };
    req = retry(text, g); // exactly one constrained retry
  }
  return fb('grounding_failed', attempts);
}

export function generateGroundedNarrative(brief: StoryBrief, guide: GuideProfile, generate: GenerateFn | null): Promise<GroundedText> {
  const system = storySystemPrompt(guide, brief.locale);
  const maxOutputTokens = maxTokensFor(brief.maxWords);
  return groundedLoop(
    brief,
    guide,
    generate,
    { system, prompt: storyPrompt(brief), structured: { kind: 'story', brief }, maxOutputTokens, temperature: 0.7, task: 'story_generation' },
    (prev, g) => ({ system, prompt: retryPrompt(brief, prev, g), structured: retryPayload('story_retry', brief, g), maxOutputTokens, temperature: 0.3, task: 'story_generation_retry' }),
    () => templateNarrative(brief, guide),
  );
}

/**
 * Context-free story body (D-018): generated from the body brief only, at temperature 0 (the
 * result is cached and shared, so it should be as reproducible as the provider allows), grounded
 * against the body brief (stricter than the full brief: no cue/callback names), one constrained
 * retry, then the deterministic body template.
 */
export function generateGroundedBody(body: StoryBrief, guide: GuideProfile, generate: GenerateFn | null): Promise<GroundedText> {
  const system = storySystemPrompt(guide, body.locale);
  const maxOutputTokens = maxTokensFor(body.maxWords);
  return groundedLoop(
    body,
    guide,
    generate,
    { system, prompt: storyBodyPrompt(body), structured: { kind: 'story_body', brief: body }, maxOutputTokens, temperature: 0, task: 'story_generation' },
    (prev, g) => ({ system, prompt: retryPrompt(body, prev, g), structured: retryPayload('story_body_retry', body, g), maxOutputTokens, temperature: 0, task: 'story_generation_retry' }),
    () => templateBody(body),
  );
}

// ─────────────────────────────────────────────── follow-ups (C2 / B1)

const WHY_KINDS: FactKind[] = ['event', 'culture', 'person', 'date', 'architecture', 'quantity', 'trivia', 'nature', 'identity', 'practical'];

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4),
  );
}

/**
 * Deterministic follow-up brief: facts from the SAME evidence pack, preferring ones not yet
 * spoken (B1: continue, don't repeat), ranked by overlap with the question, then by a
 * why/how-friendly kind order. Never contains facts from another place.
 */
export function followUpBrief(base: StoryBrief, pack: EvidencePack, question: string, intent: Intent, spokenFactIds: ReadonlySet<string>, maxWords: number): StoryBrief {
  const q = tokens(question);
  const usable = pack.facts.filter((f) => f.confidence >= 0.5 && f.placeId === base.placeId);
  const unspoken = usable.filter((f) => !spokenFactIds.has(f.id));
  const pool = intent === 'tell_more' ? unspoken : unspoken.length > 0 ? unspoken : usable;
  const score = (f: EvidenceFact) => {
    let overlap = 0;
    for (const w of tokens(f.text)) if (q.has(w)) overlap++;
    return overlap * 10 - WHY_KINDS.indexOf(f.kind);
  };
  const ranked = [...pool].sort((a, b) => score(b) - score(a) || b.confidence - a.confidence || cmpStr(a.id, b.id));
  const facts: EvidenceFact[] = [];
  let words = 0;
  for (const f of ranked) {
    const w = wordCount(f.text);
    if (facts.length > 0 && words + w > maxWords * 0.85) break;
    facts.push(f);
    words += w;
    if (facts.length >= 3) break;
  }
  return {
    ...base,
    id: stableId('brief', base.id, 'followup', question, facts.map((f) => f.id).join(',')),
    mode: 'short',
    facts,
    maxWords,
    durationBudgetS: Math.round(maxWords / 2.4),
    spatialCue: null,
    journeyCallbacks: [],
    allowQuestionsToUser: false,
  };
}

/** Deterministic grounded answer: approved fact texts only, or an honest "no detail". */
export function deterministicAnswer(brief: StoryBrief): string {
  const ru = isRussian(brief.locale);
  if (brief.facts.length === 0) return ru ? `Больше подробностей о месте «${brief.placeName}» у меня сейчас нет.` : `I don't have more detail on ${brief.placeName} right now.`;
  const parts: string[] = [];
  for (const f of brief.facts) {
    const t = /[.!?…]$/.test(f.text.trim()) ? f.text.trim() : `${f.text.trim()}.`;
    if (parts.length > 0 && wordCount([...parts, t].join(' ')) > brief.maxWords) break;
    parts.push(t);
  }
  return parts.join(' ');
}

export function generateGroundedAnswer(question: string, brief: StoryBrief, guide: GuideProfile, generate: GenerateFn | null): Promise<GroundedText> {
  const system = storySystemPrompt(guide, brief.locale);
  const maxOutputTokens = maxTokensFor(brief.maxWords);
  if (brief.facts.length === 0) generate = null; // nothing to ground on → honest deterministic line
  return groundedLoop(
    brief,
    guide,
    generate,
    { system, prompt: followUpPrompt(brief, question), structured: { kind: 'followup', brief, question }, maxOutputTokens, temperature: 0.4, task: 'followup_answer' },
    (prev, g) => ({ system, prompt: retryPrompt(brief, prev, g, question), structured: retryPayload('followup_retry', brief, g, question), maxOutputTokens, temperature: 0.2, task: 'followup_answer_retry' }),
    () => deterministicAnswer(brief),
  );
}

// ─────────────────────────────────────────────── streamed follow-ups (D-020)

/** Sentence boundary: terminal punctuation, whitespace, then a sentence-opening character. */
const BOUNDARY = /(?<=[.!?…]["»”’)]*)\s+(?=[\p{Lu}«"“(\d])/u;

/** Split off complete sentences; the remainder may still grow. */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const out: string[] = [];
  let rest = buffer;
  for (;;) {
    const m = BOUNDARY.exec(rest);
    if (!m) break;
    const s = rest.slice(0, m.index).trim();
    if (s) out.push(s);
    rest = rest.slice(m.index + m[0].length);
  }
  return { sentences: out, rest };
}

function ensurePeriod(t: string): string {
  const x = t.trim();
  return /[.!?…]$/.test(x) ? x : `${x}.`;
}

export interface StreamedAnswer extends GroundedText {
  sentences: string[];
  /** Unsupported sentences replaced by a deterministic fact sentence. */
  replaced: number;
  /** Unsupported sentences dropped (no unspoken fact left to replace them with). */
  dropped: number;
  /** Sentences ignored after the word budget was reached. */
  truncated: number;
}

/**
 * Streamed, sentence-by-sentence grounded answer (D-020). The LLM answer is streamed; every
 * complete sentence is grounded on its own (numbers and names must be in the follow-up brief)
 * BEFORE `onSentence` hands it to speech, so first audio can start after sentence 1:
 *  - a supported sentence is spoken as is;
 *  - an unsupported sentence is replaced by the next unspoken approved fact (deterministic),
 *    or dropped when none is left;
 *  - sentences past the word budget (+15 %) are ignored.
 * There is no constrained retry here (it would cost a full extra round trip); if nothing
 * survives, or the provider fails before anything was spoken, the deterministic answer is
 * spoken instead. Fact choice stays deterministic (the brief), the LLM only phrases.
 */
export async function streamGroundedAnswer(question: string, brief: StoryBrief, guide: GuideProfile, generate: GenerateFn | null, onSentence: (text: string, index: number) => void): Promise<StreamedAnswer> {
  const allow = [guide.name];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const spoken: string[] = [];
  const usedFacts = new Set<string>();
  let words = 0;
  let replaced = 0;
  let dropped = 0;
  let truncated = 0;
  const budget = brief.maxWords * 1.15;
  const unconstrained: StoryBrief = { ...brief, maxWords: Number.MAX_SAFE_INTEGER };
  const factFor = (text: string): string[] => {
    const lower = text.toLowerCase();
    return brief.facts.filter((f) => lower.includes(f.text.toLowerCase().slice(0, 30)) || [...f.entities, ...f.numbers].some((c) => c.length >= 3 && lower.includes(c.toLowerCase()))).map((f) => f.id);
  };
  const speak = (t: string) => {
    const wc = wordCount(t);
    if (words + wc > budget && spoken.length > 0) {
      truncated++;
      return;
    }
    words += wc;
    for (const id of factFor(t)) usedFacts.add(id);
    spoken.push(t);
    onSentence(t, spoken.length - 1);
  };
  const handle = (sentence: string) => {
    if (words >= budget) {
      truncated++;
      return;
    }
    const g = checkGrounding(sentence, unconstrained, { allow });
    if (g.ok) return speak(sentence);
    const next = brief.facts.find((f) => !usedFacts.has(f.id) && f.confidence >= 0.5);
    if (!next) {
      dropped++;
      return;
    }
    replaced++;
    usedFacts.add(next.id);
    speak(ensurePeriod(next.text));
  };
  const deterministic = (reason: GroundedText['fallbackReason'], attempts: number): StreamedAnswer => {
    const text = deterministicAnswer(brief);
    const parts = takeSentences(`${text} `);
    const all = [...parts.sentences, ...(parts.rest.trim() ? [parts.rest.trim()] : [])];
    for (const t of all) {
      spoken.push(t);
      onSentence(t, spoken.length - 1);
    }
    return { text: spoken.join(' '), generatedBy: { kind: 'template' }, grounding: checkGrounding(spoken.join(' '), brief, { allow }), attempts, fallbackReason: reason, usage, sentences: [...spoken], replaced, dropped, truncated };
  };
  if (!generate || brief.facts.length === 0) return deterministic('no_generator', 0);

  let buffer = '';
  let result: (GenerateResult & { provider: string }) | null = null;
  try {
    result = await generate({
      system: storySystemPrompt(guide, brief.locale),
      prompt: followUpPrompt(brief, question),
      structured: { kind: 'followup', brief, question },
      maxOutputTokens: maxTokensFor(brief.maxWords),
      temperature: 0.4,
      task: 'followup_answer',
      onDelta: (d) => {
        buffer += d;
        const { sentences, rest } = takeSentences(buffer);
        buffer = rest;
        for (const x of sentences) handle(x);
      },
    });
  } catch {
    if (spoken.length === 0) return deterministic('generator_error', 1);
  }
  if (result) {
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    if (buffer.trim()) handle(buffer.trim());
    buffer = '';
  }
  if (spoken.length === 0) return deterministic('grounding_failed', 1);
  const text = spoken.join(' ');
  return {
    text,
    generatedBy: result ? { kind: 'llm', provider: result.provider, model: result.model } : { kind: 'template' },
    grounding: checkGrounding(text, brief, { allow }),
    attempts: 1,
    fallbackReason: result ? null : 'generator_error',
    usage,
    sentences: [...spoken],
    replaced,
    dropped,
    truncated,
  };
}
