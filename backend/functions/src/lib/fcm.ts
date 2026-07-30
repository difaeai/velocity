/**
 * Push notification helpers.
 *
 * Each user's push token is stored in `users/{uid}/fcmTokens/{tokenId}` as:
 *   { token: string, kind?: 'expo' | 'fcm', platform: 'ios' | 'android' | 'web',
 *     updatedAt: Timestamp }
 *
 * TWO TRANSPORTS, ONE FUNCTION
 * ----------------------------
 * The app registers with `expo-notifications`, which can hand back either an
 * Expo push token (`ExponentPushToken[...]`) or the native device token (on
 * Android, the raw FCM registration token). These are NOT interchangeable: the
 * Firebase Admin SDK only understands the native one, and passing it an Expo
 * token fails per-token — which the old code logged as a warning and swallowed,
 * so nothing pushed and nothing looked broken.
 *
 * So the transport is chosen per token by its shape: Expo tokens go to Expo's
 * push service over HTTPS, native tokens go through the Admin SDK. Registering
 * both is fine and is what the app does — whichever one the platform actually
 * delivers on wins, and a duplicate arrival is not a thing that happens because
 * only one of the two is ever a working route for a given install.
 *
 * RICH NOTIFICATIONS
 * ------------------
 * `opts.imageUrl` puts a real picture in the tray notification — Android expands
 * it into a big-picture card when the shade is pulled down, even with the app
 * closed. Business offers rely on this: an offer without its picture is a line
 * of grey text, and the advertiser paid for the picture.
 */
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';

import { db, FieldValue } from './firebase';

/** Expo's push service. Accepts up to 100 messages per request. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** The Android channel the app creates on launch (see lib/notifications.ts). */
const ANDROID_CHANNEL = 'default';

export interface PushOptions {
  /**
   * Public https image URL shown in the expanded notification. Firebase and Expo
   * both fetch it on the device, so it must be readable without our auth.
   */
  imageUrl?: string;
}

type TokenKind = 'expo' | 'fcm';

interface StoredToken {
  token: string;
  kind: TokenKind;
}

/**
 * Expo tokens are self-describing. Trust the shape over the stored `kind`: a
 * token written before `kind` existed has no field to read, and a wrong stored
 * value would route a working token into the transport that cannot deliver it.
 */
export function tokenKind(token: string): TokenKind {
  return /^Expo(nent)?PushToken\[/.test(token) ? 'expo' : 'fcm';
}

async function getTokensForUser(uid: string): Promise<StoredToken[]> {
  const snap = await db.collection(`users/${uid}/fcmTokens`).get();
  return snap.docs
    .map((d) => d.get('token') as string)
    .filter(Boolean)
    .map((token) => ({ token, kind: tokenKind(token) }));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function sendViaFcm(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string>,
  opts: PushOptions,
): Promise<void> {
  for (const batch of chunk(tokens, 500)) {
    const msg: MulticastMessage = {
      tokens: batch,
      notification: {
        title,
        body,
        ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
      },
      data,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: ANDROID_CHANNEL,
          // Android collapses long bodies to one line unless the style says
          // otherwise; an image implies big-picture, text implies big-text.
          ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
        },
      },
      apns: {
        payload: { aps: { sound: 'default', 'mutable-content': opts.imageUrl ? 1 : 0 } },
        ...(opts.imageUrl ? { fcmOptions: { imageUrl: opts.imageUrl } } : {}),
      },
    };

    try {
      const res = await getMessaging().sendEachForMulticast(msg);
      const failed = res.responses.filter((r) => !r.success);
      if (failed.length > 0) {
        logger.warn('FCM: some tokens failed', {
          failCount: failed.length,
          firstError: failed[0]?.error?.message,
        });
      }
    } catch (err) {
      logger.error('FCM multicast error', { err });
    }
  }
}

