/**
 * Rings this phone, wherever in the app it is, when the driver or rider calls.
 *
 * The push wakes a closed app; this covers the open one, where a tray banner is
 * easy to miss mid-ride. One small query, live while signed in, that matches
 * nothing almost all of the time.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { openCalls } from '../lib/inAppCall';

/** A call still "ringing" after this was left behind by a caller whose app died. */
const STALE_MS = 2 * 60_000;

/** Calls already put on screen once — a declined call must not ring again on the next snapshot. */
const rung = new Set<string>();

export function IncomingCallWatcher() {
  const { user } = useAuth();
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;
    const ringing = query(
      collection(db, 'calls'),
      where('calleeId', '==', uid),
      where('status', '==', 'ringing'),
    );
    return onSnapshot(
      ringing,
      (snap) => {
        for (const d of snap.docs) {
          const at = (d.get('createdAt') as { toMillis(): number } | null)?.toMillis() ?? Date.now();
          if (rung.has(d.id) || Date.now() - at > STALE_MS) continue;
          // Busy on another call: let this one ring out to "No answer"; its
          // notification still sits in the tray as a missed call.
          if (openCalls.size > 0) continue;
          // In the background the full-screen notification rings instead
          // (src/lib/incomingCallTask.ts); a screen pushed behind it would
          // ring a second time underneath.
          if (AppState.currentState !== 'active') continue;
          rung.add(d.id);
          router.push(`/call/${d.id}`);
          // One screen per snapshot: openCalls only fills once that screen mounts.
          break;
        }
      },
      // Offline or signing out: the push still rings.
      () => {},
    );
  }, [uid]);

  return null;
}
