/**
 * Firebase Web config for the admin panel. The Web API key is not a secret;
 * access is enforced by the security rules (admins need the `admin` claim).
 * Override per-environment with NEXT_PUBLIC_FIREBASE_* vars.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyCymN-ML5eHNVrI7fGbLD9QSAzeWyJZyII',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'velocity-fe379.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'velocity-fe379',
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'velocity-fe379.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_SENDER_ID ?? '63950615894',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '1:63950615894:web:4ad45c3f95a46dd17052f7',
};

/** Must match the backend Cloud Functions region. */
export const FUNCTIONS_REGION = 'asia-south1';

export const colors = {
  primary: '#004c31',
  primaryDark: '#003924',
  secondary: '#0058bb',
  bg: '#f5f7f6',
  surface: '#ffffff',
  text: '#1c1b1b',
  muted: '#6f7a72',
  border: '#e2e8e4',
  danger: '#ba1a1a',
  warn: '#b45309',
  success: '#047857',
};
