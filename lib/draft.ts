'use client';

import { useCallback, useSyncExternalStore } from 'react';

const PREFIX = 'velocity.draft.';

/** The live value of each draft; localStorage is its copy that survives a reload. */
const memory = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string): string {
  if (!memory.has(key)) {
    let saved = '';
    try {
      saved = localStorage.getItem(PREFIX + key) ?? '';
    } catch {
      /* storage blocked (private window): the draft lives in memory only */
    }
    memory.set(key, saved);
  }
  return memory.get(key) ?? '';
}

/**
 * A text field that survives a reload, a crash or a sign-in that ended: what was
 * typed is kept in this browser until `clear()` — call it once the work is saved.
 */
export function useDraft(key: string): [string, (v: string | ((prev: string) => string)) => void, () => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      set.add(cb);
      listeners.set(key, set);
      return () => {
        set.delete(cb);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(subscribe, () => read(key), () => '');

  const set = useCallback(
    (next: string | ((prev: string) => string)) => {
      const v = typeof next === 'function' ? next(read(key)) : next;
      memory.set(key, v);
      try {
        if (v) localStorage.setItem(PREFIX + key, v);
        else localStorage.removeItem(PREFIX + key);
      } catch {
        /* storage blocked */
      }
      listeners.get(key)?.forEach((cb) => cb());
    },
    [key],
  );
  const clear = useCallback(() => set(''), [set]);
  return [value, set, clear];
}
