/**
 * Pino logger options with redaction: tokens, keys, secrets, cookies, precise coordinates
 * and request bodies never reach logs. WebSocket `?token=` is stripped from logged URLs.
 */
import type { LoggerOptions } from 'pino';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-goog-api-key"]',
  '*.token',
  '*.accessToken',
  '*.clientSecret',
  '*.apiKey',
  '*.password',
  '*.code',
  '*.lat',
  '*.lng',
  '*.fixes',
  '*.location',
  'token',
  'clientSecret',
  'apiKey',
];

export function sanitizeUrl(url: string): string {
  return url.replace(/([?&](token|code|access_token)=)[^&]+/gi, '$1[redacted]');
}

export function loggerOptions(level: string, pretty = false): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(req: { method?: string; url?: string; id?: string }) {
        return { method: req.method, url: sanitizeUrl(req.url ?? ''), id: req.id };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
    },
    ...(pretty ? {} : {}),
  };
}
