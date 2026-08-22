import type { MetadataRoute } from 'next';

import { SITE_URL as SITE } from '@/lib/site';

/** Only the marketing page is public; the console and share links are noindex. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
}
