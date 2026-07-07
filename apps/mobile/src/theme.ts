/**
 * Theme engine — dark (default) and light modes.
 *
 * Every screen builds its StyleSheet from the shared `colors` object at module
 * load, so themes are applied by MUTATING that object in place before any
 * screen module is evaluated (the root layout gates rendering on `loadTheme()`).
 * Switching therefore requires a reload: instant when expo-updates is present
 * (production) or in dev (DevSettings); otherwise the user reopens the app.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors } from './config';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'velocity_theme_mode';

/** The dark palette mirrors the defaults in src/config.ts. */
const DARK: Record<string, string> = {
  primary: '#ccff00',
  primaryDark: '#99c200',
  secondary: '#3b82f6',
  surface: 'rgba(255,255,255,0.06)',
  card: 'rgba(255,255,255,0.06)',
  background: '#101211',
  text: '#ffffff',
  muted: '#9aa19e',
  border: 'rgba(255,255,255,0.12)',
  danger: '#ef4444',
  btnBg: '#ccff00',
  btnText: '#000000',
  glassPanel: 'rgba(13,15,14,0.90)',
  glassChip: 'rgba(255,255,255,0.10)',
  glassStrong: 'rgba(255,255,255,0.12)',
  glassLime: 'rgba(204,255,0,0.10)',
  glassLimeBorder: 'rgba(204,255,0,0.35)',
};

/**
 * Light: white screens, black primary buttons with white labels, and the
 * lime brand accent darkened to olive so accent text stays readable on white.
 */
const LIGHT: Record<string, string> = {
  primary: '#5d7a00',
  primaryDark: '#465e00',
  secondary: '#2563eb',
  surface: 'rgba(0,0,0,0.05)',
  card: 'rgba(0,0,0,0.05)',
  background: '#f6f7f6',
  text: '#111413',
  muted: '#5f6663',
  border: 'rgba(0,0,0,0.14)',
  danger: '#dc2626',
  btnBg: '#111312',
  btnText: '#ffffff',
  glassPanel: 'rgba(255,255,255,0.93)',
  glassChip: 'rgba(0,0,0,0.07)',
  glassStrong: 'rgba(0,0,0,0.10)',
  glassLime: 'rgba(140,180,0,0.15)',
  glassLimeBorder: 'rgba(110,150,0,0.45)',
};

let currentMode: ThemeMode = 'dark';

export function getThemeMode(): ThemeMode {
  return currentMode;
}

/**
 * Synchronously apply a theme to the shared `colors` object. Exported so the
 * app entry point can apply the saved theme BEFORE expo-router imports the
 * route screens — otherwise each screen's StyleSheet bakes the default (dark)
 * palette and the theme never visually applies until the next reload.
 */
export function applyTheme(mode: ThemeMode) {
  currentMode = mode;
  Object.assign(colors, mode === 'light' ? LIGHT : DARK);
}

/** Read the saved theme synchronously is impossible (AsyncStorage is async),
 * so the entry point reads it and calls applyTheme. This maps the raw stored
 * value to a valid mode. */
export function normalizeMode(saved: string | null): ThemeMode {
  return saved === 'light' ? 'light' : 'dark';
}

export const THEME_STORAGE_KEY = STORAGE_KEY;

function apply(mode: ThemeMode) {
  applyTheme(mode);
}

/** Load + apply the saved theme. Must resolve before any screen renders. */
export async function loadTheme(): Promise<ThemeMode> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    apply(saved === 'light' ? 'light' : 'dark');
  } catch {
    apply('dark');
  }
  return currentMode;
}

/**
 * Best-effort full JS reload so already-loaded screens pick up the new
 * palette. Returns false when no reload mechanism exists (production build
 * without expo-updates) — callers should then ask the user to reopen the app.
 */
async function reloadApp(): Promise<boolean> {
  // In development the app is served by Metro, so a JS fast-reload is the only
  // valid path — calling expo-updates reloadAsync() against a dev server errors
  // out ("cannot reload in development"). Use DevSettings and never touch Updates.
  if (__DEV__) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DevSettings } = require('react-native');
      if (DevSettings?.reload) {
        DevSettings.reload();
        return true;
      }
    } catch { /* not available */ }
    return false;
  }
  // Production: reload via expo-updates when it's present.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Updates = require('expo-updates');
    if (Updates?.reloadAsync) {
      await Updates.reloadAsync();
      return true;
    }
  } catch { /* expo-updates not installed */ }
  return false;
}

/**
 * Persist + apply the opposite theme. Resolves to true when the app reloaded
 * itself; false when the user needs to close and reopen the app manually.
 */
export async function toggleTheme(): Promise<boolean> {
  const next: ThemeMode = currentMode === 'dark' ? 'light' : 'dark';
  await AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  apply(next);
  return reloadApp();
}
