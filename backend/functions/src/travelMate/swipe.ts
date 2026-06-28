/**
 * Velocity – Travel Mate – travelMateSwipe (callable, v2)
 * ----------------------------------------------------------------------------
 * The single source of truth for the like paywall. A right-swipe ("like")
 * consumes quota; a left-swipe ("pass") is free. All quota math runs inside ONE
 * Firestore transaction so it cannot be raced or bypassed. Lazy period resets
 * use Asia/Karachi day/month keys (no cron dependency). On a mutual like, a
 * match doc is created (deterministic id) and both users get an FCM push.
 *
 * Stack: Firebase Functions v2, Node 22, region asia-south1, Zod-validated.
 * Wire-up: export { travelMateSwipe } from './travelMate/swipe'; in index.ts
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';
const TZ = 'Asia/Karachi';
const KARACHI_OFFSET = '+05:00'; // Pakistan has no DST as of 2026

// ----- Input schema -----
const SwipeInput = z.object({
  targetUid: z.string().min(1).max(128),
  direction: z.enum(['like', 'pass']),
});

// ----- Asia/Karachi period keys (YYYY-MM-DD and YYYY-MM) -----
function periodKeys(now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const monthKey = dayKey.slice(0, 7);
  return { dayKey, monthKey };
}

// ----- Next reset instants (for the client's paywall countdown) -----
function nextDailyReset(dayKey: string): string {
  const todayMidnight = new Date(`${dayKey}T00:00:00${KARACHI_OFFSET}`);
  return new Date(todayMidnight.getTime() + 24 * 3600 * 1000).toISOString();
}
function nextMonthlyReset(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return new Date(`${next}-01T00:00:00${KARACHI_OFFSET}`).toISOString();
}

function matchIdFor(a: string, b: string): string {
  return [a, b].sort().join('_');
}

// ----- FCM: reads tokens from the users/{uid}/fcmTokens subcollection -----
// Tokens are stored by registerFcmToken callable as:
//   users/{uid}/fcmTokens/{token.slice(-20)} → { token, platform, updatedAt }
async function notifyMatch(uidA: string, uidB: string, matchId: string,
                           nameA: string, nameB: string) {
  const targets: Array<{ uid: string; otherName: string }> = [
    { uid: uidA, otherName: nameB },
    { uid: uidB, otherName: nameA },
  ];
  await Promise.all(targets.map(async ({ uid, otherName }) => {
    try {
      const tokensSnap = await db.collection(`users/${uid}/fcmTokens`).get();
      const tokens: string[] = tokensSnap.docs
        .map(d => (d.data() as { token: string }).token)
        .filter(Boolean);
      if (!tokens.length) return;
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: "It's a match! 🎉",
          body: `You and ${otherName} both want to travel together. Say hi!`,
        },
        data: { type: 'travelMate.match', matchId },
      });
    } catch (e) {
      console.error(`notifyMatch failed for ${uid}`, e);
    }
  }));
}

export const travelMateSwipe = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;

  const parsed = SwipeInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid swipe payload.');
  const { targetUid, direction } = parsed.data;
  if (targetUid === uid) throw new HttpsError('invalid-argument', 'You cannot swipe yourself.');

  const { dayKey, monthKey } = periodKeys();

  // Settings read outside the txn (rarely changes, reduces contention).
  const settingsSnap = await db.doc('config/travelMateSettings').get();
  const freeMonthlySwipes: number = settingsSnap.exists
    ? (settingsSnap.data()!.freeMonthlySwipes ?? 4) : 4;

  const swipeRef        = db.doc(`travelMateProfiles/${uid}/swipes/${targetUid}`);
  const reverseSwipeRef = db.doc(`travelMateProfiles/${targetUid}/swipes/${uid}`);
  const quotaRef        = db.doc(`travelMateQuota/${uid}`);
  const ownProfileRef   = db.doc(`travelMateProfiles/${uid}`);
  const targetProfRef   = db.doc(`travelMateProfiles/${targetUid}`);

  const result = await db.runTransaction(async (tx) => {
    // ---- READS first (Firestore transaction rule) ----
    const swipeSnap = await tx.get(swipeRef);
    if (swipeSnap.exists) {
      throw new HttpsError('already-exists', 'You already swiped this person.');
    }

    // ---- PASS: free, no quota, no match ----
    if (direction === 'pass') {
      tx.set(swipeRef, {
        from: uid, to: targetUid, direction: 'pass',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { matched: false as const, direction: 'pass' as const };
    }

    // ---- LIKE: validate target, then quota ----
    const [quotaSnap, reverseSnap, targetSnap] = await Promise.all([
      tx.get(quotaRef), tx.get(reverseSwipeRef), tx.get(targetProfRef),
    ]);
    if (!targetSnap.exists || targetSnap.data()!.active === false) {
      throw new HttpsError('failed-precondition', 'This profile is no longer available.');
    }

    const q = quotaSnap.exists ? quotaSnap.data()! : {};
    const subEndAt: admin.firestore.Timestamp | null = q.subscriptionEndAt ?? null;
    const subscribed = !!subEndAt && subEndAt.toMillis() > Date.now();

    let allowance: number;
    let used: number;
    const update: Record<string, unknown> = {
      uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (subscribed) {
      allowance = q.dailyAllowance ?? 0;
      used = (q.dailyKey === dayKey) ? (q.dailyUsed ?? 0) : 0; // lazy daily reset
      update.tier = 'subscribed';
    } else {
      allowance = freeMonthlySwipes;
      used = (q.freeMonthKey === monthKey) ? (q.freeUsed ?? 0) : 0; // lazy monthly reset
      update.tier = 'free';
      // If a stale subscription is still recorded, clear the subscribed marker.
      if (subEndAt && subEndAt.toMillis() <= Date.now()) {
        update.subscriptionEndAt = null;
        update.subscriptionId = null;
      }
    }

    const remaining = allowance - used;
    if (remaining <= 0) {
      throw new HttpsError('resource-exhausted', 'You are out of likes.', {
        tier: subscribed ? 'subscribed' : 'free',
        allowance,
        resetAt: subscribed ? nextDailyReset(dayKey) : nextMonthlyReset(monthKey),
      });
    }

    // ---- Did this complete a mutual like? ----
    const matched = reverseSnap.exists && reverseSnap.data()!.direction === 'like';
    let matchId: string | undefined;
    let ownName = '', targetName = '';

    if (matched) {
      matchId = matchIdFor(uid, targetUid);
      const [ownSnap, matchSnap] = await Promise.all([
        tx.get(ownProfileRef),
        tx.get(db.doc(`travelMateMatches/${matchId}`)),
      ]);
      const own = ownSnap.data() || {};
      const tgt = targetSnap.data() || {};
      ownName = own.displayName || 'Someone';
      targetName = tgt.displayName || 'Someone';

      // ---- WRITES ----
      if (!matchSnap.exists) {
        tx.set(db.doc(`travelMateMatches/${matchId}`), {
          users: [uid, targetUid].sort(),
          userInfo: {
            [uid]:       { displayName: ownName,    photoURL: own.photoURL ?? null },
            [targetUid]: { displayName: targetName, photoURL: tgt.photoURL ?? null },
          },
          status: 'active',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastMessageAt: null,
        });
      }
    }

    // Record the like + advance quota (single increment).
    tx.set(swipeRef, {
      from: uid, to: targetUid, direction: 'like',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (subscribed) {
      update.dailyKey = dayKey;
      update.dailyUsed = used + 1;
    } else {
      update.freeMonthKey = monthKey;
      update.freeUsed = used + 1;
    }
    tx.set(quotaRef, update, { merge: true });

    return {
      matched,
      matchId,
      remaining: remaining - 1,
      tier: subscribed ? ('subscribed' as const) : ('free' as const),
      _names: matched ? { ownName, targetName } : undefined,
    };
  });

  // ---- Post-commit side effects ----
  if (result.matched && result.matchId && result._names) {
    await notifyMatch(uid, targetUid, result.matchId,
      result._names.ownName, result._names.targetName);
  }

  // Strip internal fields before returning to the client.
  const { _names, ...clean } = result as { _names?: unknown; matched: boolean; matchId?: string; remaining?: number; tier?: string; direction?: string };
  return clean;
});
