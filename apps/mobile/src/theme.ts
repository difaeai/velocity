/**
 * Theme engine — dark (default) and light modes, applied LIVE (no reload).
 *
 * Screens build their StyleSheet through `themed(() => StyleSheet.create({…}))`
 * instead of calling StyleSheet.create at module load directly. `themed` returns
 * a lazy proxy that rebuilds the sheet from the current `colors` whenever the
 * global theme version changes, so switching themes is instant: we mutate the
 * shared `colors` object, bump the version (invalidating every proxy), and force
 * a re-render of the route tree. No expo-updates reload, no app restart.
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

// ── Live-theme version store ──────────────────────────────────────────────────
// Every `themed()` proxy caches its built sheet against this counter; bumping it
// invalidates all of them at once. Listeners (the root layout) re-render/remount
// so mounted screens rebuild their styles from the new palette.
let themeVersion = 0;
const listeners = new Set<() => void>();

export function getThemeVersion(): number {
  return themeVersion;
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function bumpThemeVersion() {
  themeVersion += 1;
  listeners.forEach((l) => l());
}

/**
 * Wrap a StyleSheet factory so its styles are rebuilt from the current palette
 * whenever the theme changes. Screens use it exactly like StyleSheet.create:
 *
 *   const styles = themed(() => StyleSheet.create({ … colors.background … }));
 *
 * The returned value is a proxy over the built sheet; property access rebuilds
 * lazily the first time it's read after a theme switch, then serves the cache.
 */
export function themed<T extends object>(factory: () => T): T {
  let built: T | null = null;
  let builtVersion = -1;

  const ensure = (): T => {
    if (built === null || builtVersion !== themeVersion) {
      built = factory();
      builtVersion = themeVersion;
    }
    return built;
  };

  return new Proxy({} as T, {
    get(_t, prop) {
      return (ensure() as Record<PropertyKey, unknown>)[prop];
    },
    has(_t, prop) {
      return prop in (ensure() as object);
    },
    ownKeys() {
      return Reflect.ownKeys(ensure() as object);
    },
    getOwnPropertyDescriptor(_t, prop) {
      return Object.getOwnPropertyDescriptor(ensure() as object, prop);
    },
  });
}

/**
 * Synchronously apply a theme to the shared `colors` object. Exported so the
 * app entry point can apply the saved theme BEFORE expo-router imports the
 * route screens — the first proxy build then bakes the correct palette.
 */
export function applyTheme(mode: ThemeMode) {
  currentMode = mode;
  Object.assign(colors, mode === 'light' ? LIGHT : DARK);
}

/** Map a raw stored value to a valid mode. */
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
 * Persist + apply the opposite theme LIVE. Mutates the palette, invalidates all
 * `themed()` proxies, and notifies listeners so the UI re-themes without a
 * reload. Resolves to true (kept for callers that previously checked whether a
 * reload happened — a live switch always "succeeds").
 */
export async function toggleTheme(): Promise<boolean> {
  const next: ThemeMode = currentMode === 'dark' ? 'light' : 'dark';
  await AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  apply(next);
  bumpThemeVersion();
  return true;
}

/** Apply an explicit mode LIVE (same mechanism as toggleTheme). */
export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  apply(mode);
  bumpThemeVersion();
}
