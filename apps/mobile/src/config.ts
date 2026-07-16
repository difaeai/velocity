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

/**
 * Google Maps / Places API key (client Android key — same Firebase project).
 *
 * NOT hardcoded: it is read from the environment (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)
 * so the value never lives in source / a public repo. Set it in apps/mobile/.env
 * for local runs and as an EAS secret for builds. Empty in dev falls back to no
 * key (maps won't render) rather than shipping a real key in the bundle.
 */
export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/**
 * Brand palette — glassmorphism edition.
 *
 * Surfaces are translucent white-on-dark ("frosted glass") with soft alpha
 * borders, so every card and panel picks up depth from whatever sits behind
 * it (map, gradients, other layers). Pure JS — no native blur module — which
 * keeps the current dev/production builds valid and stays fast on low-end
 * Android devices. Accent tokens (primary/danger/secondary) stay hex because
 * screens derive tints from them via string concat (e.g. colors.primary+'40').
 */
export const colors = {
  primary: '#ccff00',                       // Lime green for active controls / branding
  primaryDark: '#99c200',                   // Darker lime green
  secondary: '#3b82f6',                     // Blue accents
  surface: 'rgba(255,255,255,0.06)',        // Frosted glass card
  card: 'rgba(255,255,255,0.06)',           // Alias for surface (used by new UI components)
  background: '#101211',                    // Deep charcoal backdrop behind the glass
  text: '#ffffff',                          // White text
  muted: '#9aa19e',                         // Light grey muted text
  border: 'rgba(255,255,255,0.12)',         // Glass edge highlight
  danger: '#ef4444',                        // Danger red
  btnBg: '#ccff00',                         // Primary button fill (black in light mode)
  btnText: '#000000',                       // Primary button label (white in light mode)

  // ── Glassmorphism helpers ──────────────────────────────────────────────────
  glassPanel: 'rgba(13,15,14,0.90)',        // Dark translucent sheets over maps
  glassChip: 'rgba(255,255,255,0.10)',      // Floating buttons / pills over maps
  glassStrong: 'rgba(255,255,255,0.12)',    // Elevated glass (modals, selected rows)
  glassLime: 'rgba(204,255,0,0.10)',        // Lime-tinted glass accents
  glassLimeBorder: 'rgba(204,255,0,0.35)',  // Lime glass edge
};

