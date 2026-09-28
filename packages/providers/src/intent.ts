/**
 * Intent interpretation beyond core's rules (D-003): the LLM may only choose from the closed
 * `Intent` enum; output is validated with zod and anything else becomes 'unknown'. A
 * deterministic heuristic interpreter is the final fallback (no LLM configured / LLM down).
 */
import { z } from 'zod';
import type { Intent, InterpretedUtterance, Locale } from '@city/core';
import { extractCategory } from '@city/core';
import { INTENTS, INTENT_SCHEMA, NEARBY_CATEGORIES, intentPrompt, intentSystemPrompt } from './prompts.js';
import type { CallContext, IntentContext, IntentInterpreter } from './types.js';
import type { GenerateFn } from './story.js';

const IntentOut = z.object({
  intent: z.string(),
  category: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
  placeRef: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Validate a model's JSON into a closed-enum InterpretedUtterance. */
export function validateIntentJson(text: string, utterance: string): InterpretedUtterance {
  const parsed = IntentOut.safeParse(parseJsonLoose(text));
  if (!parsed.success) return { text: utterance, intent: 'unknown', slots: {}, confidence: 0, interpretedBy: 'llm' };
  const d = parsed.data;
  const intent: Intent = (INTENTS as readonly string[]).includes(d.intent) ? (d.intent as Intent) : 'unknown';
  const cat = d.category && (NEARBY_CATEGORIES as readonly string[]).includes(d.category) ? d.category : intent === 'nearby_search' ? extractCategory(utterance) : null;
  const slots: InterpretedUtterance['slots'] = {};
  if (cat) slots.category = cat;
  if (d.query) slots.query = d.query.slice(0, 200);
  if (d.placeRef) slots.placeRef = d.placeRef.slice(0, 200);
  if (intent === 'nearby_search' && !slots.query) slots.query = utterance;
  return { text: utterance, intent, slots, confidence: Math.max(0, Math.min(1, d.confidence ?? 0.6)), interpretedBy: 'llm' };
}

export class LlmIntentInterpreter implements IntentInterpreter {
  readonly name: string;
  readonly model: string | null;
  constructor(
    private readonly generate: GenerateFn,
    info: { name: string; model: string | null },
  ) {
    this.name = info.name;
    this.model = info.model;
  }

  async interpret(text: string, locale: Locale, context: IntentContext, _ctx?: CallContext): Promise<InterpretedUtterance> {
    const r = await this.generate({ system: intentSystemPrompt(), prompt: intentPrompt(text, String(locale), { ...context }), maxOutputTokens: 120, temperature: 0, json: { name: 'intent', schema: INTENT_SCHEMA }, task: 'intent' });
    return validateIntentJson(r.text, text);
  }
}

const QUESTION_EN = /\b(why|how|when|who|what|which|where did|is it|was it|did (it|they)|tell me about)\b/i;
const QUESTION_RU = /(почему|зачем|как |когда|кто |что |какой|какая|расскажи про)/iu;
const TOPIC_CHANGE = /\b(something else|another topic|change (the )?(topic|subject)|talk about)\b|другое|другую тему|смени тему/iu;
const SMALLTALK = /^\s*(hi|hello|hey|thanks|thank you|good (morning|evening)|привет|спасибо|здравствуй\p{L}*)\b/iu;

/**
 * Deterministic fallback interpreter. Closed-enum by construction; used when no LLM is
 * configured or the LLM path fails, and as the test/dev "fake".
 */
export class HeuristicIntentInterpreter implements IntentInterpreter {
  readonly name = 'heuristic';
  readonly model = null;
  readonly fake = false;

  async interpret(text: string, _locale: Locale, context: IntentContext): Promise<InterpretedUtterance> {
    return heuristicIntent(text, context);
  }
}

export function heuristicIntent(text: string, context: IntentContext = {}): InterpretedUtterance {
  const t = text.trim();
  const base = { text: t, interpretedBy: 'llm' as const };
  const category = extractCategory(t);
  if (category) return { ...base, intent: 'nearby_search', slots: { category, query: t }, confidence: context.previousIntent === 'nearby_search' ? 0.85 : 0.7 };
  if (TOPIC_CHANGE.test(t)) return { ...base, intent: 'not_that_one', slots: {}, confidence: 0.7 };
  if (SMALLTALK.test(t)) return { ...base, intent: 'smalltalk', slots: {}, confidence: 0.7 };
  if (QUESTION_EN.test(t) || QUESTION_RU.test(t) || t.endsWith('?')) return { ...base, intent: 'ask_question', slots: { query: t }, confidence: 0.65 };
  return { ...base, intent: 'unknown', slots: {}, confidence: 0.3 };
}
