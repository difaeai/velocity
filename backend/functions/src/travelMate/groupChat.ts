/**
 * Velocity — Travel Mate — Phase 5 group chat + private DMs (callable, v2)
 * ----------------------------------------------------------------------------
 * sendTravelMateGroupMessage — append a message to the group's joint chat,
 *                              bump lastMessageAt, push FCM to other members.
 * openTravelMateDirectChat   — from a group member's profile, open (or create)
 *                              a private 1:1 chat with them. Reuses the
 *                              travelMateMatches chat infrastructure so the
 *                              existing chat screen works unchanged.
 * previewTravelMateGroup     — resolve a group invite link for a non-member:
 *                              name, size, destination + whether the caller is
 *                              allowed to join (matched with a member).
 *
 * Identity wall: only travelMate* collections (+ read-only FCM token lookup).
 *
 * Wire-up:
 *   export { sendTravelMateGroupMessage, openTravelMateDirectChat, previewTravelMateGroup }
 *     from './travelMate/groupChat';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

function pairId(a: string, b: string): string { return [a, b].sort().join('_'); }

/** Best-effort push. Same token layout as social.ts. */
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

// ---------------------------------------------------------------------------
const GroupMsgInput = z.object({
  groupId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(2000),
});

export const sendTravelMateGroupMessage = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = GroupMsgInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid message.');
  const { groupId, text } = parsed.data;

  const groupRef = db.doc(`travelMateGroups/${groupId}`);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) throw new HttpsError('not-found', 'Group not found.');
  const group = groupSnap.data()!;
  const members: string[] = group.members ?? [];
  if (!members.includes(uid)) throw new HttpsError('permission-denied', 'Not your group.');

  const senderName: string = group.memberInfo?.[uid]?.displayName ?? 'Member';
  const senderPhoto: string | null = group.memberInfo?.[uid]?.photoURL ?? null;

  const msgRef = groupRef.collection('messages').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(msgRef, { senderId: uid, senderName, senderPhoto, type: 'text', text, createdAt: now });
  batch.update(groupRef, { lastMessage: text.substring(0, 100), lastMessageAt: now });
  await batch.commit();

  await Promise.all(
    members.filter((m) => m !== uid).map((m) =>
      pushTo(m, `${senderName} · ${group.name ?? 'Group'}`, text, {
        type: 'travelMate.groupMessage', groupId,
      }),
    ),
  );

  return { messageId: msgRef.id };
});

// ---------------------------------------------------------------------------
const DirectChatInput = z.object({
  targetUid: z.string().min(1).max(128),
  groupId: z.string().min(1).max(128),
});

export const openTravelMateDirectChat = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = DirectChatInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { targetUid, groupId } = parsed.data;
  if (targetUid === uid) throw new HttpsError('invalid-argument', 'You cannot chat with yourself.');

  const matchRef = db.doc(`travelMateMatches/${pairId(uid, targetUid)}`);
  const matchSnap = await matchRef.get();
  if (matchSnap.exists) {
    if ((matchSnap.data()!.status ?? 'active') !== 'active') {
      throw new HttpsError('failed-precondition', 'This conversation was closed.');
    }
    return { matchId: matchRef.id, created: false };
  }

  // Not matched yet — being in the same group grants a private chat.
  const groupSnap = await db.doc(`travelMateGroups/${groupId}`).get();
  if (!groupSnap.exists) throw new HttpsError('not-found', 'Group not found.');
  const members: string[] = groupSnap.data()!.members ?? [];
  if (!members.includes(uid) || !members.includes(targetUid)) {
    throw new HttpsError('permission-denied', 'You can only message members of your own group.');
  }

  const info = groupSnap.data()!.memberInfo ?? {};
  await matchRef.set({
    users: [uid, targetUid].sort(),
    userInfo: {
      [uid]: { displayName: info[uid]?.displayName ?? 'Member', photoURL: info[uid]?.photoURL ?? null },
      [targetUid]: { displayName: info[targetUid]?.displayName ?? 'Member', photoURL: info[targetUid]?.photoURL ?? null },
    },
    status: 'active',
    origin: 'group',
    groupId,
    matchedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessageAt: null,
  });

  return { matchId: matchRef.id, created: true };
});

// ---------------------------------------------------------------------------
const PreviewInput = z.object({ groupId: z.string().min(1).max(128) });

export const previewTravelMateGroup = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = PreviewInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const snap = await db.doc(`travelMateGroups/${parsed.data.groupId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'This group link is invalid.');
  const g = snap.data()!;
  const members: string[] = g.members ?? [];

  const alreadyMember = members.includes(uid);
  const hasProfile = (await db.doc(`travelMateProfiles/${uid}`).get()).exists;

  let matchedWithMember = false;
  if (!alreadyMember && hasProfile) {
    const checks = await Promise.all(members.map(async (m) => {
      const s = await db.doc(`travelMateMatches/${pairId(uid, m)}`).get();
      return s.exists && (s.data()!.status ?? 'active') === 'active';
    }));
    matchedWithMember = checks.some(Boolean);
  }

  return {
    group: {
      name: g.name ?? 'Commute group',
      destinationName: g.destinationName ?? '',
      schedule: g.schedule ?? null,
      memberCount: members.length,
      maxSize: g.maxSize ?? 4,
      status: g.status ?? 'open',
      memberNames: members.map((m) => g.memberInfo?.[m]?.displayName ?? 'Member'),
    },
    alreadyMember,
    canJoin: alreadyMember || (hasProfile && matchedWithMember && g.status === 'open' && members.length < (g.maxSize ?? 4)),
    reason: alreadyMember ? 'member' : !hasProfile ? 'no_profile' : !matchedWithMember ? 'not_partner' : 'ok',
  };
});