async function sendViaExpo(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string>,
  opts: PushOptions,
): Promise<void> {
  for (const batch of chunk(tokens, 100)) {
    const messages = batch.map((to) => ({
      to,
      title,
      body,
      data,
      sound: 'default',
      priority: 'high',
      channelId: ANDROID_CHANNEL,
      // Expo's own name for the big-picture image.
      ...(opts.imageUrl ? { richContent: { image: opts.imageUrl } } : {}),
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        logger.warn('Expo push: HTTP error', { status: res.status });
        continue;
      }
      const json = (await res.json()) as { data?: { status: string; message?: string }[] };
      const errors = (json.data ?? []).filter((r) => r.status !== 'ok');
      if (errors.length > 0) {
        logger.warn('Expo push: some tokens failed', {
          failCount: errors.length,
          firstError: errors[0]?.message,
        });
      }
    } catch (err) {
      logger.error('Expo push error', { err });
    }
  }
}

async function deliver(
  tokens: StoredToken[],
  title: string,
  body: string,
  data: Record<string, string>,
  opts: PushOptions,
): Promise<void> {
  const fcm = tokens.filter((t) => t.kind === 'fcm').map((t) => t.token);
  const expo = tokens.filter((t) => t.kind === 'expo').map((t) => t.token);
  await Promise.all([
    fcm.length > 0 ? sendViaFcm(fcm, title, body, data, opts) : Promise.resolve(),
    expo.length > 0 ? sendViaExpo(expo, title, body, data, opts) : Promise.resolve(),
  ]);
}

export async function sendToUser(
  uid: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  opts: PushOptions = {},
): Promise<void> {
  const tokens = await getTokensForUser(uid);
  if (tokens.length === 0) return;
  await deliver(tokens, title, body, data ?? {}, opts);
}

export async function sendToUsers(
  uids: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
  opts: PushOptions = {},
): Promise<void> {
  await Promise.all(uids.map((uid) => sendToUser(uid, title, body, data, opts)));
}

type NotifType = 'ride' | 'promo' | 'system' | 'wallet';

/**
 * Writes a notification to Firestore (notifications/{uid}/items) AND sends a
 * push. The passenger notifications screen reads from this path — the image is
 * stored alongside so the in-app card can show the same picture as the tray.
 */
export async function notifyUser(
  uid: string,
  title: string,
  body: string,
  type: NotifType,
  data?: Record<string, string>,
  opts: PushOptions = {},
): Promise<void> {
  await db.collection('notifications').doc(uid).collection('items').add({
    title,
    body,
    type,
    read: false,
    timestamp: FieldValue.serverTimestamp(),
    ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
    ...(data ?? {}),
  });
  await sendToUser(uid, title, body, data, opts);
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
  opts: PushOptions = {},
): Promise<number> {
  let q = db.collection('users').limit(2000);
  if (targetRole && targetRole !== 'all') {
    q = db.collection('users').where('role', '==', targetRole).limit(2000) as typeof q;
  }

  const usersSnap = await q.get();
  if (usersSnap.empty) return 0;

  const uids = usersSnap.docs.map((d) => d.id);
  const now = FieldValue.serverTimestamp();
  const CHUNK = 500;

  for (const batchUids of chunk(uids, CHUNK)) {
    const batch = db.batch();
    for (const uid of batchUids) {
      const ref = db.collection('notifications').doc(uid).collection('items').doc();
      batch.set(ref, {
        title,
        body,
        type,
        read: false,
        timestamp: now,
        ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
      });
    }
    await batch.commit();
  }

  // Collect every token, then let deliver() route each to its own transport.
  const allTokens: StoredToken[] = [];
  await Promise.all(
    uids.map(async (uid) => {
      const snap = await db.collection(`users/${uid}/fcmTokens`).get();
      snap.docs.forEach((d) => {
        const t = d.get('token') as string;
        if (t) allTokens.push({ token: t, kind: tokenKind(t) });
      });
    }),
  );

  await deliver(allTokens, title, body, {}, opts);

  return uids.length;
}
