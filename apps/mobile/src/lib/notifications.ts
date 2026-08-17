/**
 * Push notification registration — call once on app launch after sign-in.
 * Requests permission, gets the Expo/FCM token, and registers it server-side.
 *
 * Gracefully no-ops in Expo Go (SDK 53+) where remote notifications are unsupported.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

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

/**
 * Where the handset stands on notifications, in the three states that actually
 * change what we can put on screen:
 *
 *   granted     → nothing to ask for.
 *   askable     → the OS will still show its own Allow/Don't-allow dialog, so we
 *                 can explain what Allow gets them and then trigger it.
 *   blocked     → they already said no once. On Android the OS refuses to ask a
 *                 second time, so the ONLY way back is the app's settings page,
 *                 and a button that re-asks would silently do nothing.
 *
 * `unsupported` is Expo Go and the simulator, where there is no permission to
 * hold an opinion about.
 */
export type NotificationPermission = 'granted' | 'askable' | 'blocked' | 'unsupported';

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (isExpoGo || !Device.isDevice) return 'unsupported';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    const perm = await Notifications.getPermissionsAsync();
    // iOS provisional authorisation delivers quietly but it DOES deliver, so it
    // counts as granted — nagging someone who is already receiving is noise.
    if (perm.granted || perm.ios?.status === 3 /* PROVISIONAL */) return 'granted';
    return perm.canAskAgain ? 'askable' : 'blocked';
  } catch {
    return 'unsupported';
  }
}

/**
 * Trigger the OS dialog. Returns where we ended up, so the caller can either get
 * on with what the user pressed the button for, or point them at settings.
 *
 * Registers the push token on the way through, because permission without a
 * registered token is still silence.
 */
export async function askNotificationPermission(): Promise<NotificationPermission> {
  if (isExpoGo || !Device.isDevice) return 'unsupported';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted && !current.canAskAgain) return 'blocked';
    if (!current.granted) await Notifications.requestPermissionsAsync();
  } catch {
    return 'unsupported';
  }
  // registerForPushNotifications re-reads the permission itself and returns a
  // token only on success, so it is the honest source of the final answer.
  const token = await registerForPushNotifications();
  return token ? 'granted' : getNotificationPermission();
}

/** The app's own settings page — the only route back once Android has said no twice. */
export async function openNotificationSettings(): Promise<void> {
  await Linking.openSettings().catch(() => {});
}

/**
 * Live permission state for a screen that needs to ask for it.
 *
 * Re-checks when the app comes back to the foreground: someone sent to settings
 * to flip the switch returns to a screen that must already know they did, not
 * one still asking them to.
 */
export function useNotificationPermission(): {
  permission: NotificationPermission;
  /** Undecided on first paint — render nothing rather than flashing a prompt. */
  ready: boolean;
  ask: () => Promise<NotificationPermission>;
  openSettings: () => Promise<void>;
  refresh: () => void;
} {
  const [permission, setPermission] = useState<NotificationPermission>('granted');
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => {
    void getNotificationPermission().then((p) => {
      setPermission(p);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const ask = useCallback(async () => {
    const next = await askNotificationPermission();
    setPermission(next);
    setReady(true);
    return next;
  }, []);

  return { permission, ready, ask, openSettings: openNotificationSettings, refresh };
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
