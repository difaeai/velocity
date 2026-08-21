import type { MetadataRoute } from 'next';

const SITE = 'https://velocity--velocity-fe379.us-east4.hosted.app';

/** Only the marketing page is public; the console and share links are noindex. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
}
