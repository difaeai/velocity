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
import { requireAuth, invalid } from '../lib/guards';
import { sendToUser } from '../lib/fcm';

const sendSchema = z.object({
  tripId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(1000),
});

/** Trim a message down to something that reads well on a lock screen. */
function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}

export const sendTripMessage = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = sendSchema.safeParse(req.data);
  if (!parsed.success) invalid('Write a message first.');
  const { tripId, text } = parsed.data;

  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) invalid('Trip not found.');

  const passengerId = tripSnap.get('passengerId') as string | undefined;
  const driverId = tripSnap.get('driverId') as string | undefined;
  // Pool riders share the car and the conversation with it.
  const members = (tripSnap.get('poolMembers') as string[] | undefined) ?? [];
  const participants = new Set<string>(
    [passengerId, driverId, ...members].filter((u): u is string => !!u),
  );

  if (!participants.has(ctx.uid)) {
    throw new HttpsError('permission-denied', 'Not your ride.');
  }

  const userSnap = await db.doc(`users/${ctx.uid}`).get();
  const senderName =
    (userSnap.get('displayName') as string | undefined) ??
    (userSnap.get('name') as string | undefined) ??
    'Rider';

  await db.collection(`trips/${tripId}/chat`).add({
    senderId: ctx.uid,
    senderName,
    text,
    sentAt: FieldValue.serverTimestamp(),
  });

  // Everyone on the ride except whoever just typed it.
  const recipients = [...participants].filter((uid) => uid !== ctx.uid);
  await Promise.all(
    recipients.map((uid) =>
      sendToUser(uid, `💬 ${senderName}`, preview(text), {
        tripId,
        kind: 'trip_chat',
      }),
    ),
  );

  logger.info('Trip message sent', { tripId, recipients: recipients.length });
  return { ok: true };
});
