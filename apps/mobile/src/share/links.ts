/**
 * Shareable https links.
 *
 * Custom-scheme URLs (velocity://…) are not tappable in WhatsApp/SMS and do
 * nothing for people who don't have the app installed. Share messages instead
 * carry an https link to the admin web app's public /link page, which bounces
 * the visitor into the app (or to the Play Store when it isn't installed).
 */

/**
 * The public web origin. Overridable so a staging build hands out staging
 * links; the default is the custom domain. The old App Hosting default domain
 * still resolves, so links already shared keep working.
 */
export const WEB_ORIGIN =
  process.env.EXPO_PUBLIC_LINK_BASE_URL ?? 'https://velocityrides.app';

/** Legal pages shown from Settings and sign-in, and listed in Play Console. */
export const PRIVACY_URL = `${WEB_ORIGIN}/privacy`;
export const DELETE_ACCOUNT_URL = `${WEB_ORIGIN}/delete-account`;
export const TERMS_URL = `${WEB_ORIGIN}/terms`;

/** The one support address. Anything user-facing must use this, not a literal. */
export const SUPPORT_EMAIL = 'support@velocityrides.app';

/** Builds an https share link that opens the given in-app path. */
export function appLink(path: string): string {
  return `${WEB_ORIGIN}/link${path.startsWith('/') ? '' : '/'}${path}`;
}
