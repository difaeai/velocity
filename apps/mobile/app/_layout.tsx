import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { LogBox, Platform } from 'react-native';
import { Slot, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { AuthProvider } from '../src/auth/AuthContext';
import { hydrateResourceCache } from '../src/lib/cachedResource';
import {
  getLanguageVersion,
  loadLanguage,
  subscribeLanguage,
  type Language,
} from '../src/i18n';
import {
  getThemeMode,
  getThemeVersion,
  loadTheme,
  subscribeTheme,
  type ThemeMode,
} from '../src/theme';
import { UpdateGate } from '../src/ui/UpdateGate';

LogBox.ignoreLogs([
  'Could not reach Cloud Firestore backend',
  '@firebase/firestore',
]);

const isExpoGo = Constants.appOwnership === 'expo';

// The gate at the bottom of RootLayout renders `null` until the saved theme,
// language and warm cache have loaded. Without this the native splash hides the
// moment the JS bundle is up, so that gate shows as a bare white flash between
// the brand splash and the first screen. Holding the splash across it means the
// user sees the logo until there is something real to look at.
//
// Global scope, not an effect: by the time a component body runs, auto-hide has
// already fired. Rejections are ignored on purpose — a splash that will not stay
// put is a cosmetic problem, never a reason to fail a launch.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 250, fade: true });

export default function RootLayout() {
  const router = useRouter();

  // The saved theme must be applied BEFORE any route module is evaluated so the
  // first StyleSheet build (via themed()) bakes the correct palette.
  const [themeMode, setThemeMode] = useState<ThemeMode | null>(null);
  useEffect(() => {
    loadTheme().then(setThemeMode);
  }, []);

  // Same deal for the saved language: it must be applied before the first screen
  // renders, or the app would flash English and then swap to Urdu.
  const [language, setLanguageState] = useState<Language | null>(null);
  useEffect(() => {
    loadLanguage().then(setLanguageState);
  }, []);

  // Pull last session's dashboard payloads into memory while we are already
  // blocked on those two reads. It is a third concurrent AsyncStorage read, so
  // it rides along for free — and holding the gate for it is what lets a data
  // screen paint on its first render instead of opening on skeletons. It never
  // rejects and never blocks on the network; the worst case is an empty cache
  // and the behaviour the app had before it existed.
  const [cacheReady, setCacheReady] = useState(false);
  useEffect(() => {
    hydrateResourceCache().finally(() => setCacheReady(true));
  }, []);

  // Live theme switching: when the palette changes, the version bumps. We key the
  // route subtree on it so every mounted screen remounts and rebuilds its styles
  // from the new colors — no reload. expo-router is URL-driven, so the current
  // route is preserved across the remount (only in-screen local state resets).
  const themeVersion = useSyncExternalStore(subscribeTheme, getThemeVersion, getThemeVersion);

  // Language switches the same way — the wrapper <Text> reads the current
  // language at render time, so remounting the tree is what makes the swap
  // reach every already-mounted screen.
  const languageVersion = useSyncExternalStore(
    subscribeLanguage,
    getLanguageVersion,
    getLanguageVersion,
  );

  // Handle FCM notification tap → deep-link driver to request-detail screen
  useEffect(() => {
    if (isExpoGo || Platform.OS === 'web') return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');

    const routeFromData = (data: Record<string, string>) => {
      if (data.screen === 'request-detail' && data.tripId) {
        router.push(`/driver/request-detail/${data.tripId}`);
      } else if (data.screen === 'pool-join' && data.code) {
        // Daily-route pool alert → straight to the join screen for that pool.
        router.push(`/passenger/pool-join/${data.code}`);
      } else if (data.screen === 'business-offer-demo') {
        // The "see it on your phone" demo. No adId, no click to record — it is
        // the sample offer, rendered from a constant.
        router.push('/passenger/offer/demo');
      } else if (data.screen === 'business-offer' && data.adId) {
        // A nearby business offer. Opening this screen is the tap the advertiser
        // is paying to measure, so it must land on the offer and nowhere else.
        router.push(`/passenger/offer/${data.adId}`);
      } else if (data.screen === 'business-ads') {
        router.push('/passenger/business-ads');
      }
    };

    // Handle tap on a notification that arrived while the app was in foreground/background
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response: { notification: { request: { content: { data: Record<string, string> } } } }) => {
        routeFromData(response.notification.request.content.data);
      },
    );

    // Handle tap on a notification that launched the app from killed state
    Notifications.getLastNotificationResponseAsync().then(
      (response: { notification: { request: { content: { data: Record<string, string> } } } } | null) => {
        if (!response) return;
        routeFromData(response.notification.request.content.data);
      },
    );

    return () => sub.remove();
  }, []);

  // Hand the screen over only once the gate below is open, so the splash gives
  // way directly to a painted screen. useEffect, not the render body: hiding
  // mid-render would race the first commit and flash white anyway.
  const ready = Boolean(themeMode) && Boolean(language) && cacheReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style={getThemeMode() === 'light' ? 'dark' : 'light'} />
        {/* Outside the keyed Fragment on purpose: everything inside it remounts
            on a theme or language switch, and the update prompt must not
            reappear because somebody tapped the moon icon. */}
        <UpdateGate />
        <Fragment key={`${themeVersion}:${languageVersion}`}>
          <Slot />
        </Fragment>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
