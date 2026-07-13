/**
 * Shared hooks for the Travel Partner community feed.
 *
 * useBlockedSet   — live set of UIDs the current user has blocked. Every
 *                   community surface (feed, comments, search, discover,
 *                   chats, matches) filters through this so a blocked user
 *                   is never seen again.
 * useFollowingSet — live set of UIDs the current user follows (drives the
 *                   Follow/Following button state and the Following feed).
 * useMyTMProfile  — live Travel Partner profile of the signed-in user (null =
 *                   no profile yet, undefined = still loading).
 * useTravelMateThreads — one listener over travelMateMatches, split into the
 *                   three surfaces: matches, chats and message requests.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../auth/AuthContext';

export function useBlockedSet(): Set<string> {
  const { user } = useAuth();
  const [blocked, setBlocked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) { setBlocked(new Set()); return; }
    return onSnapshot(
      query(collection(db, 'travelMateBlocks'), where('blockerId', '==', user.uid)),
      snap => setBlocked(new Set(snap.docs.map(d => d.data().blockedId as string))),
      () => {},
    );
  }, [user?.uid]);

  return blocked;
}

export function useFollowingSet(): Set<string> {
  const { user } = useAuth();
  const [following, setFollowing] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) { setFollowing(new Set()); return; }
    return onSnapshot(
      query(collection(db, 'travelMateFollows'), where('followerId', '==', user.uid)),
      snap => setFollowing(new Set(snap.docs.map(d => d.data().followedId as string))),
      () => {},
    );
  }, [user?.uid]);

  return following;
}

export interface MyTMProfile {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  bio?: string;
  active?: boolean;
}

export function useMyTMProfile(): MyTMProfile | null | undefined {
  const { user } = useAuth();
  const [profile, setProfile] = useState<MyTMProfile | null | undefined>(undefined);

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    return onSnapshot(
      doc(db, 'travelMateProfiles', user.uid),
      snap => setProfile(snap.exists() ? ({ uid: user.uid, ...snap.data() } as MyTMProfile) : null),
      () => setProfile(null),
    );
  }, [user?.uid]);

  return profile;
}

// ── Threads: matches, chats and message requests ────────────────────────────

export type ThreadStatus = 'active' | 'unmatched' | 'declined';
export type ThreadOrigin = 'swipe' | 'feed' | 'group';
export type RequestStatus = 'pending' | 'accepted' | 'declined';

export interface TravelThread {
  id: string;
  users: string[];
  userInfo: Record<string, { displayName: string; photoURL: string | null }>;
  status: ThreadStatus;
  /** How the thread started. Absent on threads created before requests existed. */
  origin?: ThreadOrigin;
  /** Absent on legacy threads — those are treated as already accepted. */
  requestStatus?: RequestStatus;
  requestFrom?: string | null;
  requestTo?: string | null;
  requestSent?: boolean;
  lastMessage?: string | null;
  lastMessageAt?: { seconds: number } | null;
  matchedAt?: { seconds: number };
  createdAt?: { seconds: number };
}

export interface TravelThreads {
  /** Mutual right-swipes only — the one thing that counts as a Match. */
  matches: TravelThread[];
  /** Every open conversation you can actually talk in. */
  chats: TravelThread[];
  /** Someone messaged you first and is waiting on Accept / Delete. */
  requests: TravelThread[];
}

const EMPTY: TravelThreads = { matches: [], chats: [], requests: [] };

/** Newest activity first. */
function recency(t: TravelThread): number {
  return t.lastMessageAt?.seconds ?? t.matchedAt?.seconds ?? t.createdAt?.seconds ?? 0;
}

/**
 * Live view of the signed-in user's Travel Partner threads.
 *
 * One listener feeds all three surfaces (Matches, Chats, Message requests) so
 * they can never disagree with each other. The split lives here rather than in
 * each screen because the rules are subtle:
 *
 *   - A *match* is only ever a mutual right-swipe. A DM from the feed or a
 *     group is not a match, no matter how much you chat afterwards.
 *   - A pending request appears in the recipient's requests inbox, and only
 *     once the sender's opening message has actually landed. It stays out of
 *     the sender's chat list until it's accepted — there's nothing to say yet.
 */
export function useTravelMateThreads(): TravelThreads {
  const { user } = useAuth();
  const blocked = useBlockedSet();
  const [threads, setThreads] = useState<TravelThread[]>([]);

  useEffect(() => {
    if (!user) { setThreads([]); return; }
    return onSnapshot(
      query(collection(db, 'travelMateMatches'), where('users', 'array-contains', user.uid)),
      snap => setThreads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TravelThread)),
      () => setThreads([]),
    );
  }, [user?.uid]);

  return useMemo(() => {
    const uid = user?.uid;
    if (!uid) return EMPTY;

    const visible = threads
      .filter(t => t.status === 'active')
      .filter(t => !t.users.some(u => u !== uid && blocked.has(u)))
      .sort((a, b) => recency(b) - recency(a));

    const accepted = visible.filter(t => (t.requestStatus ?? 'accepted') === 'accepted');

    return {
      // Threads from before this feature carry no `origin`, and back then only
      // a mutual swipe could create one — so an absent origin means 'swipe'.
      matches: accepted.filter(t => (t.origin ?? 'swipe') === 'swipe'),
      chats: accepted,
      requests: visible.filter(
        t => t.requestStatus === 'pending' && t.requestTo === uid && !!t.lastMessageAt,
      ),
    };
  }, [threads, blocked, user?.uid]);
}
