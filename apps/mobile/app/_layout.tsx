import { useEffect } from 'react';
import { LogBox } from 'react-native';
import { Slot, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { AuthProvider } from '../src/auth/AuthContext';

LogBox.ignoreLogs([
  'Could not reach Cloud Firestore backend',
  '@firebase/firestore',
]);

const isExpoGo = Constants.appOwnership === 'expo';

export default function RootLayout() {
  const router = useRouter();

  // Handle FCM notification tap → deep-link driver to request-detail screen
  useEffect(() => {
    if (isExpoGo) return;
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

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Slot />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
