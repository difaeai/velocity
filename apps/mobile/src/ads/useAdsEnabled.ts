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
    if (!uid) return;

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
