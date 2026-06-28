/**
 * Velocity — Travel Mate — Phase 3 social functions (callable, v2)
 * ----------------------------------------------------------------------------
 * sendTravelMateMessage — append a chat message, bump lastMessageAt, push FCM.
 * unmatchTravelMate      — close a match (members can't do this via rules).
 * reportTravelMateUser   — file a moderation report, optionally auto-unmatch.
 *
 * Identity wall: these only ever read/write travelMate* collections (+ a
 * read-only FCM token lookup). They never touch trips or driver data.
 *
 * Wire-up:
 *   export { sendTravelMateMessage, unmatchTravelMate, reportTravelMateUser }
 *     from './travelMate/social';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

/** Best-effort push. Adjust token path to your FCM storage. */
async function pushTo(uid: string, title: string, body: string, data: Record<string, string>) {
  try {
    const tokensSnap = await db.collection(`users/${uid}/fcmTokens`).get();
    const tokens: string[] = tokensSnap.docs
      .map(d => (d.data() as { token: string }).token)
      .filter(Boolean);
    if (!tokens.length) return;
    await admin.messaging().sendEachForMulticast({ tokens, notification: { title, body }, data });
  } catch (e) { console.error('pushTo failed', uid, e); }
}

function otherUser(users: string[], me: string): string {
  return users.find((u) => u !== me)!;
}

// ---------------------------------------------------------------------------
const MsgInput = z.object({
  matchId: z.string().min(1).max(256),
  text: z.string().trim().min(1).max(2000),
});

export const sendTravelMateMessage = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = MsgInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid message.');
  const { matchId, text } = parsed.data;

  const matchRef = db.doc(`travelMateMatches/${matchId}`);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new HttpsError('not-found', 'Match not found.');
  const match = matchSnap.data()!;
  if (!match.users.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');
  if (match.status && match.status !== 'active') {
    throw new HttpsError('failed-precondition', 'This match is closed.');
  }

  const msgRef = matchRef.collection('messages').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(msgRef, { senderId: uid, text, createdAt: now });
  batch.update(matchRef, { lastMessageAt: now });
  await batch.commit();

  const recipient = otherUser(match.users, uid);
  const senderName = match.userInfo?.[uid]?.displayName || 'Your travel mate';
  await pushTo(recipient, senderName, text, { type: 'travelMate.message', matchId });

  return { messageId: msgRef.id };
});

// ---------------------------------------------------------------------------
const UnmatchInput = z.object({ matchId: z.string().min(1).max(256) });

export const unmatchTravelMate = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = UnmatchInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const matchRef = db.doc(`travelMateMatches/${parsed.data.matchId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Match not found.');
    if (!snap.data()!.users.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');
    tx.update(matchRef, {
      status: 'unmatched',
      unmatchedBy: uid,
      unmatchedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return { status: 'unmatched' };
});

// ---------------------------------------------------------------------------
const ReportInput = z.object({
  reportedUid: z.string().min(1).max(128),
  matchId: z.string().max(256).optional(),
  reason: z.string().trim().min(1).max(500),
});

export const reportTravelMateUser = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = ReportInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid report.');
  const { reportedUid, matchId, reason } = parsed.data;
  if (reportedUid === uid) throw new HttpsError('invalid-argument', 'You cannot report yourself.');

  const reportRef = db.collection('travelMateReports').doc();
  const batch = db.batch();
  batch.set(reportRef, {
    reporterId: uid,
    reportedUid,
    matchId: matchId ?? null,
    reason,
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Reporting auto-closes the match so the reporter stops seeing the person.
  if (matchId) {
    const matchRef = db.doc(`travelMateMatches/${matchId}`);
    batch.update(matchRef, {
      status: 'unmatched',
      unmatchedBy: uid,
      unmatchedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { reportId: reportRef.id, status: 'open' };
});
