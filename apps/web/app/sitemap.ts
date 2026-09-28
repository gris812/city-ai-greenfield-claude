import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = config.siteUrl;
  const now = new Date('2026-09-27');
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/app`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
