import { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * Everything static still lives in app.json (loaded here as `config`). The only
 * thing this file adds is the Android Google Maps API key, injected from the
 * environment so the key never sits in source or the public repo:
 *
 *   • local dev  → apps/mobile/.env            (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...)
 *   • EAS builds → `eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ...`
 *
 * If the var is unset the key is simply omitted — maps won't render, which is the
 * correct fail-safe (far better than baking a real key into every APK).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

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
  };
};
