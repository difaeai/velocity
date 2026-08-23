import type { NextConfig } from 'next';

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
    ];
  },
};

export default nextConfig;
