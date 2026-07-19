import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { LogBox, Platform } from 'react-native';
import { Slot, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { AuthProvider } from '../src/auth/AuthContext';
import {
  getThemeMode,
  getThemeVersion,
  loadTheme,
  subscribeTheme,
  type ThemeMode,
} from '../src/theme';

LogBox.ignoreLogs([
  'Could not reach Cloud Firestore backend',
  '@firebase/firestore',
]);

const isExpoGo = Constants.appOwnership === 'expo';

export default function RootLayout() {
  const router = useRouter();

  // The saved theme must be applied BEFORE any route module is evaluated so the
  // first StyleSheet build (via themed()) bakes the correct palette.
  const [themeMode, setThemeMode] = useState<ThemeMode | null>(null);
  useEffect(() => {
    loadTheme().then(setThemeMode);
  }, []);

  // Live theme switching: when the palette changes, the version bumps. We key the
  // route subtree on it so every mounted screen remounts and rebuilds its styles
  // from the new colors — no reload. expo-router is URL-driven, so the current
  // route is preserved across the remount (only in-screen local state resets).
  const themeVersion = useSyncExternalStore(subscribeTheme, getThemeVersion, getThemeVersion);

  // Handle FCM notification tap → deep-link driver to request-detail screen
  useEffect(() => {
    if (isExpoGo || Platform.OS === 'web') return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');

    // Handle tap on a notification that arrived while the app was in foreground/background
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response: { notification: { request: { content: { data: Record<string, string> } } } }) => {
        const data = response.notification.request.content.data;
        if (data.screen === 'request-detail' && data.tripId) {
          router.push(`/driver/request-detail/${data.tripId}`);
        }
      },
    );

    // Handle tap on a notification that launched the app from killed state
    Notifications.getLastNotificationResponseAsync().then(
      (response: { notification: { request: { content: { data: Record<string, string> } } } } | null) => {
        if (!response) return;
        const data = response.notification.request.content.data;
        if (data.screen === 'request-detail' && data.tripId) {
          router.push(`/driver/request-detail/${data.tripId}`);
        }
      },
    );

    return () => sub.remove();
  }, []);

  if (!themeMode) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style={getThemeMode() === 'light' ? 'dark' : 'light'} />
        <Fragment key={themeVersion}>
          <Slot />
        </Fragment>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
