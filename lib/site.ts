/**
 * The public origin of Velocity on the web.
 *
 * The site used to answer only on the App Hosting default domain
 * (velocity--velocity-fe379.us-east4.hosted.app), and legal documents lived on
 * a separate Firebase Hosting site (velocity-fe379.web.app). Both now point at
 * the custom domain, and every outward-facing link — Play Console listing,
 * share links, franchise portal links, structured data — is built from the
 * constants below so a future domain change is a one-line edit.
 *
 * The old origins still resolve: App Hosting serves both domains from the same
 * backend, and the legacy Hosting site 301-redirects here (see firebase.json).
 */
export const SITE_URL = 'https://velocityrides.app';

/** Play Console listing URLs. Both are served by the Next app — see next.config.ts. */
export const PRIVACY_URL = `${SITE_URL}/privacy`;
export const DELETE_ACCOUNT_URL = `${SITE_URL}/delete-account`;

/** Where support mail goes. Kept here so the legal pages and the site agree. */
export const SUPPORT_EMAIL = 'berreto01@gmail.com';

/**
 * Official profiles, emitted as schema.org `sameAs` on the homepage.
 *
 * Google has no Search Console field for social accounts; `sameAs` is the
 * signal it actually reads to tie a site to its profiles. Only add URLs that
 * are verifiably ours — a wrong entry associates someone else's account.
 */
export const FACEBOOK_URL = 'https://www.facebook.com/velocityridesapp/';
export const INSTAGRAM_URL = 'https://www.instagram.com/velocityrides.app/';

export const SOCIAL_PROFILES = [FACEBOOK_URL, INSTAGRAM_URL];
