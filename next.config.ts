import type { NextConfig } from 'next';

import { SITE_URL } from './lib/site';

/**
 * Clean URLs for the legal documents.
 *
 * The Play Console listing points at /privacy and /delete-account. The pages
 * themselves are plain static HTML in public/legal, so the routes are rewrites
 * rather than App Router pages — nothing to re-render, nothing to keep in sync.
 * The historical .html paths are kept alive because they were already submitted
 * to Play Console and printed inside the app.
 */
/**
 * Response headers applied to every route.
 *
 * The admin dashboard and the fleet portal both run here, and both are gated by
 * a Firebase session — so the browser-side protections that a session deserves
 * have to be switched on explicitly. Nothing here is a substitute for the
 * Firestore rules, which remain the actual authority on who may read what; these
 * close the gaps rules cannot reach, like a page being framed by somebody else's
 * site or a token riding along on an outbound referer.
 *
 * Deliberately NOT a full Content-Security-Policy: the marketing page and the
 * Firebase SDK would need a nonce-based script-src to keep working, and a CSP
 * that has to be loosened until it passes protects nothing. `frame-ancestors` is
 * the one directive that stands on its own, so it is the one that ships.
 */
const securityHeaders = [
  // Clickjacking. X-Frame-Options is the legacy spelling kept for older browsers;
  // frame-ancestors is the one modern browsers actually honour.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  // Stops a browser second-guessing a declared Content-Type — the trick that
  // turns an uploaded "image" into an executed script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // An admin URL can carry a record id in its path; full URLs must not leak to
  // third-party origins. Same-origin navigation keeps the full referer.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing here needs hardware. Denying by default means a compromised script
  // cannot quietly ask for it either.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // HTTPS is already forced by App Hosting; HSTS is what stops the *first*
  // request of a session from being made over http at all. Two years with
  // subdomains included, which is what preload requires.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },

  /**
   * One host, not two.
   *
   * App Hosting answers on both `velocityrides.app` and `www.velocityrides.app`,
   * and until now both returned 200. Every page therefore existed twice as far
   * as a crawler was concerned: Search Console was reporting fourteen noindexed
   * console pages where there are seven, six "alternate page with proper
   * canonical" entries that are just the www copies, and /login blocked twice.
   * The canonical tags were being obeyed, so nothing was *wrong* in the index —
   * it was simply half the crawl budget spent fetching the same site again.
   *
   * A 301 to the apex settles it at the first request instead of asking the
   * crawler to work it out from a tag in the body. The apex is the canonical
   * host everywhere else already: lib/site.ts, the sitemap, the Play and App
   * Store listings, the OAuth redirect URIs.
   */
  async redirects() {
    // `has.value` is matched as a regular expression, so the dots in the host
    // are escaped — an unescaped one would also match `wwwXvelocityrides.app`.
    const apex = new URL(SITE_URL).host.replace(/\./g, '\\.');
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: `www\\.${apex}` }],
        destination: `${SITE_URL}/:path*`,
        permanent: true,
      },
    ];
  },

  async rewrites() {
    return [
      { source: '/privacy', destination: '/legal/privacy-policy.html' },
      { source: '/privacy-policy', destination: '/legal/privacy-policy.html' },
      { source: '/privacy-policy.html', destination: '/legal/privacy-policy.html' },
      { source: '/delete-account', destination: '/legal/delete-account.html' },
      { source: '/delete-account.html', destination: '/legal/delete-account.html' },
      { source: '/terms', destination: '/legal/terms.html' },
      { source: '/terms-of-service', destination: '/legal/terms.html' },
      { source: '/terms.html', destination: '/legal/terms.html' },
      // Who we are, where we are and the number that is answered — what a card
      // network looks for before it lets a shop take a card, and what a customer
      // looks for when something has gone wrong. /contact is the spelling people type.
      { source: '/support', destination: '/legal/support.html' },
      { source: '/support.html', destination: '/legal/support.html' },
      { source: '/contact', destination: '/legal/support.html' },
      // The short address for Vexa: what TikTok's app form and its reviewer are given.
      { source: '/vexa', destination: '/studio' },
    ];
  },
};

export default nextConfig;
