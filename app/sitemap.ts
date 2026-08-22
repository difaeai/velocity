import type { MetadataRoute } from 'next';

import { DELETE_ACCOUNT_URL, PRIVACY_URL, SITE_URL as SITE, TERMS_URL } from '@/lib/site';

/**
 * The public surface: the marketing page and the three legal documents.
 *
 * The console, the fleet portal and share links stay out — they are per-user or
 * per-link pages with nothing to index. The legal pages belong here because Play
 * Console points at them and they are the pages people search for by name.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: TERMS_URL, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: PRIVACY_URL, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: DELETE_ACCOUNT_URL, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
