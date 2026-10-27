/**
 * Which AdMob unit a placement may request — pure, so the rules are unit-tested
 * (src/ads/ids.ts, which feeds it, imports the native SDK).
 */

/**
 * A configured id must look like `ca-app-pub-<publisher>/<unit>`. A truncated or
 * placeholder value (someone pasting the APP id, which uses `~`, or leaving
 * `ca-app-pub-xxx`) would otherwise fail silently at request time as a generic
 * "no fill", which is close to impossible to debug from the outside.
 */
const UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/;

/**
 * The unit to request, or null = that placement is OFF.
 *
 * - A release build never falls back to test ads: an unset unit (the new AdMob
 *   account has no interstitial yet) would otherwise put Google's "Test Ad" in
 *   front of real riders and earn nothing. Dev builds keep the test fallback so
 *   placements stay visible while developing.
 * - A unit from a different AdMob account than the app id can never serve under
 *   it — e.g. the closed account's interstitial left in EAS env after the move.
 * - A release build with no app id for its platform is off: app.config.ts then
 *   ships Google's SAMPLE app id, and live units under it bill nothing.
 */
export function resolveAdUnit(
  configured: string | undefined,
  appId: string | undefined,
  testId: string,
  dev: boolean,
): { unit: string | null; problem?: string } {
  const value = configured?.trim();
  const off = dev ? testId : null;
  if (!value) return { unit: off };
  if (!UNIT_ID_PATTERN.test(value)) {
    return {
      unit: off,
      problem: `is not a valid ad unit id ("${value}"). Expected ca-app-pub-################/##########; ` +
        'the APP id (with "~") is not an ad unit id.',
    };
  }
  const publisher = appId?.trim().match(/^ca-app-pub-(\d{16})~/)?.[1];
  if (!publisher && !dev) {
    return { unit: null, problem: 'has no AdMob app id for this platform — placement off.' };
  }
  if (publisher && !value.startsWith(`ca-app-pub-${publisher}/`)) {
    return { unit: off, problem: 'belongs to a different AdMob account than the app id — placement off.' };
  }
  return { unit: value };
}
