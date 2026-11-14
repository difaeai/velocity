import type { MetadataRoute } from 'next';

import { SITE_URL as SITE } from '@/lib/site';

/**
 * The private paths. The console, the login screen and the share interstitial
 * are per-user pages behind a session — nothing to index, and /link/* would
 * otherwise put one URL per shared trip into search results.
 */
const PRIVATE = ['/dashboard', '/login', '/link'];

/**
 * The crawlers that feed assistants and AI answers, named so that permission is
 * explicit rather than inferred from `*`.
 *
 * `User-agent: *` already allows every one of them, so this changes nothing for
 * a bot that reads the standard properly. It is here because several of these
 * operators document a *named* rule as the way to opt in (Google-Extended has
 * no other spelling — it is not a crawler at all, it is Gemini's permission to
 * use what Googlebot already fetched), and because an explicit list is the only
 * thing a reader can check. Allow-listing a crawler is a deliberate decision:
 * the point of this site is to be the answer when someone asks an assistant
 * which ride app still works in Pakistan.
 *
 * The private paths above are repeated here, because a named group replaces the
 * `*` group for that bot rather than adding to it.
 */
const AI_CRAWLERS = [
  // OpenAI: training, search index, and ChatGPT fetching a page a user named.
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  // Google's AI products (Gemini, AI Overviews) — separate from Googlebot.
  'Google-Extended',
  // Anthropic.
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  // The rest, in the order they matter here.
  'PerplexityBot',
  'DeepSeekBot',
  'Bytespider',
  'Amazonbot',
  'cohere-ai',
  'Meta-ExternalAgent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: PRIVATE },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
