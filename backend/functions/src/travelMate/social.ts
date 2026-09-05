/**
 * Velocity — Travel Partner — Phase 3 social functions (callable, v2)
 * ----------------------------------------------------------------------------
 * sendTravelMateMessage — append a chat message, bump lastMessageAt, push FCM.
 *                          Enforces the message-request rule: someone you have
 *                          not matched with gets ONE opening message and then
 *                          waits for you to accept.
 * acceptTravelMateMessageRequest  — recipient opens the thread for both sides.
 * declineTravelMateMessageRequest — recipient wipes it; the sender can't retry.
 * unmatchTravelMate      — close a match (members can't do this via rules).
 * reportTravelMateUser   — file a moderation report, optionally auto-unmatch.
 *
 * Identity wall: these only ever read/write travelMate* collections (+ a
 * read-only FCM token lookup). They never touch trips or driver data.
 *
 * Wire-up: see index.ts — all six are exported from './travelMate/social'.
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

import { sendToUser } from '../lib/fcm';

import { assertNotBlocked } from './community';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

/** Best-effort push, over whichever transport this user's token needs. */
async function pushTo(uid: string, title: string, body: string, data: Record<string, string>) {
  // Routed through lib/fcm, NOT the Admin SDK directly. The app registers with
  // expo-notifications, which hands back an Expo token on some installs and a
  // native FCM token on others — and the Admin SDK cannot deliver to an Expo
  // token. Sending them all through sendEachForMulticast failed per token and
  // logged a warning nobody read, so every Travel Partner notification was
  // quietly going nowhere on those installs while the feature itself worked.
  // sendToUser picks the transport per token by its shape.
  await sendToUser(uid, title, body, data).catch((e) => {
    console.error('pushTo failed', uid, e);
  });
}

function otherUser(users: string[], me: string): string {
  return users.find((u) => u !== me)!;
}

// ---------------------------------------------------------------------------
// Chat messages can carry a text body and/or one attachment: a photo, a shared
// GPS location, a phone contact, or an arbitrary file/document. Attachment
// URLs must point at our own Firebase Storage bucket (the app uploads there
// under travelMateChat/{uid}/...), so a message can't smuggle an arbitrary
// external link.
const AttachmentPayload = z.object({
  url: z.string().url().max(2048),
  name: z.string().trim().max(240).nullish(),
  size: z.number().nonnegative().max(50 * 1024 * 1024).nullish(),
  mime: z.string().max(160).nullish(),
  width: z.number().positive().max(20000).nullish(),
  height: z.number().positive().max(20000).nullish(),
});
const LocationPayload = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  label: z.string().trim().max(240).nullish(),
});
const ContactPayload = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(60),
});

const MsgInput = z
  .object({
    matchId: z.string().min(1).max(256),
    text: z.string().trim().max(2000).nullish(),
    type: z.enum(['text', 'image', 'location', 'contact', 'file']).nullish(),
    image: AttachmentPayload.nullish(),
    file: AttachmentPayload.nullish(),
    location: LocationPayload.nullish(),
    contact: ContactPayload.nullish(),
  })
  .refine(
    (d) => Boolean((d.text && d.text.length > 0) || d.image || d.file || d.location || d.contact),
    { message: 'Message is empty.' },
  );

function isOwnStorageUrl(url: string): boolean {
  return (
    url.startsWith('https://firebasestorage.googleapis.com/') ||
    url.startsWith('https://storage.googleapis.com/')
  );
}

function previewFor(type: string, text?: string | null): string {
  switch (type) {
    case 'image':    return '📷 Photo';
    case 'location': return '📍 Location';
    case 'contact':  return '👤 Contact';
    case 'file':     return '📎 File';
    default:         return (text ?? '').slice(0, 100);
  }
}

export const sendTravelMateMessage = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = MsgInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid message.');
  const { matchId, text, image, file, location, contact } = parsed.data;

  // Reject attachment URLs that don't live in our own Storage bucket.
  for (const att of [image, file]) {
    if (att && !isOwnStorageUrl(att.url)) {
      throw new HttpsError('invalid-argument', 'Attachment must be uploaded to Velocity storage.');
    }
  }

  // Derive the message type from the payload so a stale/omitted `type` can't lie.
  const type: 'text' | 'image' | 'location' | 'contact' | 'file' =
    image ? 'image' : location ? 'location' : contact ? 'contact' : file ? 'file' : 'text';

  const matchRef = db.doc(`travelMateMatches/${matchId}`);
  const preRead = await matchRef.get();
  if (!preRead.exists) throw new HttpsError('not-found', 'Match not found.');
  const preMatch = preRead.data()!;
  if (!preMatch.users.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');
  // A block in either direction silently closes the channel. Done outside the
  // transaction: it reads a different collection and never changes mid-send.
  await assertNotBlocked(uid, otherUser(preMatch.users, uid));

  const trimmed = (text ?? '').trim();
  const msgRef = matchRef.collection('messages').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const msgDoc: Record<string, unknown> = { senderId: uid, type, createdAt: now };
  if (trimmed) msgDoc.text = trimmed;
  if (image) msgDoc.image = image;
  if (file) msgDoc.file = file;
  if (location) msgDoc.location = location;
  if (contact) msgDoc.contact = contact;

  const preview = previewFor(type, trimmed);

  // The whole send runs in a transaction because the pending-request rule ("the
  // requester gets exactly ONE message until it is accepted") is a check-then-
  // write: two sends fired at once would otherwise both see requestSent=false
  // and both go through.
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Match not found.');
    const match = snap.data()!;
    if (!match.users.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');
    if (match.status && match.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This conversation is closed.');
    }

    const update: Record<string, unknown> = {
      lastMessage: preview.slice(0, 100),
      lastMessageAt: now,
    };
    // Threads created before message requests existed have no requestStatus —
    // treat those as accepted so old chats keep working.
    const pending = match.requestStatus === 'pending';
    let isRequest = false;

    if (pending) {
      if (match.requestFrom === uid) {
        // The requester may send a single opening message and must then wait.
        if (match.requestSent) {
          throw new HttpsError(
            'failed-precondition',
            'Wait until they accept your message request before sending more.',
          );
        }
        update.requestSent = true;
        isRequest = true;
      } else {
        // The recipient replying IS an acceptance — same as tapping Accept.
        update.requestStatus = 'accepted';
        update.acceptedAt = now;
      }
    }

    tx.set(msgRef, msgDoc);
    tx.update(matchRef, update);
    return { isRequest };
  });

  const recipient = otherUser(preMatch.users, uid);
  const senderName = preMatch.userInfo?.[uid]?.displayName || 'Your travel mate';
  if (outcome.isRequest) {
    await pushTo(recipient, 'New message request 💬', `${senderName}: ${preview}`, {
      type: 'travelMate.messageRequest', matchId,
    });
  } else {
    await pushTo(recipient, senderName, preview, { type: 'travelMate.message', matchId });
  }

  return { messageId: msgRef.id };
});

