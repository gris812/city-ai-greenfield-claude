/** Typed provider errors: the resilience layer decides retry/breaker behaviour from `kind`. */

export type ProviderErrorKind =
  | 'timeout'
  | 'quota' // 429 / RESOURCE_EXHAUSTED / billing
  | 'auth' // 401/403: invalid or missing credential — never retried
  | 'bad_request' // 400/404/422: our request is wrong — never retried
  | 'server' // 5xx
  | 'network'
  | 'invalid_response' // unparseable / schema mismatch
  | 'budget' // ProviderBudget refused (cap or kill switch)
  | 'circuit_open'
  | 'aborted'
  | 'not_configured';

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(['timeout', 'server', 'network']);

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(provider: string, kind: ProviderErrorKind, message: string, opts: { status?: number | null; retryAfterMs?: number | null; cause?: unknown } = {}) {
    super(`[${provider}] ${kind}: ${message}`, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryable = RETRYABLE.has(kind);
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Map an HTTP status to an error kind. */
export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || status === 402) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** Normalize anything thrown by an adapter into a ProviderError. */
export function toProviderError(provider: string, e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { name?: string; message?: string; code?: string } | undefined;
  if (err?.name === 'TimeoutError') return new ProviderError(provider, 'timeout', 'request timed out', { cause: e });
  if (err?.name === 'AbortError') return new ProviderError(provider, 'aborted', 'request aborted', { cause: e });
  const msg = err?.message ?? String(e);
  return new ProviderError(provider, 'network', msg.slice(0, 200), { cause: e });
}
