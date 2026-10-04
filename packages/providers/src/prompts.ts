/**
 * Prompt builders. The LLM's only jobs (D-003): prose from a fixed StoryBrief, grounded
 * follow-up answers from supplied evidence, closed-enum intent interpretation.
 *
 * D-021: prompts sent to real providers carry NO machine-readable payload block any more (it
 * roughly doubled story input tokens). The same structured input travels next to the prompt as
 * `GenerateRequest.structured` (see `*Request` builders below); only the deterministic fakes read
 * it. `readPayload` still parses legacy prompts that embed a ```json block.
 */
import type { GroundingResult, GuideProfile, Intent, StoryBrief } from '@city/core';
import { isRussian } from '@city/core';

export const INTENTS: readonly Intent[] = [
  'what_is_that',
  'tell_more',
  'ask_question',
  'skip',
  'stop',
  'pause',
  'resume',
  'repeat',
  'nearby_search',
  'navigate_to',
  'not_that_one',
  'quieter',
  'chattier',
  'change_guide',
  'smalltalk',
  'unknown',
];

export const NEARBY_CATEGORIES = ['coffee', 'parking', 'gas_station', 'ev_charging', 'restroom', 'pharmacy', 'atm', 'restaurant', 'lodging', 'rest_area', 'grocery'] as const;

export interface PromptPayload {
  kind: 'story' | 'story_retry' | 'story_body' | 'story_body_retry' | 'followup' | 'followup_retry' | 'intent';
  brief?: StoryBrief;
  question?: string;
  violations?: Pick<GroundingResult, 'unsupportedNumbers' | 'unsupportedEntities' | 'overBudget' | 'wordCount'>;
  utterance?: string;
  locale?: string;
  context?: Record<string, unknown>;
}

export function payloadBlock(p: PromptPayload): string {
  return '```json\n' + JSON.stringify(p) + '\n```';
}

/** Extract the embedded payload (used by fakes; tolerant of surrounding text). */
export function readPayload(prompt: string): PromptPayload | null {
  const m = /```json\n([\s\S]*?)\n```/.exec(prompt);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as PromptPayload;
  } catch {
    return null;
  }
}

function language(locale: string): string {
  return isRussian(locale) ? 'Russian' : 'English';
}

const GROUNDING_RULES = (b: StoryBrief) => [
  'Use ONLY the facts provided. Do not add any person, organisation, place, date, number, measurement or claim that is not in the facts, the place name, the spatial cue or the journey callbacks.',
  'Write every number as digits exactly as it appears in the facts. Never spell numbers out and never introduce new counts or estimates.',
  'Do not name any other place except those given.',
  `Hard limit: ${b.maxWords} words.`,
  'Spoken prose only: no lists, headings, markdown, emojis or stage directions.',
  b.allowQuestionsToUser ? 'You may end with at most one gentle, optional question.' : 'Do not ask the listener any questions.',
];

export function storySystemPrompt(guide: GuideProfile, locale: string): string {
  return [
    `You are ${guide.name}, a spoken audio guide. ${guide.personality}`,
    `Opening style: ${guide.narrative.openingStyle}`,
    `Sign-off style: ${guide.narrative.signoffStyle}`,
    `Speak ${language(locale)}. You turn a fixed brief into natural narration for text-to-speech.`,
    'The product has already decided WHAT place to talk about and WHICH facts are approved. You decide only HOW to say it.',
  ].join('\n');
}