// ---------------------------------------------------------------------------
// Message requests — accept / decline (Instagram-style inbox)
// ---------------------------------------------------------------------------
// Only the recipient of a pending request may answer it. Accepting opens the
// thread for both sides; declining wipes the messages and tombstones the doc as
// 'declined', so it disappears from every list and the sender cannot reopen it
// and try again.
const RequestInput = z.object({ matchId: z.string().min(1).max(256) });

/** The recipient's half of the guard shared by accept and decline. */
async function loadPendingRequest(uid: string, matchId: string) {
  const matchRef = db.doc(`travelMateMatches/${matchId}`);
  const snap = await matchRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Request not found.');
  const match = snap.data()!;
  if (!(match.users as string[]).includes(uid)) {
    throw new HttpsError('permission-denied', 'Not your conversation.');
  }
  if (match.requestStatus !== 'pending') {
    throw new HttpsError('failed-precondition', 'This is not a pending message request.');
  }
  if (match.requestTo !== uid) {
    throw new HttpsError('permission-denied', 'Only the recipient can answer a message request.');
  }
  return { matchRef, match };
}

export const acceptTravelMateMessageRequest = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = RequestInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const { matchRef, match } = await loadPendingRequest(uid, parsed.data.matchId);
  await matchRef.update({
    requestStatus: 'accepted',
    acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const requester = match.requestFrom as string;
  const myName = match.userInfo?.[uid]?.displayName || 'Your travel mate';
  await pushTo(requester, 'Request accepted 🎉', `${myName} accepted your message request. Say hi!`, {
    type: 'travelMate.message', matchId: parsed.data.matchId,
  });

  return { accepted: true };
});

export const declineTravelMateMessageRequest = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = RequestInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const { matchRef } = await loadPendingRequest(uid, parsed.data.matchId);

  // Delete the message(s) so the content is really gone, then tombstone the
  // thread. A request only ever holds one message, so a single batch is enough.
  const msgs = await matchRef.collection('messages').get();
  const batch = db.batch();
  msgs.docs.forEach((d) => batch.delete(d.ref));
  batch.update(matchRef, {
    status: 'declined',
    requestStatus: 'declined',
    declinedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessage: null,
  });
  await batch.commit();

  // The sender is not told — a silent decline is what stops it being a channel.
  return { declined: true };
});

// ---------------------------------------------------------------------------
// React to a chat message with a single emoji (WhatsApp-style). Reactions are
// stored as a map keyed by the reacting user's uid, so each user contributes at
// most one reaction and toggling the same emoji clears it. Messages are
// Cloud-Function-write-only, so reactions must come through here too.
const ReactInput = z.object({
  matchId: z.string().min(1).max(256),
  messageId: z.string().min(1).max(128),
  emoji: z.string().trim().max(16).nullish(), // null / empty clears the reaction
});

export const reactToTravelMateMessage = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = ReactInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid reaction.');
  const { matchId, messageId, emoji } = parsed.data;

  const matchRef = db.doc(`travelMateMatches/${matchId}`);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new HttpsError('not-found', 'Match not found.');
  const match = matchSnap.data()!;
  if (!match.users.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');
  if (match.status && match.status !== 'active') {
    throw new HttpsError('failed-precondition', 'This match is closed.');
  }

  const msgRef = matchRef.collection('messages').doc(messageId);
  const field = `reactions.${uid}`;
  const clear = !emoji;
  await msgRef.update({
    [field]: clear ? admin.firestore.FieldValue.delete() : emoji,
  });
  return { ok: true, cleared: clear };
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
  // Reporting auto-closes the match — but only if the reporter is actually in it.
  if (matchId) {
    const matchSnap = await db.doc(`travelMateMatches/${matchId}`).get();
    if (matchSnap.exists && (matchSnap.data()!.users as string[]).includes(uid)) {
      batch.update(db.doc(`travelMateMatches/${matchId}`), {
        status: 'unmatched',
        unmatchedBy: uid,
        unmatchedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
  await batch.commit();
  return { reportId: reportRef.id, status: 'open' };
});
