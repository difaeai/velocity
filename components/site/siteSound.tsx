'use client';

/**
 * The homepage's one voice, and the scroll film's score.
 *
 * The films are silent, so the hero, the scroll film and the five steps each
 * have narration (`siteVoice.json`). Whichever part is crossing the middle of
 * the screen asks to be heard and the latest ask wins, so the sound is always
 * about what the visitor is looking at; a part that scrolls away goes quiet.
 * The scroll film also carries a soft score — one chord per chapter, drawn
 * live with Web Audio — while it holds the middle of the screen.
 *
 * No browser plays sound before the visitor's first tap, click or key on the
 * page. That first touch — anywhere — starts whatever is waiting; until then a
 * label under the header's speaker says so. One mute in the header covers all
 * of it, and is remembered on this device.
 */

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

export interface SiteSound {
  muted: boolean;
  speaking: boolean;
  /** The part of the page the voice belongs to right now. */
  owner: string | null;
  /** The page may play sound: the visitor has touched it, or the browser allowed it anyway. */
  unlocked: boolean;
}

const KEY = 'velocity.sound.muted';
const EVENTS = ['pointerdown', 'keydown', 'touchend'];
const QUIET: SiteSound = { muted: false, speaking: false, owner: null, unlocked: false };
/** The score's level: about −30 LUFS, 14 dB under the narration's −16 (measured with ffmpeg ebur128 on a render). */
const BED_GAIN = 0.22;

let state = QUIET;
let ready = false;
let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
/** A line asked for while the same part's line was still being read: read next, never over it. */
let next: string | null = null;
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
    set({ unlocked: true });
    wake();
    if (audio?.src && audio.paused && state.owner && !state.muted) void audio.play().catch(() => undefined);
  };
  for (const t of EVENTS) window.addEventListener(t, go, true);
}

function voice(): HTMLAudioElement {
  if (!audio) {
    const el = new Audio();
    el.preload = 'auto';
    el.addEventListener('play', () => set({ speaking: true }));
    el.addEventListener('pause', () => set({ speaking: false }));
    el.addEventListener('ended', () => {
      set({ speaking: false });
      if (!next || !state.owner) return;
      el.src = next;
      next = null;
      if (!state.muted) void el.play().catch(() => undefined);
    });
    audio = el;
  }
  return audio;
}

/** The sound engine for the effects and the score, made (or woken) once the page may play sound. */
function wake() {
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = AC ? new AC() : null;
  }
  if (ctx?.state === 'suspended') void ctx.resume().then(tune, () => undefined);
  else tune();
}

/** A play() that worked means the browser allows sound here, touch or not. */
const started = () => {
  if (!state.unlocked) set({ unlocked: true });
  wake();
};

/**
 * `owner` wants `url` read now, from the top. Held until the first touch if the
 * browser will not play yet. With `letFinish`, a line `owner` is still reading
 * is never cut: `url` is read after it (and a later ask replaces `url`).
 */
export function say(owner: string, url: string, { letFinish = false } = {}) {
  init();
  const el = voice();
  if (letFinish && state.owner === owner && state.speaking) {
    next = url;
    return;
  }
  next = null;
  set({ owner });
  el.src = url;
  if (!state.muted) el.play().then(started, () => undefined);
}

/** `owner` scrolled away: silence, unless someone else has the voice already. */
export function hush(owner: string) {
  if (state.owner !== owner) return;
  next = null;
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
  tune();
  if (muted) audio?.pause();
  else if (audio?.src && state.owner) audio.play().then(started, () => undefined);
}

/** A running audio context for the small sound effects, or null while muted or not yet allowed. */
export const effects = (): AudioContext | null => (!state.muted && ctx?.state === 'running' ? ctx : null);

// ── the scroll film's score ─────────────────────────────────────────────────

interface Bed {
  gain: GainNode;
  filter: BiquadFilterNode;
  oscs: OscillatorNode[];
}

let bed: Bed | null = null;
let wanted: { chord: number[]; bright: number } | null = null;

/**
 * A soft pad: two slightly detuned saws per note, through a low-pass that
 * opens as `bright` goes 0 → 1, fading in over a couple of seconds. Exported
 * so the PR's loudness check renders exactly this.
 */
export function buildBed(ac: BaseAudioContext, chord: number[], bright: number): Bed {
  const gain = ac.createGain();
  gain.gain.value = 0;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.6;
  filter.frequency.value = cutoff(bright);
  filter.connect(gain).connect(ac.destination);
  const oscs = Array.from({ length: 10 }, (_, i) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sawtooth';
    o.detune.value = i % 2 ? 7 : -7;
    o.frequency.value = chord[Math.floor(i / 2) % chord.length];
    g.gain.value = 0.1;
    o.connect(g).connect(filter);
    o.start();
    return o;
  });
  gain.gain.setTargetAtTime(BED_GAIN, ac.currentTime, 0.8);
  return { gain, filter, oscs };
}

const cutoff = (bright: number) => 650 + bright * 1100;

/** Bring the score to what is wanted: playing it, moving to a new chord, or fading out. */
function tune() {
  const ac = effects();
  if (!ac || !wanted) {
    if (!bed) return;
    const old = bed;
    bed = null;
    const t = old.gain.context.currentTime;
    old.gain.gain.setTargetAtTime(0, t, 0.4);
    setTimeout(() => old.oscs.forEach((o) => o.stop()), 2500);
    return;
  }
  if (!bed) {
    bed = buildBed(ac, wanted.chord, wanted.bright);
    return;
  }
  const t = ac.currentTime;
  const { chord, bright } = wanted;
  bed.oscs.forEach((o, i) => o.frequency.setTargetAtTime(chord[Math.floor(i / 2) % chord.length], t, 0.3));
  bed.filter.frequency.setTargetAtTime(cutoff(bright), t, 0.8);
}

/** The scroll film asks for `chord` (Hz) at `bright` 0–1, or null for silence. Held until sound is allowed. */
export function score(chord: number[] | null, bright = 0) {
  init();
  wanted = chord ? { chord, bright } : null;
  tune();
}

// ── hooks and the header's controls ─────────────────────────────────────────

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

/** Until the page may play sound, a label under the speaker asks for the one press that starts it. */
export function SoundHint({ className, children }: { className?: string; children?: React.ReactNode }) {
  const { unlocked, muted } = useSiteSound();
  if (unlocked || muted) return null;
  return (
    <span className={className} role="note">
      {children ?? 'Press the volume button for a better understanding — a narrator explains every part.'}
    </span>
  );
}
