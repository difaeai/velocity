/**
 * "Should this user see ads?" — the single entitlement gate every placement asks.
 *
 * Paying users are ad-free. Two things buy that:
 *   • an active Travel Partner subscription (`travelMateSubscriptions`), and
 *   • the Pro partner tier (`partners/{uid}.tier === 'pro'`, until proExpiresAt).
 *
 * Either one clears ads across the WHOLE app, not just the section it was bought
 * in. Someone paying for Travel Partner Pro who still gets banners in the booking
 * sheet reads it as the payment not working, and that becomes a refund request.
 *
 * The listeners are a module-level singleton keyed by uid rather than per-hook,
 * because up to three banners can be mounted at once and each additional
 * onSnapshot is a real cost on a low-end handset on mobile data.
 */
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../auth/AuthContext';

/**
 * Master kill switch, checked before any per-user entitlement.
 *
 * Off by default, and deliberately so. The Play listing's "Contains ads" badge
 * and the public developer address that comes with a monetised personal account
 * are both consequences of shipping ads, so a build must be able to prove it
 * shows none — and "we forgot to set the variable" has to fail towards showing
 * NOTHING, never towards showing an ad the Play declaration says isn't there.
 *
 * Build time, not remote config, for the same reason: the declaration describes
 * the binary Google reviews, and a server-side toggle would let a shipped "no
 * ads" build start serving them after review.
 *
 * With this false, no placement mounts, the SDK is never initialised, and no ad
 * is ever requested — the AdMob dependency stays linked but completely inert.
 * To turn revenue back on: set EXPO_PUBLIC_ADS_ENABLED=true, rebuild, and flip
 * Play Console → App content → Ads back to "Yes" BEFORE that build rolls out.
 */
const ADS_ENABLED = process.env.EXPO_PUBLIC_ADS_ENABLED === 'true';

/** Undefined while unknown — callers must treat that as "no ads yet". */
type Entitlement = boolean | undefined;

interface Store {
  paid: Entitlement;
  listeners: Set<() => void>;
  stop: () => void;
}

let current: { uid: string; store: Store } | null = null;

/** A Firestore timestamp that is absent or in the past does not grant anything. */
function stillValid(ts: Timestamp | null | undefined): boolean {
  if (!ts) return false;
  return ts.toMillis() > Date.now();
}

function open(uid: string): Store {
  let isPro = false;
  let hasSub = false;
  let proReady = false;
  let subReady = false;

  const store: Store = {
    paid: undefined,
    listeners: new Set(),
    stop: () => {},
  };

  const publish = () => {
    // Stay `undefined` until BOTH sources have reported. Resolving early would
    // flash a banner at a subscriber for the moment before their sub loads.
    const next = proReady && subReady ? isPro || hasSub : undefined;
    if (next === store.paid) return;
    store.paid = next;
    store.listeners.forEach((l) => l());
  };

  const unsubPartner = onSnapshot(
    doc(db, 'partners', uid),
    (snap) => {
      const data = snap.data();
      isPro =
        snap.exists() &&
        data?.tier === 'pro' &&
        // A lapsed Pro partner goes back to seeing ads, so an expired
        // subscription cannot silently keep the app ad-free forever.
        stillValid(data?.proExpiresAt as Timestamp | undefined);
      proReady = true;
      publish();
    },
    () => {
      // A permission error or offline read must not grant free access, but it
      // also must not hang the gate — report "not paid" and let ads show.
      isPro = false;
      proReady = true;
      publish();
    },
  );

  const unsubSubs = onSnapshot(
    query(
      collection(db, 'travelMateSubscriptions'),
      where('uid', '==', uid),
      where('status', '==', 'active'),
    ),
    (snap) => {
      hasSub = snap.docs.some((d) => stillValid(d.data()?.endAt as Timestamp | undefined));
      subReady = true;
      publish();
    },
    () => {
      hasSub = false;
      subReady = true;
      publish();
    },
  );

  store.stop = () => {
    unsubPartner();
    unsubSubs();
  };
  return store;
}

/**
 * True when ads should be shown to the current user.
 *
 * Signed-out users see ads (they cannot have bought anything). Signed-in users
 * see ads only once both entitlement sources have confirmed they hold neither.
 */
export function useAdsEnabled(): boolean {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [, force] = useState(0);

  useEffect(() => {
    // Nothing to watch when ads are off for everyone — skip the two Firestore
    // snapshots entirely rather than paying for an answer no one will read.
    if (!ADS_ENABLED || !uid) return;

    if (current?.uid !== uid) {
      current?.store.stop();
      current = { uid, store: open(uid) };
    }
    const store = current.store;
    const rerender = () => force((n) => n + 1);
    store.listeners.add(rerender);

    return () => {
      store.listeners.delete(rerender);
      // Last placement unmounted — drop the listeners rather than holding two
      // snapshots open for the rest of the session.
      if (store.listeners.size === 0 && current?.store === store) {
        store.stop();
        current = null;
      }
    };
  }, [uid]);

  if (!ADS_ENABLED) {
    if (__DEV__) logDisabled();
    return false;
  }

  if (!uid) return true;
  const paid = current?.uid === uid ? current.store.paid : undefined;
  const enabled = paid === false;

  // Ads failing closed is right for policy but invisible to debug: "no banner
  // anywhere" looks identical whether the user is a paying Pro partner, the
  // entitlement is still loading, or something is actually broken. Say which,
  // once per state change, in development only.
  if (__DEV__) logGate(uid, paid);

  return enabled;
}

let loggedDisabled = false;

/** Said once per session, so "no banners anywhere" is never a mystery. */
function logDisabled() {
  if (loggedDisabled) return;
  loggedDisabled = true;
  console.log(
    '[ads] disabled for this build — EXPO_PUBLIC_ADS_ENABLED is not "true". No ad ' +
      'SDK init, no requests, no placements. This matches the Play Console ' +
      '"App content → Ads → No" declaration; set the var and rebuild to re-enable.',
  );
}

let lastLogged: string | null = null;

function logGate(uid: string, paid: Entitlement) {
  const state = `${uid}:${String(paid)}`;
  if (state === lastLogged) return;
  lastLogged = state;
  if (paid === undefined) {
    console.log('[ads] hidden — entitlement still loading for', uid);
  } else if (paid) {
    console.log(
      `[ads] hidden — ${uid} is a PAYING user (Pro partner or active Travel Partner ` +
        'subscription). This is intended: sign in with a non-paying account to see ads.',
    );
  } else {
    console.log('[ads] enabled —', uid, 'holds no paid entitlement');
  }
}
