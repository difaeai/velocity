/**
 * "Find your Customers" — questions about an offer.
 * ----------------------------------------------------------------------------
 * Someone who got a business's offer can write to that business about it ("is
 * the deal on delivery too?"), and the business answers from its Find your
 * Customers screen. It is a conversation about ONE offer, so the thread is keyed
 * by offer and person: `businessAdQueries/{adId}_{askerUid}`. Asking again about
 * the same offer lands in the same thread instead of opening a second one.
 *
 * PRIVACY
 * -------
 * The business sees the asker's FIRST name and what they wrote — nothing else.
 * No phone number, no uid on screen, no location. Writing is a deliberate act so
 * a first name is fair; the impression ledger (who walked past the shop) stays
 * admin-only exactly as before.
 *
 * WRITES
 * ------
 * Everything goes through these callables, never the client, because every
 * message is also a push aimed at somebody else's phone. Rules only let the two
 * people in a thread (and admins) read it.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { notifyUser } from '../lib/fcm';
import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { firstNameOf } from '../trips/poolRoster';
import { pkDay } from './config';
import { assertNotBlocked, getPairBlock } from './moderation';

const TEXT_MAX = 500;

const textSchema = z.string().trim().min(1, 'Write a message first.').max(TEXT_MAX);

const askSchema = z.object({ adId: z.string().min(1).max(128), text: textSchema });
const replySchema = z.object({ queryId: z.string().min(1).max(260), text: textSchema });
const readSchema = z.object({ queryId: z.string().min(1).max(260) });

export function queryId(adId: string, askerUid: string): string {
  return `${adId}_${askerUid}`;
}

const preview = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}…` : text);

/** Customer → business. Opens the thread the first time, appends after that. */
export const sendBusinessAdQuery = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await rateLimit(uid, 'businessAdQuery', 20, 3600);

  const parsed = askSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid message.');
  const { adId, text } = parsed.data;

  const adRef = db.doc(`businessAds/${adId}`);
  const [ad, userSnap] = await Promise.all([adRef.get(), db.doc(`users/${uid}`).get()]);
  if (!ad.exists || ad.get('status') === 'removed') invalid('This offer has ended.');

  const ownerUid = ad.get('ownerUid') as string;
  if (ownerUid === uid) invalid('This is your own offer.');
  assertNotBlocked(await getPairBlock(ownerUid, uid), 'customer');

  const id = queryId(adId, uid);
  const threadRef = db.doc(`businessAdQueries/${id}`);
  const msgRef = threadRef.collection('messages').doc();
  const askerName = firstNameOf(userSnap.get('name'), 'Customer');
  const now = FieldValue.serverTimestamp();

  // Decided inside the transaction so two first messages sent together still
  // count as one new query on the advertiser's numbers.
  const isNew = await db.runTransaction(async (tx) => {
    const thread = await tx.get(threadRef);
    const fresh = !thread.exists;
    tx.set(
      threadRef,
      {
        queryId: id,
        adId,
        ownerUid,
        askerUid: uid,
        askerName,
        // Denormalised so the business's list renders without reading every ad.
        adTitle: ad.get('title') as string,
        businessName: ad.get('businessName') as string,
        adImageUrl: (ad.get('imageUrl') as string | undefined) ?? null,
        lastMessage: preview(text),
        lastFrom: 'customer',
        lastMessageAt: now,
        status: 'waiting',
        ownerUnread: FieldValue.increment(1),
        askerUnread: 0,
        messageCount: FieldValue.increment(1),
        ...(fresh ? { createdAt: now } : {}),
      },
      { merge: true },
    );
    tx.set(msgRef, { from: 'customer', senderUid: uid, text, createdAt: now });
    return fresh;
  });

  if (isNew) {
    await adRef.update({ queries: FieldValue.increment(1) });
    await db
      .doc(`businessAds/${adId}/daily/${pkDay()}`)
      .set({ queries: FieldValue.increment(1) }, { merge: true });
  }

  await notifyUser(
    ownerUid,
    `New question about “${ad.get('title') as string}”`,
    `${askerName}: ${preview(text)}`,
    'system',
    { screen: 'business-query', queryId: id },
  ).catch((e) => logger.warn('Query push to business failed', { id, error: String(e) }));

  logger.info('Business ad query sent', { id, isNew });
  return { ok: true, queryId: id, isNew };
});

/** Business → customer. Only the offer's owner may answer. */
export const replyBusinessAdQuery = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await rateLimit(uid, 'businessAdQueryReply', 120, 3600);

  const parsed = replySchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid message.');
  const { queryId: id, text } = parsed.data;

  const threadRef = db.doc(`businessAdQueries/${id}`);
  const thread = await threadRef.get();
  if (!thread.exists) invalid('That conversation no longer exists.');
  if (thread.get('ownerUid') !== uid) invalid('That question was sent to another business.');
  assertNotBlocked(await getPairBlock(uid, thread.get('askerUid') as string), 'business');

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(threadRef.collection('messages').doc(), {
    from: 'business',
    senderUid: uid,
    text,
    createdAt: now,
  });
  batch.update(threadRef, {
    lastMessage: preview(text),
    lastFrom: 'business',
    lastMessageAt: now,
    status: 'answered',
    // Replying means the business has read everything above it.
    ownerUnread: 0,
    askerUnread: FieldValue.increment(1),
    messageCount: FieldValue.increment(1),
  });
  await batch.commit();

  const businessName = thread.get('businessName') as string;
  await notifyUser(
    thread.get('askerUid') as string,
    `${businessName} replied`,
    preview(text),
    'promo',
    { screen: 'business-query', queryId: id },
  ).catch((e) => logger.warn('Query reply push failed', { id, error: String(e) }));

  return { ok: true };
});

/** Clears the unread count on the caller's side of the thread. */
export const markBusinessAdQueryRead = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = readSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid conversation.');

  const threadRef = db.doc(`businessAdQueries/${parsed.data.queryId}`);
  const thread = await threadRef.get();
  if (!thread.exists) return { ok: true };

  if (thread.get('ownerUid') === uid) {
    if ((thread.get('ownerUnread') as number | undefined) ?? 0) await threadRef.update({ ownerUnread: 0 });
  } else if (thread.get('askerUid') === uid) {
    if ((thread.get('askerUnread') as number | undefined) ?? 0) await threadRef.update({ askerUnread: 0 });
  } else {
    invalid('That conversation belongs to someone else.');
  }
  return { ok: true };
});
