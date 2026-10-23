'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;

/** The server has no media queries; assume motion is fine and correct on hydrate. */
const getServerSnapshot = () => false;

/**
 * Reads the OS "reduce motion" setting as a subscription rather than as state
 * set inside an effect, so the first render already has the right answer on the
 * client and a mid-session change to the setting takes effect immediately.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const never = () => () => {};
const savingData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

/** The browser's Data Saver: films then show their posters and download nothing. */
export function useSaveData(): boolean {
  return useSyncExternalStore(never, savingData, () => false);
}
