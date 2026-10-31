import { Alert, Linking } from 'react-native';

/** What each permission is for, in the words the person reads after they said no. */
const WHY = {
  location: {
    title: 'Velocity cannot see where you are',
    why: 'Drivers find you, and fares are worked out, from your location. You can still type your pickup by hand — or turn location on in Settings.',
  },
  camera: {
    title: 'The camera is off for Velocity',
    why: 'Photos of your car, your documents and your face check are taken with it, so we can verify you. Turn it on in Settings to carry on.',
  },
  microphone: {
    title: 'The microphone is off for Velocity',
    why: 'Calls with your driver or rider and the voice assistant need it. Turn it on in Settings — everything else keeps working without it.',
  },
  notifications: {
    title: 'Notifications are off for Velocity',
    why: 'Ride offers, your driver arriving and messages come as notifications. Without them you only see these with the app open.',
  },
  photos: {
    title: 'Photos are off for Velocity',
    why: 'Picking a picture from your gallery needs access to it. Turn it on in Settings, or take a new photo instead.',
  },
  contacts: {
    title: 'Contacts are off for Velocity',
    why: 'Picking someone from your phone book needs access to it. You can always type the number instead.',
  },
} as const;

export type PermissionKind = keyof typeof WHY;

/**
 * The person said no: explain why Velocity needs it, offer Settings, and let them
 * carry on without it. Never a dead end — "Not now" always returns them where they were.
 */
export function explainDenied(kind: PermissionKind, onWithout?: () => void): void {
  const w = WHY[kind];
  Alert.alert(w.title, w.why, [
    { text: 'Not now', style: 'cancel', onPress: onWithout },
    { text: 'Open Settings', onPress: () => void Linking.openSettings().catch(() => {}) },
  ]);
}