export function storyPrompt(brief: StoryBrief): string {
  return [
    `Tell a ${brief.mode} story (${brief.durationBudgetS} s of speech) about ${brief.placeName} from the "${brief.angle}" angle.`,
    brief.spatialCue ? `Open by orienting the listener with this spatial cue: "${brief.spatialCue}".` : '',
    brief.journeyCallbacks.length > 0 ? `If natural, connect briefly to earlier places: ${brief.journeyCallbacks.join(', ')}.` : '',
    'Rules:',
    ...GROUNDING_RULES(brief).map((r) => `- ${r}`),
    'Approved facts:',
    ...brief.facts.map((f, i) => `${i + 1}. ${f.text}`),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Context-free story BODY prompt (D-018). A pure function of the body brief, i.e. of the shared
 * cache key: no spatial cue, no journey callbacks, no session data. The listener has just heard
 * the deterministic prefix (direction + name), so the body must not repeat or contradict it.
 */
export function storyBodyPrompt(body: StoryBrief): string {
  return [
    `Tell a ${body.mode} story (${body.durationBudgetS} s of speech) about ${body.placeName} from the "${body.angle}" angle.`,
    'The listener has just been told where the place is and its name. Do not describe its direction or distance, do not greet, and do not refer to earlier places or to the journey: start with the story itself.',
    'Rules:',
    ...GROUNDING_RULES(body).map((r) => `- ${r}`),
    'Approved facts:',
    ...body.facts.map((f, i) => `${i + 1}. ${f.text}`),
  ].join('\n');
}

export function retryPrompt(brief: StoryBrief, previous: string, g: GroundingResult, followup?: string): string {
  const problems = [
    g.unsupportedNumbers.length ? `numbers not in the facts: ${g.unsupportedNumbers.join(', ')}` : '',
    g.unsupportedEntities.length ? `names not in the facts: ${g.unsupportedEntities.join(', ')}` : '',
    g.overBudget ? `too long (${g.wordCount} words; limit ${brief.maxWords})` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return [
    followup ? `Question: "${followup}"` : '',
    `Your previous draft was rejected by the fact checker: ${problems}.`,
    'Rewrite it so that it contains none of those items and stays within the limit. Keep only what the approved facts support.',
    'Rules:',
    ...GROUNDING_RULES(brief).map((r) => `- ${r}`),
    'Approved facts:',
    ...brief.facts.map((f, i) => `${i + 1}. ${f.text}`),
    'Previous draft:',
    previous,
  ]
    .filter(Boolean)
    .join('\n');
}

export function followUpPrompt(brief: StoryBrief, question: string): string {
  return [
    `The listener asked about ${brief.placeName}: "${question}"`,
    `Answer in at most ${brief.maxWords} words, using only the approved facts. If they do not answer the question, say briefly that you don't have that detail, then share the most relevant approved fact.`,
    'Rules:',
    ...GROUNDING_RULES(brief).map((r) => `- ${r}`),
    'Approved facts:',
    ...brief.facts.map((f, i) => `${i + 1}. ${f.text}`),
  ].join('\n');
}

/** Structured twin of `retryPrompt` for fakes (D-021). */
export function retryPayload(kind: 'story_retry' | 'story_body_retry' | 'followup_retry', brief: StoryBrief, g: GroundingResult, question?: string): PromptPayload {
  return { kind, brief, ...(question ? { question } : {}), violations: { unsupportedNumbers: g.unsupportedNumbers, unsupportedEntities: g.unsupportedEntities, overBudget: g.overBudget, wordCount: g.wordCount } };
}

export const INTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'category', 'query', 'placeRef', 'confidence'],
  properties: {
    intent: { type: 'string', enum: [...INTENTS] },
    category: { type: ['string', 'null'], enum: [...NEARBY_CATEGORIES, null] },
    query: { type: ['string', 'null'] },
    placeRef: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
};

export function intentSystemPrompt(): string {
  return [
    'You classify one short spoken utterance from a user of an in-car / walking audio guide into exactly one intent from a closed list.',
    'Intents: what_is_that (asks what something visible is), tell_more (wants more on the current topic), ask_question (a question about the current subject, e.g. why/how/when/who), skip, stop, pause, resume, repeat,',
    'nearby_search (looking for a service nearby: coffee, parking, fuel…; corrections like "No, I meant parking" are nearby_search), navigate_to (directions to a named place), not_that_one (reject current topic / change topic),',
    'quieter, chattier, change_guide, smalltalk, unknown.',
    `category must be one of ${NEARBY_CATEGORIES.join(', ')} or null. placeRef is a named place the user refers to, else null. Never invent other intents.`,
  ].join('\n');
}

export function intentPrompt(utterance: string, locale: string, context: Record<string, unknown>): string {
  return [`Utterance (${locale}): "${utterance}"`, `Context: ${JSON.stringify(context)}`].join('\n');
}
