/**
 * In-ride chat between the passenger and the driver.
 *
 * The message itself was never the problem — the client wrote straight to
 * `trips/{tripId}/chat` and the other side's live listener picked it up the
 * moment the screen was open. The problem was every other moment. Nothing on
 * the server ever saw the write, so nothing ever pushed: a passenger could
 * message a driver who is watching the road, and the driver would find out only
 * by happening to open the chat.
 *
 * Sending goes through here now so the write and the push are one action. A
 * Firestore trigger would have caught direct writes too, but this codebase has
 * no triggers and their region has to line up with the database's, which is one
 * more thing to get wrong on a deploy; every other push in this project is sent
 * from a callable and this one is no different.
 *
 * The old direct-write path is deliberately still allowed by the rules. An app
 * built before this shipped keeps working — silently, as it always did — rather
 * than failing to send at all.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { sendToUser } from '../lib/fcm';
import { isWarmPing, warmUp } from '../lib/warmup';

const sendSchema = z.object({
  tripId: docId,
  text: z.string().trim().min(1).max(1000),
});

/** Trim a message down to something that reads well on a lock screen. */
function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}

export const sendTripMessage = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (isWarmPing(req.data)) return warmUp();
  const parsed = sendSchema.safeParse(req.data);
  if (!parsed.success) invalid('Write a message first.');
  const { tripId, text } = parsed.data;

  const [tripSnap, userSnap] = await Promise.all([
    db.doc(`trips/${tripId}`).get(),
    db.doc(`users/${ctx.uid}`).get(),
  ]);
  if (!tripSnap.exists) invalid('Trip not found.');

  const participants = tripParticipants(tripSnap);
  if (!participants.has(ctx.uid)) {
    throw new HttpsError('permission-denied', 'Not your ride.');
  }

  const senderName =
    (userSnap.get('displayName') as string | undefined) ??
    (userSnap.get('name') as string | undefined) ??
    'Rider';

  const recipients = await postTripMessage({ tripId, participants, senderId: ctx.uid, senderName, text });
  logger.info('Trip message sent', { tripId, recipients });
  return { ok: true };
});

/** Everyone in the car: the booker, the driver and — on a pool — every rider who shares it. */
export function tripParticipants(tripSnap: FirebaseFirestore.DocumentSnapshot): Set<string> {
  const passengerId = tripSnap.get('passengerId') as string | undefined;
  const driverId = tripSnap.get('driverId') as string | undefined;
  const members = (tripSnap.get('poolMembers') as string[] | undefined) ?? [];
  return new Set<string>([passengerId, driverId, ...members].filter((u): u is string => !!u));
}

/**
 * Write a message into a ride's chat and push everyone else on the ride.
 * Returns how many were pushed. The caller has checked the sender is on it.
 */
export async function postTripMessage(p: {
  tripId: string;
  participants: Set<string>;
  senderId: string;
  senderName: string;
  text: string;
}): Promise<number> {
  const { tripId, participants, senderId, senderName, text } = p;

  // The message and the trip's chat summary go up together. The summary is what
  // the rider's Messages inbox lists: without it, showing "you have 3 driver
  // conversations" would mean opening three subcollections to find out, and the
  // inbox would cost a read per ride the rider has ever taken.
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.collection(`trips/${tripId}/chat`).doc(), {
    senderId,
    senderName,
    text,
    sentAt: now,
  });
  batch.update(db.doc(`trips/${tripId}`), {
    chatLastMessage: preview(text),
    chatLastMessageAt: now,
    chatLastSenderId: senderId,
    chatLastSenderName: senderName,
  });
  await batch.commit();

  // Everyone on the ride except whoever just typed it.
  const recipients = [...participants].filter((uid) => uid !== senderId);
  await Promise.all(
    recipients.map((uid) =>
      sendToUser(uid, `💬 ${senderName}`, preview(text), {
        tripId,
        kind: 'trip_chat',
      }),
    ),
  );
  return recipients.length;
}
