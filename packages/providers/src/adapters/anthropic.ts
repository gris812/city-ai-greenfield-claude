/** Anthropic Messages API adapter (benchmark candidate for story prose / intent). */
import { ProviderError } from '../errors.js';
import { httpJson, httpRequest, sseEvents, type FetchLike } from '../http.js';
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
    if (req.onDelta) return this.stream(req, system, req.onDelta, ctx);
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

  /** Messages API SSE (D-020): message_start (input usage), content_block_delta, message_delta (output usage). */
  private async stream(req: GenerateRequest, system: string, onDelta: (d: string) => void, ctx?: CallContext): Promise<GenerateResult> {
    const res = await httpRequest(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: { 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ model: this.o.model, max_tokens: req.maxOutputTokens, system, messages: [{ role: 'user', content: req.prompt }], stream: true, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) }),
      },
      { provider: this.name, timeoutMs: this.o.timeoutMs ?? 15_000, ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) },
    );
    let text = '';
    let model = this.o.model;
    let input = 0;
    let cached = 0;
    let output = 0;
    for await (const e of sseEvents(res, this.name)) {
      let j: { type?: string; message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } }; delta?: { type?: string; text?: string }; usage?: { output_tokens?: number }; error?: { type?: string; message?: string } };
      try {
        j = JSON.parse(e.data);
      } catch {
        continue;
      }
      if (j.type === 'message_start') {
        model = j.message?.model ?? model;
        input = j.message?.usage?.input_tokens ?? 0;
        cached = j.message?.usage?.cache_read_input_tokens ?? 0;
        output = j.message?.usage?.output_tokens ?? 0;
      } else if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) {
        text += j.delta.text;
        onDelta(j.delta.text);
      } else if (j.type === 'message_delta' && j.usage?.output_tokens !== undefined) {
        output = j.usage.output_tokens;
      } else if (j.type === 'error') {
        throw new ProviderError(this.name, j.error?.type === 'overloaded_error' ? 'server' : 'invalid_response', `stream error: ${j.error?.type ?? 'unknown'}`);
      }
    }
    if (!text.trim()) throw new ProviderError(this.name, 'invalid_response', 'empty completion');
    return { text, model, usage: { inputTokens: input + cached, outputTokens: output, cachedInputTokens: cached } };
  }
}
