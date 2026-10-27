'use client';

/**
 * The homepage's one voice.
 *
 * The films are silent, so the hero, the scroll film and the five steps each
 * have narration (`siteVoice.json`). Whichever part is crossing the middle of
 * the screen asks to be heard and the latest ask wins, so the sound is always
 * about what the visitor is looking at; a part that scrolls away goes quiet.
 *
 * No browser plays sound before the visitor's first tap, click or key on the
 * page. That first touch — anywhere — starts whatever is waiting. One mute in
 * the header covers all of it, and is remembered on this device.
 */

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

export interface SiteSound {
  muted: boolean;
  speaking: boolean;
  /** The part of the page the voice belongs to right now. */
  owner: string | null;
}

const KEY = 'velocity.sound.muted';
const EVENTS = ['pointerdown', 'keydown', 'touchend'];
const QUIET: SiteSound = { muted: false, speaking: false, owner: null };

let state = QUIET;
let ready = false;
let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
/** When the touch that let sound start happened (event time). */
let unlockedAt = -1e9;
const listeners = new Set<() => void>();

function set(patch: Partial<SiteSound>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

/** Once, in the browser: the remembered mute, and the first-touch listener. */
function init() {
  if (ready || typeof window === 'undefined') return;
  ready = true;
  try {
    if (localStorage.getItem(KEY) === '1') state = { ...state, muted: true };
  } catch {
    // Private mode or blocked storage: sound starts on, as for anyone new.
  }
  const go = (e: Event) => {
    unlockedAt = e.timeStamp;
    for (const t of EVENTS) window.removeEventListener(t, go, true);
    wake();
    if (audio?.src && audio.paused && state.owner && !state.muted) void audio.play().catch(() => undefined);
  };
  for (const t of EVENTS) window.addEventListener(t, go, true);
}

function voice(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('play', () => set({ speaking: true }));
    audio.addEventListener('pause', () => set({ speaking: false }));
    audio.addEventListener('ended', () => set({ speaking: false }));
  }
  return audio;
}

/** The sound effects' engine, made (or woken) once the page may play sound. */
function wake() {
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = AC ? new AC() : null;
  }
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** `owner` wants `url` read now, from the top. Held until the first touch if the browser will not play yet. */
export function say(owner: string, url: string) {
  init();
  const el = voice();
  set({ owner });
  el.src = url;
  if (!state.muted) el.play().then(wake, () => undefined);
}

/** `owner` scrolled away: silence, unless someone else has the voice already. */
export function hush(owner: string) {
  if (state.owner !== owner) return;
  audio?.pause();
  set({ owner: null });
}

/** The header's speaker. `at` is the click's event time: the tap that just let sound start is not a request to mute. */
export function toggleMute(at: number) {
  if (!state.muted && at - unlockedAt < 800) return;
  const muted = !state.muted;
  try {
    localStorage.setItem(KEY, muted ? '1' : '0');
  } catch {
    // Not remembered on this device; the choice still holds for this visit.
  }
  set({ muted });
  if (muted) audio?.pause();
  else if (audio?.src && state.owner) audio.play().then(wake, () => undefined);
}

/** A running audio context for the small sound effects, or null while muted or not yet allowed. */
export const effects = (): AudioContext | null => (!state.muted && ctx?.state === 'running' ? ctx : null);

const subscribe = (fn: () => void) => {
  init();
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useSiteSound(): SiteSound {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => QUIET,
  );
}

/** Whether `ref`'s element spans the middle line of the screen — the part that gets the voice. */
export function useAtMiddle(ref: RefObject<HTMLElement | null>): boolean {
  const [at, setAt] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setAt(e.isIntersecting), { rootMargin: '-50% 0px -50% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return at;
}

/** The header's speaker: quiet, out of the way, and it mutes everything. */
export function SoundToggle({ className }: { className?: string }) {
  const { muted, speaking } = useSiteSound();
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => toggleMute(e.timeStamp)}
      aria-pressed={!muted}
      aria-label={muted ? 'Turn the narration on' : 'Mute the narration'}
      title={muted ? 'Sound off' : 'Sound on'}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" />
        {muted ? (
          <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />
        ) : (
          <path d={speaking ? 'M16 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12' : 'M16 8.5a5 5 0 0 1 0 7'} />
        )}
      </svg>
    </button>
  );
}
