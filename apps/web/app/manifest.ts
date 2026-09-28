import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/app',
    name: 'Telvey',
    short_name: 'Telvey',
    description: 'A local companion for wherever you are. Knows when to talk, and when to stay quiet.',
    start_url: '/app',
    scope: '/app',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F7F4EE',
    theme_color: '#0F4C5C',
    categories: ['travel', 'navigation', 'education'],
    icons: [
      { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
