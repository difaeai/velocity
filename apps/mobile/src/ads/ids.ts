/**
 * AdMob ad unit IDs.
 *
 * Two units total (one banner, one interstitial), each reused across every
 * placement. Ad UNIT ids are runtime values, unlike the APP id, which the native
 * SDK reads from the manifest at process start (see app.config.ts).
 *
 * Neither of these is a secret — an ad unit id is visible in any ad request and
 * is not an access credential — but they still come from the environment so a
 * fork or a debug build can never accidentally bill impressions to the real
 * account:
 *
 *   • local dev  → apps/mobile/.env   (EXPO_PUBLIC_ADMOB_BANNER_ID=…)
 *   • EAS builds → `eas secret:create --name EXPO_PUBLIC_ADMOB_BANNER_ID …`
 *
 * When a var is unset we fall back to Google's official TestIds. That is the
 * important safety property here: requesting a REAL ad unit from a debug build,
 * or tapping your own live ad while developing, is invalid traffic, and repeated
 * invalid traffic is what gets an AdMob account limited or disabled. Defaulting
 * to test ads means you have to opt in to real revenue deliberately.
 */
import { TestIds } from 'react-native-google-mobile-ads';

/**
 * A configured id must look like `ca-app-pub-<publisher>/<unit>`. A truncated or
 * placeholder value (someone pasting the APP id, which uses `~`, or leaving
 * `ca-app-pub-xxx`) would otherwise fail silently at request time as a generic
 * "no fill", which is close to impossible to debug from the outside.
 */
const UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/;

function resolve(configured: string | undefined, testId: string, label: string): string {
  const value = configured?.trim();
  if (!value) return testId;
  if (!UNIT_ID_PATTERN.test(value)) {
    console.warn(
      `[ads] ${label} is set but is not a valid ad unit id ("${value}"). ` +
        'Expected ca-app-pub-################/##########. Falling back to test ads. ' +
        'Note the APP id (with "~") is not an ad unit id.',
    );
    return testId;
  }
  return value;
}

/** The single banner unit, shared by all three banner placements. */
export const BANNER_UNIT_ID = resolve(
  process.env.EXPO_PUBLIC_ADMOB_BANNER_ID,
  TestIds.ADAPTIVE_BANNER,
  'EXPO_PUBLIC_ADMOB_BANNER_ID',
);

/** The single interstitial unit, shared by both interstitial triggers. */
export const INTERSTITIAL_UNIT_ID = resolve(
  process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID,
  TestIds.INTERSTITIAL,
  'EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID',
);

/** True when we are serving Google's test inventory rather than the real account. */
export const USING_TEST_ADS =
  BANNER_UNIT_ID !== process.env.EXPO_PUBLIC_ADMOB_BANNER_ID?.trim() ||
  INTERSTITIAL_UNIT_ID !== process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID?.trim();
