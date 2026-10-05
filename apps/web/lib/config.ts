/**
 * Public runtime configuration. Only NEXT_PUBLIC_* values reach the browser bundle, and they
 * must never hold secrets (the Google Maps web key must be HTTP-referrer restricted).
 */
function clean(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t.replace(/\/+$/, '') : null;
}

export const config = {
  /** Backend base URL (docs/API.md). Unset → the WebApp runs in offline demo mode. */
  apiBaseUrl: clean(process.env.NEXT_PUBLIC_API_BASE_URL),
  /** Referrer-restricted browser key. When set, the WebApp uses Google Maps JS (Places data must be shown on a Google map). */
  googleMapsKey: clean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY),
  /** Optional MapLibre vector style URL; default is a muted OSM raster base. */
  mapStyleUrl: clean(process.env.NEXT_PUBLIC_MAP_STYLE_URL),
  siteUrl: clean(process.env.NEXT_PUBLIC_SITE_URL) ?? 'http://localhost:3000',
  earlyAccess: {
    android: clean(process.env.NEXT_PUBLIC_ANDROID_TEST_URL),
    ios: clean(process.env.NEXT_PUBLIC_IOS_TEST_URL),
    signup: clean(process.env.NEXT_PUBLIC_EARLY_ACCESS_URL),
  },
  contactEmail: clean(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
  buildSha: clean(process.env.NEXT_PUBLIC_BUILD_SHA) ?? 'dev',
} as const;

export const BRAND = {
  name: 'Telvey',
  tagline: 'A local companion for wherever you are.',
  promise: 'Knows when to talk, and when to stay quiet.',
} as const;
