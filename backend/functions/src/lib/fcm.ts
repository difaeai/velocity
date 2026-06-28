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

import { db } from './firebase';

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
