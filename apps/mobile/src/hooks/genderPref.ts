/**
 * "Who will you share a car with?" — asked once, obeyed everywhere.
 *
 * Every pooling surface in the app already enforced this rule, and every one of
 * them asked for it separately: a `mixedRideOk` switch buried on the nearby-rides
 * screen and another on the pool-ride browser. A rider who never opened either
 * screen had never answered the question — and because "no" and "never asked"
 * were the same stored value (`false`), the app quietly assumed same-gender-only
 * for them and filtered half the feed away without ever saying so.
 *
 * So the question moved to the home screen, where it is asked before a
 * destination is even typed, and the answer became a single piece of state this
 * module owns:
 *
 *   pref = 'same_gender' → share only with riders of your own gender
 *   pref = 'any_gender'  → any gender is fine
 *   pref = null          → not answered yet; home prompts for it
 *
 * `mixedRideOk` on the user doc is still the flag every gate reads — the rules
 * file, `canJoinPool`, `getSuggestedRides`, the en-route pickup gate — and it is
 * written in the same update as the new field, so one choice on home changes
 * what the whole app shows and allows. The new field exists only to tell "chose
 * same-gender" apart from "has not chosen", which `mixedRideOk` alone cannot.
 *
 * One Firestore listener is shared by every mounted consumer, so choosing on
 * home updates the pool browser behind it in the same frame, and the last known
 * answer is kept in module memory — re-entering home never flashes the prompt at
 * someone who has already answered.
 */
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';

export type SharedRideGenderPref = 'same_gender' | 'any_gender';

/** The field on `users/{uid}` that records the explicit answer. */
export const GENDER_PREF_FIELD = 'sharedRideGenderPref';

export interface GenderPrefState {
  /** False until the profile has been read once, so nothing is prompted blind. */
  loaded: boolean;
  /** The rider's answer, or null if they have not given one. */
  pref: SharedRideGenderPref | null;
  /** The rider's own gender, from their profile: 'male' | 'female' | 'unspecified'. */
  gender: string;
  /** What every gender gate in the app actually reads. */
  mixedRideOk: boolean;
  saving: boolean;
}

const EMPTY: GenderPrefState = {
  loaded: false,
  pref: null,
  gender: 'unspecified',
  mixedRideOk: false,
  saving: false,
};

let state: GenderPrefState = EMPTY;
/** The account the cached state belongs to — a different one must not inherit it. */
let cachedFor: string | null = null;
/** The account the live listener is attached to, null when nothing is mounted. */
let listeningTo: string | null = null;
let detach: (() => void) | null = null;
let consumers = 0;

const listeners = new Set<() => void>();

function publish(next: Partial<GenderPrefState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function read(uid: string): void {
  detach = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      const d = (snap.data() ?? {}) as Record<string, unknown>;
      const stored = d[GENDER_PREF_FIELD];
      const mixedRideOk = d.mixedRideOk === true;
      publish({
        loaded: true,
        gender: typeof d.gender === 'string' ? d.gender : 'unspecified',
        mixedRideOk,
        // Riders who opted into mixed rides on the old switch have answered the
        // question already — re-asking them would be rude and would risk
        // flipping a preference they set deliberately.
        pref:
          stored === 'same_gender' || stored === 'any_gender'
            ? stored
            : mixedRideOk
              ? 'any_gender'
              : null,
      });
    },
    // Offline, or a rules change we have not deployed yet. Mark it read rather
    // than leaving a spinner in the home sheet forever; the safe default (no
    // mixed rides) is already what `mixedRideOk: false` means.
    () => publish({ loaded: true }),
  );
}

function retain(uid: string | null): void {
  consumers += 1;
  // A different account must never inherit the last one's answer.
  if (uid !== cachedFor) {
    state = EMPTY;
    cachedFor = uid;
    for (const l of listeners) l();
  }
  if (listeningTo === uid) return;
  // Includes signing out while a screen is still mounted: the listener on the
  // previous account has to go, or it publishes that account's preference back
  // over the empty state we just set.
  detach?.();
  detach = null;
  listeningTo = uid;
  if (uid) read(uid);
}

function release(): void {
  consumers = Math.max(0, consumers - 1);
  if (consumers > 0) return;
  detach?.();
  detach = null;
  listeningTo = null;
  // `state` and `cachedFor` survive on purpose: the next screen to mount paints
  // the known answer on its first frame instead of prompting again.
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function snapshot(): GenderPrefState {
  return state;
}

export interface GenderPrefApi extends GenderPrefState {
  /** Records the answer, and with it the `mixedRideOk` flag every gate reads. */
  choose: (pref: SharedRideGenderPref) => Promise<void>;
}

export function useGenderPref(): GenderPrefApi {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  useEffect(() => {
    retain(uid);
    return release;
  }, [uid]);

  const store = useSyncExternalStore(subscribe, snapshot, snapshot);
  /**
   * `retain` runs in an effect, so the FIRST render after a second account
   * signs in on the same handset would otherwise paint the previous account's
   * answer — the module keeps it on purpose, to avoid re-prompting someone who
   * has already chosen. Falling back to EMPTY until the uid matches costs that
   * account one frame of "not loaded", which renders as nothing at all, and
   * never shows one rider another's preference.
   */
  const live = cachedFor === uid ? store : EMPTY;

  const choose = useCallback(
    async (pref: SharedRideGenderPref) => {
      if (!uid) return;
      const mixedRideOk = pref === 'any_gender';
      // Optimistic: the chips must answer the tap now, not after a round trip
      // on a Pakistani mobile connection. The snapshot overwrites this with the
      // server's version a moment later, and the catch below puts it back if the
      // write never landed.
      const previous = { pref: state.pref, mixedRideOk: state.mixedRideOk };
      publish({ pref, mixedRideOk, saving: true });
      try {
        await updateDoc(doc(db, 'users', uid), {
          [GENDER_PREF_FIELD]: pref,
          mixedRideOk,
        });
      } catch (err) {
        publish(previous);
        throw err;
      } finally {
        publish({ saving: false });
      }
    },
    [uid],
  );

  return { ...live, choose };
}

/** The chip caption for choosing "my own gender only", given who is asking. */
export function sameGenderLabel(gender: string): string {
  if (gender === 'female') return '♀ Women only';
  if (gender === 'male') return '♂ Men only';
  return 'Same gender only';
}

/** One line describing the standing choice, for rows that only report it. */
export function genderPrefSummary(pref: SharedRideGenderPref | null, gender: string): string {
  if (pref === 'any_gender') return 'Sharing with any gender';
  if (pref === 'same_gender') return `Sharing with ${sameGenderLabel(gender).replace(/^[♀♂]\s*/, '').toLowerCase()}`;
  return 'No preference chosen yet';
}
