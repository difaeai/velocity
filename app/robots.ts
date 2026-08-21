import type { MetadataRoute } from 'next';

const SITE = 'https://velocity--velocity-fe379.us-east4.hosted.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/dashboard', '/login', '/link'] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
