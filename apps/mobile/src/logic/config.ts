/** Pure config helpers (unit-tested; no React Native imports). */
import { cleanBaseUrl } from '@city/client';

/**
 * Normalize the API base URL from the build environment. Placeholder hosts (`*.example`,
 * `example.com`, `localhost` in release builds is allowed for emulators) are treated as "not
 * configured" so the app says so plainly instead of reporting an unreachable server.
 */
export function apiBaseFromEnv(raw: string | null | undefined): { baseUrl: string | null; placeholder: boolean } {
  const base = cleanBaseUrl(raw);
  if (!base) return { baseUrl: null, placeholder: false };
  let host = '';
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { baseUrl: null, placeholder: false };
    host = u.hostname.toLowerCase();
  } catch {
    return { baseUrl: null, placeholder: false };
  }
  if (host.endsWith('.example') || host === 'example.com' || host.endsWith('.example.com') || host.includes('replace')) return { baseUrl: null, placeholder: true };
  return { baseUrl: base, placeholder: false };
}

/** Accept a pairing QR's `api` only when it matches the build's API (prevents pointing the app elsewhere). */
export function pairingApiAllowed(qrApi: string | null, buildApi: string | null, allowOverride: boolean): { ok: boolean; api: string | null; reason?: string } {
  const q = cleanBaseUrl(qrApi);
  if (!q) return { ok: buildApi !== null, api: buildApi, ...(buildApi ? {} : { reason: 'no_api' }) };
  if (buildApi && q === buildApi) return { ok: true, api: q };
  if (allowOverride) return { ok: true, api: q };
  return { ok: false, api: buildApi, reason: 'api_mismatch' };
}
