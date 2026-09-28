/** Anthropic Messages API adapter (benchmark candidate for story prose / intent). */
import { ProviderError } from '../errors.js';
import { httpJson, type FetchLike } from '../http.js';
import type { CallContext, GenerateRequest, GenerateResult, TextGenerator } from '../types.js';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class AnthropicTextGenerator implements TextGenerator {
  readonly name = 'anthropic';
  get model(): string {
    return this.o.model;
  }
  constructor(private readonly o: AnthropicOptions) {}

  async generate(req: GenerateRequest, ctx?: CallContext): Promise<GenerateResult> {
    // JSON mode: instruct + prefill-free parse (the caller validates with zod anyway).
    const system = req.json ? `${req.system}\n\nRespond with a single JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(req.json.schema)}` : req.system;
    const res = await httpJson<{
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      model?: string;
    }>(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: { 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.o.model,
          max_tokens: req.maxOutputTokens,
          system,
          messages: [{ role: 'user', content: req.prompt }],
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        }),
      },
      { provider: this.name, timeoutMs: this.o.timeoutMs ?? 15_000, ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) },
    );
    const text = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!text.trim()) throw new ProviderError(this.name, 'invalid_response', 'empty completion');
    const cached = res.usage?.cache_read_input_tokens ?? 0;
    return { text, model: res.model ?? this.o.model, usage: { inputTokens: (res.usage?.input_tokens ?? 0) + cached, outputTokens: res.usage?.output_tokens ?? 0, cachedInputTokens: cached } };
  }
}
