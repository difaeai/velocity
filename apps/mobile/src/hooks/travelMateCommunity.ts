/**
 * Shared hooks for the TravelMate community feed.
 *
 * useBlockedSet   — live set of UIDs the current user has blocked. Every
 *                   community surface (feed, comments, search, discover,
 *                   chats, matches) filters through this so a blocked user
 *                   is never seen again.
 * useFollowingSet — live set of UIDs the current user follows (drives the
 *                   Follow/Following button state and the Following feed).
 * useMyTMProfile  — live TravelMate profile of the signed-in user (null =
 *                   no profile yet, undefined = still loading).
 */
import { useEffect, useState } from 'react';
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
