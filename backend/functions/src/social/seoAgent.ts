/**
 * Vexa's SEO agent — read the customer's website, tell their developer what to add.
 * ----------------------------------------------------------------------------
 * The owner's brief (2026-11-17): "jiska kaam he ye hai k wo website ki SEO
 * krta hai or web developer ko pora seo kr k btata hai k kahan kia add kro jis
 * se website rank hoge" — it does the site's SEO and tells the web developer
 * where to add what, so the site ranks.
 *
 * So the output is NOT a score out of a hundred. A score tells a developer
 * nothing they can act on. Every finding here carries the exact thing to paste
 * and the place to paste it, because that is the difference between an audit
 * somebody reads and an audit somebody ships.
 *
 * NO API KEY, NO CRAWLER
 * ----------------------
 * It fetches the pages it is pointed at and reads the HTML itself. Every check
 * below is a real, mechanical SEO signal — the ones a search engine actually
 * reads — so this needs no model, no key and no third-party SEO service, and it
 * costs a few HTTP requests. (Vexa's writing agents can dress the findings up
 * later; the findings themselves must not depend on a model being reachable.)
 *
 * WHAT IT WILL NOT DO
 * It only ever fetches the site the customer entered, plus that site's own
 * robots.txt and sitemap.xml. It is not a crawler for hire: the URL is checked
 * to be http(s) and public, and nothing follows a link off the host.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { FieldValue } from '../lib/firebase';
import { invalid, requireAuth } from '../lib/guards';
import { sdb } from './workspace';

export type SeoSeverity = 'critical' | 'important' | 'polish';

export interface SeoFinding {
  id: string;
  severity: SeoSeverity;
  /** What is wrong, in one line a non-developer understands. */
  title: string;
  /** Why a search engine cares. */
  why: string;
  /** Exactly where it goes. */
  where: string;
  /** Exactly what to paste. Empty when the fix is "write something". */
  fix: string;
}

/**
 * A URL we are willing to fetch: public http(s) only.
 *
 * This is a server making a request on a customer's say-so, so the obvious
 * abuses are refused rather than trusted — a `file://` URL, and the private
 * address ranges that would turn this into a probe of our own network.
 */
function publicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    invalid('That does not look like a website address.');
  }
  if (u!.protocol !== 'http:' && u!.protocol !== 'https:') {
    invalid('Enter a website address starting with https://');
  }
  const host = u!.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) invalid('That address is not reachable from the public internet.');
  return u!;
}

/** One fetch, with a ceiling on both time and size. */
async function get(url: string): Promise<{ status: number; body: string; headers: Headers } | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        // A plain, honest client name. Never the customer's own details.
        'User-Agent': 'VelocitySEOBot/1.0 (+https://velocityrides.app)',
        Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
      },
      signal: AbortSignal.timeout(12_000),
    });
    const raw = await res.text();
    // A megabyte is far more HTML than any page needs, and keeps a hostile
    // response from filling the function's memory.
    return { status: res.status, body: raw.slice(0, 1_000_000), headers: res.headers };
  } catch {
    return null;
  }
}

