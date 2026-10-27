/**
 * AdMob ad unit IDs.
 *
 * Three units total (banner, interstitial, native video), each reused across
 * every placement. Ad UNIT ids are runtime values, unlike the APP id, which the native
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
 * When a var is unset, a DEV build falls back to Google's official TestIds and a
 * release build turns that placement off (see resolve). Requesting a REAL ad unit
 * from a debug build, or tapping your own live ad while developing, is invalid
 * traffic, and repeated invalid traffic is what gets an AdMob account limited or
 * disabled — so real revenue is always a deliberate opt-in.
 */
import { TestIds } from 'react-native-google-mobile-ads';

import { resolveAdUnit } from '../lib/adUnit';

/** null = that placement is off (see resolveAdUnit for when and why). */
function resolve(configured: string | undefined, testId: string, label: string): string | null {
  const { unit, problem } = resolveAdUnit(
    configured, process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID, testId, __DEV__,
  );
  if (problem) console.warn(`[ads] ${label} ${problem}`);
  return unit;
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

/** The native ("Native advanced") unit — the in-deck video card in Travel Partner. */
export const NATIVE_UNIT_ID = resolve(
  process.env.EXPO_PUBLIC_ADMOB_NATIVE_ID,
  TestIds.NATIVE_VIDEO,
  'EXPO_PUBLIC_ADMOB_NATIVE_ID',
);
