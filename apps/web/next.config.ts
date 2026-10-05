import type { NextConfig } from 'next';

/**
 * Security headers (CSP, HSTS, frame-ancestors 'none') + standalone output for Docker.
 *
 * CSP notes:
 *  - Next.js App Router streams inline bootstrap scripts; without per-request nonces (which
 *    would make every marketing page dynamic) script-src needs 'unsafe-inline'. Everything
 *    else is locked to self + the explicitly configured API / map origins.
 *  - Map tiles: OSM raster (tile.openstreetmap.org), optional vector style host
 *    (NEXT_PUBLIC_MAP_STYLE_URL) and, when NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY is set, Google Maps JS.
 */
const isDev = process.env.NODE_ENV !== 'production';

function origin(u: string | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

const api = origin(process.env.NEXT_PUBLIC_API_BASE_URL);
const apiWs = api ? api.replace(/^http/, 'ws') : null;
const styleHost = origin(process.env.NEXT_PUBLIC_MAP_STYLE_URL);
const google = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY);

const tiles = ['https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'];
const googleHosts = google ? ['https://maps.googleapis.com', 'https://maps.gstatic.com', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.ggpht.com'] : [];

const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${google ? 'https://maps.googleapis.com https://maps.gstatic.com' : ''}`.trim(),
  `style-src 'self' 'unsafe-inline' ${google ? 'https://fonts.googleapis.com' : ''}`.trim(),
  `img-src 'self' data: blob: ${[...tiles, ...googleHosts, styleHost ?? ''].join(' ')}`.trim(),
  `font-src 'self' data: ${google ? 'https://fonts.gstatic.com' : ''}`.trim(),
  `connect-src 'self' ${[api, apiWs, ...tiles, styleHost, ...googleHosts].filter(Boolean).join(' ')}${isDev ? ' ws:' : ''}`.trim(),
  `media-src 'self' blob: data: ${api ?? ''}`.trim(),
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
  `frame-src 'none'`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), microphone=(self), camera=(), payment=(), usb=(), interest-cohort=()' },
];

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@city/core', '@city/client'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  webpack(cfg) {
    // @city/core uses NodeNext-style '.js' specifiers that point at '.ts' sources.
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return cfg;
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/demo/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
    ];
  },
};

export default config;
