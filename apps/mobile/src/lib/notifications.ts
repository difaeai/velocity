/**
 * Push notification registration — call once on app launch after sign-in.
 * Requests permission, gets the Expo/FCM token, and registers it server-side.
 *
 * Gracefully no-ops in Expo Go (SDK 53+) where remote notifications are unsupported.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { api } from '../api/client';

// Detect Expo Go — remote notifications are not available there.
const isExpoGo = Constants.appOwnership === 'expo';

// Only wire up the notification handler when NOT in Expo Go.
if (!isExpoGo) {
  // Dynamic require so the module is never even loaded in Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function registerForPushNotifications(): Promise<string | null> {
  // Skip entirely in Expo Go — no crash, no token.
  if (isExpoGo || !Device.isDevice) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Velocity',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ccff00',
      });
    }

    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

    // Register BOTH tokens. The backend routes by token shape: the native token
    // (on Android, the raw FCM registration token) goes through the Firebase
    // Admin SDK, the Expo token through Expo's push service. Registering only
    // the Expo one is what silently broke pushes — the Admin SDK cannot deliver
    // to an `ExponentPushToken[...]` and reports it as a per-token failure.
    let primary: string | null = null;

    try {
      const device = await Notifications.getDevicePushTokenAsync();
      if (typeof device?.data === 'string' && device.data.length > 10) {
        await api.registerFcmToken({ token: device.data, platform });
        primary = device.data;
      }
    } catch {
      // No native token available (no Google Play services, for instance) —
      // the Expo token below is then the only route, so keep going.
    }

    try {
      const expo = await Notifications.getExpoPushTokenAsync();
      if (typeof expo?.data === 'string' && expo.data.length > 10) {
        await api.registerFcmToken({ token: expo.data, platform });
        primary = primary ?? expo.data;
      }
    } catch {
      // Same deal in reverse: if the native token registered, we still have a route.
    }

    return primary;
  } catch {
    return null;
  }
}
