/**
 * Minimal fetch wrapper for adapters: per-call timeout, cancellation, proxy support and
 * error normalization. Node 22's global fetch ignores HTTPS_PROXY, so when a proxy is
 * configured we route through undici's EnvHttpProxyAgent (which also honours NO_PROXY).
 * Secrets never appear in thrown errors: only status + a truncated, redacted body.
 */
import { EnvHttpProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { ProviderError, kindForStatus, toProviderError } from './errors.js';
import type { CallContext } from './types.js';

export type FetchLike = (url: string, init: RequestInit & { dispatcher?: Dispatcher }) => Promise<Response>;

let dispatcher: Dispatcher | undefined;
function proxyDispatcher(): Dispatcher | undefined {
  if (dispatcher) return dispatcher;
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
    dispatcher = new EnvHttpProxyAgent();
  }
  return dispatcher;
}

export const defaultFetch: FetchLike = (url, init) => {
  const d = proxyDispatcher();
  return undiciFetch(url, { ...(init as object), ...(d ? { dispatcher: d } : {}) } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
};

const SECRETISH = /(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+|key=[A-Za-z0-9_-]+)/g;
export function redact(s: string): string {
  return s.replace(SECRETISH, '[redacted]');
}

export interface HttpOptions {
  provider: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  ctx?: CallContext;
}

function signalFor(timeoutMs: number, ctx?: CallContext): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return ctx?.signal ? AbortSignal.any([t, ctx.signal]) : t;
}

async function failFromResponse(provider: string, res: Response): Promise<never> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  const ra = res.headers.get('retry-after');
  const retryAfterMs = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : null;
  throw new ProviderError(provider, kindForStatus(res.status), `HTTP ${res.status} ${redact(body)}`, { status: res.status, retryAfterMs });
}

export async function httpRequest(url: string, init: RequestInit, o: HttpOptions): Promise<Response> {
  const f = o.fetchImpl ?? defaultFetch;
  let res: Response;
  try {
    res = await f(url, { ...init, signal: signalFor(o.timeoutMs, o.ctx) });
  } catch (e) {
    throw toProviderError(o.provider, e);
  }
  if (!res.ok) await failFromResponse(o.provider, res);
  return res;
}

export async function httpJson<T = unknown>(url: string, init: RequestInit, o: HttpOptions): Promise<T> {
  const res = await httpRequest(url, init, o);
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new ProviderError(o.provider, 'invalid_response', 'response is not JSON', { cause: e });
  }
}

export async function httpBytes(url: string, init: RequestInit, o: HttpOptions): Promise<{ bytes: Uint8Array; ttfbMs: number; contentType: string | null }> {
  const t0 = performance.now();
  const res = await httpRequest(url, init, o);
  const ttfbMs = performance.now() - t0;
  try {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, ttfbMs, contentType: res.headers.get('content-type') };
  } catch (e) {
    throw toProviderError(o.provider, e);
  }
}

export interface SseEvent {
  event: string | null;
  data: string;
}

/**
 * Server-sent events from a streaming response (D-020): yields one event per blank-line
 * separated block (`event:` + joined `data:` lines). Works for OpenAI, Gemini (`alt=sse`) and
 * Anthropic streams. Errors while reading become ProviderErrors.
 */
export async function* sseEvents(res: Response, provider: string): AsyncGenerator<SseEvent> {
  if (!res.body) throw new ProviderError(provider, 'invalid_response', 'no response body');
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = '';
  const parse = (block: string): SseEvent | null => {
    let event: string | null = null;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length > 0 || event ? { event, data: data.join('\n') } : null;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buf)) !== null) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const e = parse(block);
        if (e) yield e;
      }
    }
    buf += dec.decode();
    const tail = parse(buf.trim());
    if (tail) yield tail;
  } catch (e) {
    throw toProviderError(provider, e);
  } finally {
    reader.releaseLock();
  }
}
