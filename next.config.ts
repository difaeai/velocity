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
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/privacy', destination: '/legal/privacy-policy.html' },
      { source: '/privacy-policy', destination: '/legal/privacy-policy.html' },
      { source: '/privacy-policy.html', destination: '/legal/privacy-policy.html' },
      { source: '/delete-account', destination: '/legal/delete-account.html' },
      { source: '/delete-account.html', destination: '/legal/delete-account.html' },
    ];
  },
};

export default nextConfig;
