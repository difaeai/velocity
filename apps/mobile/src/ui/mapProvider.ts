/**
 * Which map engine every MapView in the app should use — decided once, here.
 *
 * Android has exactly one option: Google Maps, authenticated by the API key
 * app.config.ts injects. No key, no tiles, so `MAPS_AVAILABLE` goes false and
 * callers paint their own dark surface instead of Google's broken grey grid.
 *
 * iOS is different, and getting it wrong is invisible until the App Store review
 * screenshot comes back blank. The Google provider needs a SECOND key, an
 * iOS-restricted one in `ios.config.googleMapsApiKey` — the Android key will not
 * authenticate an iOS bundle. Rather than ship a dead map when that key is
 * missing, iOS falls back to Apple Maps, which needs no key at all and is always
 * present on the device. The only thing lost is `customMapStyle`, which is a
 * Google-only prop; Apple's own `userInterfaceStyle="dark"` gets us the same dark
 * map, so the fallback looks intentional rather than broken.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { PROVIDER_GOOGLE, type MapViewProps } from 'react-native-maps';

import { DARK_MAP_STYLE } from './mapStyle';

/** Expo Go ships no native map module — a dev/release build is required. */
const IS_EXPO_GO = Constants.appOwnership === 'expo';

const expoConfig = Constants.expoConfig as {
  android?: { config?: { googleMaps?: { apiKey?: string } } };
  ios?: { config?: { googleMapsApiKey?: string } };
} | null;

const ANDROID_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
  expoConfig?.android?.config?.googleMaps?.apiKey ??
  '';

// Deliberately NOT falling back to EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: that key is
// restricted to the Android app in Google Cloud, so borrowing it here would give
// a truthy value and a map that silently refuses to load.
const IOS_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY ??
  expoConfig?.ios?.config?.googleMapsApiKey ??
  '';

const USE_GOOGLE = Platform.OS === 'ios' ? !!IOS_KEY : true;

/**
 * False only when there is no map engine that would actually render: Expo Go, or
 * Android without its key. iOS always has Apple Maps to fall back on.
 */
export const MAPS_AVAILABLE =
  !IS_EXPO_GO && (Platform.OS === 'ios' ? true : !!ANDROID_KEY);

/**
 * Spread into every `<MapView>`: picks the provider and the matching way of
 * asking for a dark map. Keeping these two together matters — `customMapStyle`
 * on Apple Maps is ignored, and a MapView that sets neither renders a bright
 * map under a dark UI.
 */
export const mapBaseProps: Pick<
  MapViewProps,
  'provider' | 'customMapStyle' | 'userInterfaceStyle'
> = USE_GOOGLE
  ? { provider: PROVIDER_GOOGLE, customMapStyle: DARK_MAP_STYLE }
  : { provider: undefined, userInterfaceStyle: 'dark' as const };
