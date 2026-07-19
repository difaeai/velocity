import { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * Everything static still lives in app.json (loaded here as `config`). This file
 * adds the two things that must come from the environment rather than source:
 *
 * 1. The Android Google Maps API key, so the key never sits in a public repo:
 *
 *      • local dev  → apps/mobile/.env            (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...)
 *      • EAS builds → `eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ...`
 *
 *    If the var is unset the key is simply omitted — maps won't render, which is the
 *    correct fail-safe (far better than baking a real key into every APK).
 *
 * 2. The AdMob application IDs, which the native SDK reads at process start and
 *    therefore must be baked into the manifest / Info.plist at build time (unlike
 *    ad UNIT ids, which are runtime values — see src/ads/ids.ts).
 *
 *    Unlike the maps key these fall back to Google's published *sample* app IDs
 *    rather than being omitted. The AdMob SDK hard-crashes on launch if the
 *    manifest entry is missing entirely, so a build with no configured ID must
 *    still get a syntactically valid one; the sample IDs serve test ads only and
 *    are safe to ship in a debug build. Set EXPO_PUBLIC_ADMOB_ANDROID_APP_ID to
 *    the real one for any build that goes to the Play Store.
 */

/** Google's published sample application IDs — serve test ads only, never revenue. */
const TEST_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const TEST_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  const androidAppId = process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID ?? TEST_ANDROID_APP_ID;
  const iosAppId = process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID ?? TEST_IOS_APP_ID;

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
        },
      ],
    ],
  };
};
