/**
 * Firebase Web configuration for the Velocity project.
 *
 * The Web API key is NOT a secret — it only identifies the Firebase project.
 * Access is enforced server-side by the Firestore/Storage security rules (and,
 * later, App Check). Values may be overridden per-environment via EXPO_PUBLIC_*
 * env vars; the defaults point at the existing `velocity-fe379` project.
 */
export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyCymN-ML5eHNVrI7fGbLD9QSAzeWyJZyII',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'velocity-fe379.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'velocity-fe379',
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'velocity-fe379.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_SENDER_ID ?? '63950615894',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '1:63950615894:web:4ad45c3f95a46dd17052f7',
};

/** Cloud Functions region — must match the backend (see backend/functions). */
export const FUNCTIONS_REGION = 'asia-south1';

/** Brand palette (kept in sync with the original design). */
export const colors = {
  primary: '#ccff00',      // Lime green for active controls / branding
  primaryDark: '#99c200',  // Darker lime green
  secondary: '#3b82f6',    // Blue accents
  surface: '#212222',      // Dark grey card/surface background
  card: '#212222',         // Alias for surface (used by new UI components)
  background: '#151616',   // Deep black/grey background
  text: '#ffffff',         // White text
  muted: '#8a8c8c',        // Light grey muted text
  border: '#2d2f2f',       // Dark border color
  danger: '#ef4444',       // Danger red
};

