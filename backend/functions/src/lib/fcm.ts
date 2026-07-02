/**
 * FCM push notification helpers.
 *
 * Each user's FCM token is stored in `users/{uid}/fcmTokens/{tokenId}` as:
 *   { token: string, platform: 'ios' | 'android' | 'web', updatedAt: Timestamp }
 *
 * The mobile app is responsible for registering the token on launch via
 * the `registerFcmToken` callable.
 */
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';

import { db, FieldValue } from './firebase';

async function getTokensForUser(uid: string): Promise<string[]> {
  const snap = await db.collection(`users/${uid}/fcmTokens`).get();
  return snap.docs.map(d => d.get('token') as string).filter(Boolean);
}

export async function sendToUser(
  uid: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const tokens = await getTokensForUser(uid);
  if (tokens.length === 0) return;

  const msg: MulticastMessage = {
    tokens,
    notification: { title, body },
    data: data ?? {},
    android: { priority: 'high', notification: { sound: 'default' } },
    apns: { payload: { aps: { sound: 'default' } } },
  };

  try {
    const res = await getMessaging().sendEachForMulticast(msg);
    const failed = res.responses.filter(r => !r.success);
    if (failed.length > 0) {
      logger.warn('FCM: some tokens failed', { uid, failCount: failed.length });
    }
  } catch (err) {
    logger.error('FCM sendToUser error', { uid, err });
  }
}

export async function sendToUsers(
  uids: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  await Promise.all(uids.map(uid => sendToUser(uid, title, body, data)));
}

type NotifType = 'ride' | 'promo' | 'system' | 'wallet';

/**
 * Writes a notification to Firestore (notifications/{uid}/items) AND sends
 * an FCM push. The passenger notifications screen reads from this path.
 */
export async function notifyUser(
  uid: string,
  title: string,
  body: string,
  type: NotifType,
  data?: Record<string, string>,
): Promise<void> {
  await db.collection('notifications').doc(uid).collection('items').add({
    title,
    body,
    type,
    read:      false,
    timestamp: FieldValue.serverTimestamp(),
    ...(data ?? {}),
  });
  await sendToUser(uid, title, body, data);
}

/**
 * Sends a push + Firestore notification to all users matching a role filter.
 * Processes in batches of 500 to stay under Firestore batch limits.
 */
export async function broadcastNotification(
  title: string,
  body: string,
  type: NotifType,
  targetRole?: 'passenger' | 'driver' | 'all',
): Promise<number> {
  let q = db.collection('users').limit(2000);
  if (targetRole && targetRole !== 'all') {
    q = db.collection('users').where('role', '==', targetRole).limit(2000) as typeof q;
  }

  const usersSnap = await q.get();
  if (usersSnap.empty) return 0;

  const uids = usersSnap.docs.map(d => d.id);
  const now  = FieldValue.serverTimestamp();
  const CHUNK = 500;

  for (let i = 0; i < uids.length; i += CHUNK) {
    const chunk = uids.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const uid of chunk) {
      const ref = db.collection('notifications').doc(uid).collection('items').doc();
      batch.set(ref, { title, body, type, read: false, timestamp: now });
    }
    await batch.commit();
  }

  // Collect all FCM tokens and multicast
  const allTokens: string[] = [];
  await Promise.all(
    uids.map(async uid => {
      const snap = await db.collection(`users/${uid}/fcmTokens`).get();
      snap.docs.forEach(d => { const t = d.get('token') as string; if (t) allTokens.push(t); });
    }),
  );

  for (let i = 0; i < allTokens.length; i += 500) {
    const tokens = allTokens.slice(i, i + 500);
    if (tokens.length === 0) continue;
    const msg: MulticastMessage = {
      tokens,
      notification: { title, body },
      android: { priority: 'high', notification: { sound: 'default' } },
      apns:    { payload: { aps: { sound: 'default' } } },
    };
    await getMessaging().sendEachForMulticast(msg).catch(err =>
      logger.warn('broadcast FCM chunk failed', err),
    );
  }

  return uids.length;
}
