import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * Everything static still lives in app.json (loaded here as `config`). This file
 * adds the things that must come from the environment — or from another file —
 * rather than being hard-coded in source:
 *
 * 1. The Google Maps API keys, so no key ever sits in a public repo. There are
 *    TWO, because a Google Cloud key restricted to an Android app will not
 *    authenticate an iOS bundle and vice versa:
 *
 *      • local dev  → apps/mobile/.env  (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...,
 *                                        EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY=...)
 *      • EAS builds → `eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ...`
 *
 *    An unset key is simply omitted, which is the correct fail-safe (far better
 *    than baking a real key into every APK). On Android that means no map; on
 *    iOS src/ui/mapProvider.ts falls back to Apple Maps, which needs no key.
 *
 * 2. The AdMob application IDs, which the native SDK reads at process start and
 *    therefore must be baked into the manifest / Info.plist at build time (unlike
 *    ad UNIT ids, which are runtime values — see src/ads/ids.ts).
 *
 *    Unlike the maps key these fall back to Google's published *sample* app IDs
 *    rather than being omitted. The AdMob SDK hard-crashes on launch if the
 *    manifest entry is missing entirely, so a build with no configured ID must
 *    still get a syntactically valid one; the sample IDs serve test ads only and
 *    are safe to ship in a debug build. Set EXPO_PUBLIC_ADMOB_ANDROID_APP_ID /
 *    EXPO_PUBLIC_ADMOB_IOS_APP_ID to the real ones for any store build.
 *
 * 3. The iOS URL scheme Firebase phone auth needs, read out of
 *    GoogleService-Info.plist so it can never drift from it (see below).
 */

/** Google's published sample application IDs — serve test ads only, never revenue. */
const TEST_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const TEST_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

/**
 * Google's own SKAdNetwork identifier, required for iOS install attribution to
 * work at all. Only Google's is listed because Velocity serves AdMob directly
 * with no mediation partners — every extra ID here would be a network we do not
 * actually work with.
 */
const SKADNETWORK_ITEMS = ['cstr6suwn9.skadnetwork'];

/**
 * Read one <key>/<string> pair out of GoogleService-Info.plist.
 *
 * Indexing rather than a regex: this file is a template literal away from
 * swallowing its own backslashes, and a silently-unmatched pattern here would
 * disable the bundle-ID check below without anyone noticing.
 */
function plistValue(plist: string, key: string): string | undefined {
  const at = plist.indexOf(`<key>${key}</key>`);
  if (at === -1) return undefined;
  const open = plist.indexOf('<string>', at);
  const close = plist.indexOf('</string>', open);
  if (open === -1 || close === -1) return undefined;
  // A non-string value (the IS_*_ENABLED booleans) would otherwise let us run on
  // and return the NEXT key's string.
  const nextKey = plist.indexOf('<key>', at + 1);
  if (nextKey !== -1 && nextKey < open) return undefined;
  return plist.slice(open + '<string>'.length, close);
}

/**
 * Pulls the two values iOS Firebase needs out of GoogleService-Info.plist.
 *
 * The bundle-ID check is the important half. A plist downloaded for a different
 * bundle ID still parses, still builds, and still ships — and then every Firebase
 * call on the device fails at runtime, phone OTP included. That is an App Review
 * rejection ("we were unable to sign in") discovered a week after upload, so it
 * is worth failing the build over instead.
 */
function readIosFirebase(
  projectRoot: string,
  bundleIdentifier: string | undefined,
): { reversedClientId?: string } {
  // `projectRoot` rather than __dirname: this file is transpiled and evaluated by
  // Expo, and there is no guarantee __dirname is defined in that context — a
  // silently-caught ReferenceError here would skip every check below.
  const plistPath = join(projectRoot, 'GoogleService-Info.plist');
  if (!existsSync(plistPath)) {
    // Android-only workflows should not be blocked by a missing iOS file.
    if (process.env.EAS_BUILD_PLATFORM === 'ios') {
      throw new Error(`Missing ${plistPath} — an iOS build cannot reach Firebase without it.`);
    }
    return {};
  }
  const plist = readFileSync(plistPath, 'utf8');

  const plistBundleId = plistValue(plist, 'BUNDLE_ID');
  if (bundleIdentifier && plistBundleId && plistBundleId !== bundleIdentifier) {
    const message =
      `GoogleService-Info.plist is for bundle ID "${plistBundleId}" but this app ` +
      `builds as "${bundleIdentifier}". Firebase will fail on every call at ` +
      `runtime — phone sign-in and push included. Add an iOS app for ` +
      `"${bundleIdentifier}" in the Firebase console and replace ` +
      `apps/mobile/GoogleService-Info.plist with the one it gives you.`;
    // Hard-fail an actual iOS build; warn everywhere else so Android work and
    // `expo start` keep running while the console side is being sorted out.
    if (process.env.EAS_BUILD_PLATFORM === 'ios') throw new Error(message);
    console.warn(`[app.config] ${message}`);
  }

  return { reversedClientId: plistValue(plist, 'REVERSED_CLIENT_ID') };
}

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const iosMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;

  const androidAppId = process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID ?? TEST_ANDROID_APP_ID;
  const iosAppId = process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID ?? TEST_IOS_APP_ID;

  const { reversedClientId } = readIosFirebase(projectRoot, config.ios?.bundleIdentifier);

  return {
    ...config,
    name: config.name ?? 'Velocity',
    slug: config.slug ?? 'velocity',
    android: {
      ...config.android,
      ...(mapsKey
        ? { config: { ...config.android?.config, googleMaps: { apiKey: mapsKey } } }
        : {}),
    },
    ios: {
      ...config.ios,
      ...(iosMapsKey
        ? { config: { ...config.ios?.config, googleMapsApiKey: iosMapsKey } }
        : {}),
      infoPlist: {
        ...config.ios?.infoPlist,
        // Firebase phone auth's fallback path: when the silent APNs push that
        // normally attests the app cannot be delivered, the SDK opens a
        // reCAPTCHA in a browser and returns through this scheme. Without it
        // that user is stranded on the OTP screen with no error — which is
        // exactly what an App Review tester on a simulator-like network sees.
        ...(reversedClientId
          ? { CFBundleURLTypes: [{ CFBundleURLSchemes: [reversedClientId] }] }
          : {}),
      },
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        'react-native-google-mobile-ads',
        {
          androidAppId,
          iosAppId,
          // Delay measurement until the SDK is explicitly initialised, so no ad
          // request can fire before the consent flow has run (see src/ads/provider).
          delayAppMeasurementInit: true,
          // The banner in the "Where to?" sheet sits over a form the user is
          // typing into; muting audio keeps a video creative from talking over
          // someone mid-booking.
          startAdsMuted: true,
          // iOS only. Apple requires this string to exist before anything in the
          // process touches the tracking APIs the ad SDK links against, and
          // rejects builds that reach for them without one. Declaring it does
          // not itself show a prompt — Google's UMP form does that, and only
          // where an ATT message is configured in the AdMob console.
          userTrackingUsageDescription:
            'Velocity uses this to show you more relevant ads. Your rides and personal details are never shared.',
          skAdNetworkItems: SKADNETWORK_ITEMS,
        },
      ],
    ],
  };
};