const tag = (html: string, re: RegExp): string | null => {
  const m = re.exec(html);
  return m ? (m[1] ?? '').trim() : null;
};

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const DESC_RE = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i;
const CANONICAL_RE = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i;
const VIEWPORT_RE = /<meta[^>]+name=["']viewport["']/i;
const LANG_RE = /<html[^>]+lang=["']([^"']*)["']/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
const IMG_RE = /<img\b[^>]*>/gi;
const OG_TITLE_RE = /<meta[^>]+property=["']og:title["']/i;
const OG_IMAGE_RE = /<meta[^>]+property=["']og:image["']/i;
const JSONLD_RE = /<script[^>]+type=["']application\/ld\+json["']/i;
const NOINDEX_RE = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i;

/** Visible words, roughly — scripts, styles and tags stripped. */
function wordCount(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.split(' ').length : 0;
}

/**
 * The audit itself. Pure: hand it the fetched material and it returns findings,
 * so every rule below is testable without a network.
 */
export function auditHtml(args: {
  url: string;
  html: string;
  status: number;
  robotsTxt: string | null;
  sitemapOk: boolean;
}): SeoFinding[] {
  const { url, html, status, robotsTxt, sitemapOk } = args;
  const out: SeoFinding[] = [];
  const host = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  })();

  if (status >= 400) {
    out.push({
      id: 'status',
      severity: 'critical',
      title: `The page answered ${status}`,
      why: 'A page that does not return 200 is not indexed at all. Nothing else on this list matters until it does.',
      where: 'Your server or hosting',
      fix: '',
    });
    return out;
  }

  if (NOINDEX_RE.test(html)) {
    out.push({
      id: 'noindex',
      severity: 'critical',
      title: 'This page tells search engines to ignore it',
      why: 'A robots meta tag with "noindex" removes the page from Google entirely. It is usually left over from a staging site.',
      where: 'In <head> — find the existing robots meta tag',
      fix: '<meta name="robots" content="index, follow">',
    });
  }

  const title = tag(html, TITLE_RE);
  if (!title) {
    out.push({
      id: 'title',
      severity: 'critical',
      title: 'No page title',
      why: 'The title is the blue line in every search result and the single strongest on-page signal.',
      where: 'Inside <head>, first thing',
      fix: '<title>Your main keyword — what you do | Your brand</title>',
    });
  } else if (title.length < 15 || title.length > 60) {
    out.push({
      id: 'title-length',
      severity: 'important',
      title: `Title is ${title.length} characters — aim for 15–60`,
      why: 'Google cuts titles around 60 characters, and a very short one wastes the strongest signal you have.',
      where: 'Inside <head>',
      fix: `<title>${title.slice(0, 55)}</title>`,
    });
  }

  const desc = tag(html, DESC_RE);
  if (!desc) {
    out.push({
      id: 'description',
      severity: 'important',
      title: 'No meta description',
      why: 'This is the grey text under your link in search results. Without it Google writes its own, usually badly.',
      where: 'Inside <head>',
      fix: '<meta name="description" content="One sentence, 120–155 characters, saying what you do and where.">',
    });
  } else if (desc.length < 70 || desc.length > 160) {
    out.push({
      id: 'description-length',
      severity: 'polish',
      title: `Meta description is ${desc.length} characters — aim for 120–155`,
      why: 'Too short wastes the space; past about 160 it is cut off mid-sentence.',
      where: 'Inside <head>',
      fix: '',
    });
  }

  const h1s = [...html.matchAll(H1_RE)];
  if (h1s.length === 0) {
    out.push({
      id: 'h1',
      severity: 'important',
      title: 'No <h1> heading',
      why: 'The h1 tells a search engine what the page is about in the page itself, not just in the metadata.',
      where: 'The top of your page content',
      fix: '<h1>What this page is about</h1>',
    });
  } else if (h1s.length > 1) {
    out.push({
      id: 'h1-many',
      severity: 'polish',
      title: `${h1s.length} <h1> headings — there should be one`,
      why: 'Several h1s split the signal about what the page is actually about.',
      where: 'Your page content — keep the main one, make the rest <h2>',
      fix: '',
    });
  }

  if (!tag(html, CANONICAL_RE)) {
    out.push({
      id: 'canonical',
      severity: 'important',
      title: 'No canonical link',
      why: 'Without it, the same page reached on www and non-www, or with tracking parameters, competes with itself.',
      where: 'Inside <head>',
      fix: `<link rel="canonical" href="${url}">`,
    });
  }

  if (!VIEWPORT_RE.test(html)) {
    out.push({
      id: 'viewport',
      severity: 'critical',
      title: 'No mobile viewport tag',
      why: 'Google indexes the mobile version of your site first. Without this the page is treated as not mobile-friendly.',
      where: 'Inside <head>',
      fix: '<meta name="viewport" content="width=device-width, initial-scale=1">',
    });
  }

  if (!tag(html, LANG_RE)) {
    out.push({
      id: 'lang',
      severity: 'polish',
      title: 'No language on the <html> tag',
      why: 'It tells search engines and screen readers which language the page is in.',
      where: 'The opening <html> tag',
      fix: '<html lang="en">',
    });
  }

  if (!OG_TITLE_RE.test(html) || !OG_IMAGE_RE.test(html)) {
    out.push({
      id: 'og',
      severity: 'important',
      title: 'No social preview tags',
      why: 'Without these, a link to your site shared on WhatsApp, Facebook or LinkedIn shows as a bare URL with no picture.',
      where: 'Inside <head>',
      fix: `<meta property="og:title" content="${title ?? 'Your page title'}">
<meta property="og:description" content="${desc ?? 'One sentence about this page.'}">
<meta property="og:image" content="${host}/og-image.jpg">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">`,
    });
  }

  if (!JSONLD_RE.test(html)) {
    out.push({
      id: 'schema',
      severity: 'important',
      title: 'No structured data',
      why: 'Structured data is what earns the extra detail under your result — ratings, opening hours, prices. Without it you get a plain link.',
      where: 'Inside <head>, as a script tag',
      fix: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Your business name",
  "url": "${host}",
  "telephone": "+92...",
  "address": { "@type": "PostalAddress", "addressLocality": "Your city", "addressCountry": "PK" }
}
</script>`,
    });
  }

  const imgs = [...html.matchAll(IMG_RE)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => !/\balt\s*=/i.test(t)).length;
  if (noAlt > 0) {
    out.push({
      id: 'alt',
      severity: noAlt > 5 ? 'important' : 'polish',
      title: `${noAlt} image${noAlt === 1 ? '' : 's'} with no alt text`,
      why: 'Alt text is how a search engine reads a picture, and how a screen reader describes it.',
      where: 'Every <img> tag on the page',
      fix: '<img src="..." alt="What the picture actually shows">',
    });
  }

  const words = wordCount(html);
  if (words < 300) {
    out.push({
      id: 'thin',
      severity: 'important',
      title: `About ${words} words on the page — thin for ranking`,
      why: 'A page with very little text has little for a search engine to match a search against. 500+ words of genuinely useful copy is a reasonable floor for a page you want to rank.',
      where: 'Your page content',
      fix: '',
    });
  }

  if (robotsTxt === null) {
    out.push({
      id: 'robots',
      severity: 'important',
      title: 'No robots.txt',
      why: 'It is the first file a search engine asks for. Without it crawling still works, but you cannot point them at your sitemap.',
      where: `${host}/robots.txt`,
      fix: `User-agent: *
Allow: /

Sitemap: ${host}/sitemap.xml`,
    });
  } else if (/^\s*Disallow:\s*\/\s*$/im.test(robotsTxt) && !/^\s*Allow:/im.test(robotsTxt)) {
    out.push({
      id: 'robots-blocks',
      severity: 'critical',
      title: 'robots.txt blocks the whole site',
      why: '"Disallow: /" tells every search engine to stay out. Nothing on the site can rank while it is there.',
      where: `${host}/robots.txt`,
      fix: `User-agent: *
Allow: /

Sitemap: ${host}/sitemap.xml`,
    });
  } else if (!/sitemap:/i.test(robotsTxt)) {
    out.push({
      id: 'robots-sitemap',
      severity: 'polish',
      title: 'robots.txt does not point at your sitemap',
      why: 'One line that tells every crawler where the full list of your pages lives.',
      where: `${host}/robots.txt — add at the end`,
      fix: `Sitemap: ${host}/sitemap.xml`,
    });
  }

  if (!sitemapOk) {
    out.push({
      id: 'sitemap',
      severity: 'important',
      title: 'No sitemap.xml',
      why: 'A sitemap is how pages that nothing links to still get found. Without one, new pages can take weeks to appear.',
      where: `${host}/sitemap.xml`,
      fix: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${host}/</loc><priority>1.0</priority></url>
</urlset>`,
    });
  }

  if (!url.startsWith('https://')) {
    out.push({
      id: 'https',
      severity: 'critical',
      title: 'The site is not on HTTPS',
      why: 'HTTPS is a ranking signal, and browsers mark an http:// page as "Not secure" to every visitor.',
      where: 'Your hosting — most hosts issue a free certificate',
      fix: '',
    });
  }

  return out;
}

const RANK: Record<SeoSeverity, number> = { critical: 0, important: 1, polish: 2 };

const siteSchema = z.object({ url: z.string().trim().min(4).max(300) });

/** The customer's website, stored on their workspace. One site, theirs. */
export const setSeoSite = onCall(async (req) => {
  requireAuth(req);
  const parsed = siteSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Enter your website address.');
  const u = publicHttpUrl(parsed.data.url);

  await sdb.doc('socialConfig/seo').set(
    { url: u.toString(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { ok: true, url: u.toString() };
});

/** Fetch the site and write the findings. Run on demand from the SEO page. */
export const runSeoAudit = onCall(async (req) => {
  requireAuth(req);
  const stored = await sdb.doc('socialConfig/seo').get();
  const raw = (req.data as { url?: string } | undefined)?.url ?? (stored.get('url') as string | undefined);
  if (!raw) invalid('Add your website address first.');
  const u = publicHttpUrl(raw!);

  const page = await get(u.toString());
  if (!page) {
    invalid('We could not reach that website. Check the address and that it is online.');
  }

  const [robots, sitemap] = await Promise.all([
    get(`${u.origin}/robots.txt`),
    get(`${u.origin}/sitemap.xml`),
  ]);

  const findings = auditHtml({
    url: u.toString(),
    html: page!.body,
    status: page!.status,
    robotsTxt: robots && robots.status < 400 ? robots.body : null,
    sitemapOk: !!sitemap && sitemap.status < 400 && sitemap.body.includes('<urlset'),
  }).sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  const report = {
    url: u.toString(),
    ranAt: FieldValue.serverTimestamp(),
    findings,
    counts: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      important: findings.filter((f) => f.severity === 'important').length,
      polish: findings.filter((f) => f.severity === 'polish').length,
    },
  };
  await sdb.doc('socialConfig/seo').set(report, { merge: true });

  logger.info('SEO audit run', { url: u.toString(), findings: findings.length });
  return { ok: true, ...report, ranAt: Date.now() };
});

/** What the SEO page shows when it opens. */
export const getSeoReport = onCall(async (req) => {
  requireAuth(req);
  const snap = await sdb.doc('socialConfig/seo').get();
  const ranAt = snap.get('ranAt') as { toMillis?: () => number } | undefined;
  return {
    ok: true,
    url: (snap.get('url') as string | undefined) ?? null,
    findings: (snap.get('findings') as SeoFinding[] | undefined) ?? [],
    counts:
      (snap.get('counts') as { critical: number; important: number; polish: number } | undefined) ??
      { critical: 0, important: 0, polish: 0 },
    ranAtMs: ranAt?.toMillis ? ranAt.toMillis() : null,
  };
});
