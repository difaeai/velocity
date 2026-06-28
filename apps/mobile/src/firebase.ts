/**
 * Firebase initialisation for React Native (Expo).
 *
 * Uses the Firebase JS SDK (works in Expo Go and dev builds). Auth state is
 * persisted with AsyncStorage so users stay signed in across launches.
 */
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import * as firebaseAuth from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { firebaseConfig, FUNCTIONS_REGION } from './config';
export { firebaseConfig };

// `getReactNativePersistence` ships only in Firebase's React Native build, which
// Metro selects at runtime. TypeScript's bundler resolution sees the web build's
// types (which omit it), so we reach it through the namespace import.
const getReactNativePersistence = (
  firebaseAuth as unknown as {
    getReactNativePersistence: (storage: unknown) => Persistence;
  }
).getReactNativePersistence;

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth must run exactly once; on Fast Refresh it would throw, so we
// fall back to the already-initialised instance.
let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

export { app, auth };

// experimentalForceLongPolling: switches Firestore from gRPC-WebSockets to
// HTTP long-polling. This is required on Android emulators (and some real
// devices) where WebSocket connections to Google's servers are blocked by the
// AVD network stack. Has no effect on production traffic patterns.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  localCache: memoryLocalCache(),
});

export const functions = getFunctions(app, FUNCTIONS_REGION);
export const storage = getStorage(app);
