/**
 * Shareable https links.
 *
 * Custom-scheme URLs (velocity://…) are not tappable in WhatsApp/SMS and do
 * nothing for people who don't have the app installed. Share messages instead
 * carry an https link to the admin web app's public /link page, which bounces
 * the visitor into the app (or to the Play Store when it isn't installed).
 */
const LINK_BASE =
  process.env.EXPO_PUBLIC_LINK_BASE_URL ??
  'https://velocity--velocity-fe379.us-east4.hosted.app';

/** Builds an https share link that opens the given in-app path. */
export function appLink(path: string): string {
  return `${LINK_BASE}/link${path.startsWith('/') ? '' : '/'}${path}`;
}
