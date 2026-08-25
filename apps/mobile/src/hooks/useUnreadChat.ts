import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '../firebase';

/**
 * Unread in-ride messages from the other side of the ride.
 *
 * A push covers the case where the app is in the background. It does nothing
 * for the case that actually loses messages: the driver is looking at the trip
 * screen, the passenger writes "I'm at the blue gate", and the only sign of it
 * is a Message button that looks exactly as it did a second ago. Android does
 * not surface a notification for an app already in the foreground, so without
 * this the message is delivered to a screen nobody is looking at.
 *
 * "Read" is the last time this room's chat was opened, kept per room in
 * AsyncStorage so it survives a reload and never counts the user's own
 * messages back at them.
 */
const SEEN_KEY = (roomId: string) => `velocity.chatSeen.${roomId}`;

/** Enough to badge "9+" without streaming a whole conversation to count it. */
const SCAN_LIMIT = 30;

interface ChatDoc {
  senderId?: string;
  sentAt?: { seconds?: number } | null;
}

export function useUnreadChat(
  roomId: string | undefined,
  myUid: string | undefined,
): { unread: number; latestFrom: string | null; markRead: () => void } {
  const [unread, setUnread] = useState(0);
  const [latestFrom, setLatestFrom] = useState<string | null>(null);
  // Millisecond timestamp of the last time this room was opened. Held in a ref
  // as well as state so the snapshot handler always reads the current value
  // without re-subscribing every time it moves.
  const seenAtRef = useRef<number>(0);
  const [seenLoaded, setSeenLoaded] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    AsyncStorage.getItem(SEEN_KEY(roomId))
      .then((raw) => {
        if (!alive) return;
        seenAtRef.current = Number(raw) || 0;
        setSeenLoaded(true);
      })
      .catch(() => { if (alive) setSeenLoaded(true); });
    return () => { alive = false; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !myUid || !seenLoaded) return;
    const q = query(
      collection(db, 'trips', roomId, 'chat'),
      orderBy('sentAt', 'desc'),
      limit(SCAN_LIMIT),
    );
    return onSnapshot(
      q,
      (snap) => {
        let count = 0;
        let newestOther: string | null = null;
        for (const d of snap.docs) {
          const m = d.data() as ChatDoc;
          if (!m.senderId || m.senderId === myUid) continue;
          // A message still awaiting its server timestamp has just been written
          // by somebody else — it is unread by definition.
          const at = m.sentAt?.seconds ? m.sentAt.seconds * 1000 : Date.now();
          if (at <= seenAtRef.current) continue;
          count += 1;
          if (!newestOther) newestOther = d.id;
        }
        setUnread(count);
        setLatestFrom(newestOther);
      },
      () => { /* a chat we cannot read is not a chat with unread messages */ },
    );
  }, [roomId, myUid, seenLoaded]);

  const markRead = useCallback(() => {
    if (!roomId) return;
    const now = Date.now();
    seenAtRef.current = now;
    setUnread(0);
    setLatestFrom(null);
    AsyncStorage.setItem(SEEN_KEY(roomId), String(now)).catch(() => {});
  }, [roomId]);

  return { unread, latestFrom, markRead };
}
