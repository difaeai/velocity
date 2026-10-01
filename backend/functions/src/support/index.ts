/**
 * Velocity Rapid Response System — the complaint desk.
 *
 * One ticket, one problem, one owner. A ticket starts with the AI, is handed to
 * a person the instant the AI is out of its depth or the customer asks, and is
 * closed by whoever ended up owning it. Exactly the shape of a professional
 * support team, which is the point: first line answers in seconds, second line
 * answers properly.
 *
 * ── WHY EVERY WRITE IS A CALLABLE ───────────────────────────────────────────
 *
 * The old support chat let the app write messages straight into Firestore. It
 * worked, and it could not grow into this: a direct write cannot run the AI,
 * cannot notify the desk, cannot count turns toward an escalation, and cannot
 * stop a client from inventing a message "from" Velocity. The security rules
 * now deny all client writes under `supportTickets` and everything comes
 * through here. Reads stay direct, so a thread streams live without polling.
 *
 * ── THE ONE INVARIANT ───────────────────────────────────────────────────────
 *
 * A customer message is never left without a reply. The AI answers, or the AI
 * fails and the fallback answers while handing over, or the category is one the
 * AI must not touch and the written-out emergency acknowledgement answers. The
 * AI call therefore happens AFTER the customer's message is committed — so a
 * crash in the agent loses a reply, never the complaint.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { docId, invalid, requireAdmin, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';
import { buildSupportContext } from './context';
import { runSupportAgent, type SupportTurn } from './agent';
import {
  CATEGORY_LABELS,
  CATEGORY_PRIORITY,
  HUMAN_ONLY_CATEGORIES,
  MAX_AI_REPLIES,
  SUPPORT_CATEGORIES,
  asksForHuman,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from './types';

/** How long a ticket may sit in the human queue before the desk is nudged. */
const STALE_QUEUE_MINUTES = 30;

/** Messages a thread keeps in the model's view. Older turns are summarised out. */
const AGENT_CONTEXT_TURNS = 20;

const AGENT_NAME = 'Velocity Rapid Response';

function ticketRef(id: string) {
  return db.doc(`supportTickets/${id}`);
}

/** Append a message and roll the ticket's denormalised "last message" fields. */
function appendMessage(params: {
  ticketId: string;
  sender: 'user' | 'ai' | 'agent' | 'system';
  senderName: string;
  text: string;
  authorUid?: string | null;
}) {
  const { ticketId, sender, senderName, text, authorUid } = params;
  return db.collection(`supportTickets/${ticketId}/messages`).add({
    text,
    sender,
    senderName,
    authorUid: authorUid ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Post the agent's answer and move the ticket to wherever that answer leaves it.
 *
 * Shared by "open a ticket" and "send a message" so a first reply and a tenth
 * reply are handled by the same code — including the escalation bookkeeping,
 * which is the part that would have drifted if it were written twice.
 */
async function replyAndRoute(params: {
  ticketId: string;
  uid: string;
  category: SupportCategory;
  subject: string;
  turns: SupportTurn[];
  aiReplies: number;
  basePriority: SupportPriority;
}): Promise<{ status: SupportStatus; escalated: boolean }> {
  const { ticketId, uid, category, subject, turns, aiReplies, basePriority } = params;

  const { reply, context } = await runSupportAgent({ uid, category, subject, turns });

  // Out of turns is an escalation in its own right, whatever the model thought.
  const outOfTurns = aiReplies + 1 >= MAX_AI_REPLIES && !reply.resolved;
  const escalated = reply.needsHuman || outOfTurns;

  await appendMessage({
    ticketId,
    sender: 'ai',
    senderName: AGENT_NAME,
    text: reply.text,
  });

  const priority: SupportPriority = reply.priority ?? basePriority;
  const status: SupportStatus = escalated
    ? 'waiting_human'
    : reply.resolved
      ? 'resolved'
      : 'ai_handling';

  await ticketRef(ticketId).set(
    {
      status,
      handler: escalated ? 'human' : 'ai',
      priority,
      lastMessage: reply.text.slice(0, 300),
      lastSender: 'ai',
      lastAt: FieldValue.serverTimestamp(),
      aiReplies: FieldValue.increment(1),
      unreadForUser: FieldValue.increment(1),
      ...(escalated
        ? {
            escalatedAt: FieldValue.serverTimestamp(),
            escalationReason:
              reply.reason ?? (outOfTurns ? 'The assistant could not resolve it' : 'Needs a person'),
            // Whatever the AI was looking at when it gave up. The desk should
            // never have to reconstruct this by hand.
            aiContext: context.snapshot,
            deskNotifiedAt: null,
          }
        : {}),
      ...(status === 'resolved'
        ? { resolvedAt: FieldValue.serverTimestamp(), resolvedBy: 'ai' }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (escalated) await notifyDesk(ticketId, priority, subject);

  return { status, escalated };
}

/** Tell every admin a ticket is waiting. Never throws. */
async function notifyDesk(ticketId: string, priority: SupportPriority, subject: string): Promise<void> {
  try {
    const admins = await db.collection('users').where('role', '==', 'admin').limit(25).get();
    const title = priority === 'urgent' ? '🚨 Urgent support ticket' : '📨 Support ticket waiting';
    await Promise.all(
      admins.docs.map((a) =>
        sendToUser(a.id, title, `${subject.slice(0, 80)} — a customer is waiting for a person.`, {
          ticketId,
        }),
      ),
    );
    await ticketRef(ticketId).set({ deskNotifiedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (e) {
    logger.warn('support: could not notify the desk', { ticketId, error: (e as Error).message });
  }
}

// ── open a ticket ────────────────────────────────────────────────────────────

const openSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(3).max(2000),
  tripId: docId.optional(),
});

/**
 * The customer files a complaint. Returns as soon as the ticket exists.
 *
 * The AI reply is awaited rather than backgrounded: a Cloud Function that
 * returns before its own async work finishes has that work killed with the
 * instance, and "the assistant replied sometimes" is not a support system. The
 * customer's message is committed first, so the worst case is a ticket with no
 * reply yet — which the desk sweep below picks up.
 */
export const openSupportTicket = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = openSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Describe the problem.');
  const { category, subject, message, tripId } = parsed.data;

  await rateLimit(ctx.uid, 'openSupportTicket', 10, 3600);

  const context = await buildSupportContext(ctx.uid);
  const priority = CATEGORY_PRIORITY[category];
  const ref = db.collection('supportTickets').doc();

  await ref.set({
    id: ref.id,
    userId: ctx.uid,
    userName: context.snapshot.displayName,
    role: context.snapshot.role,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    subject,
    tripId: tripId ?? null,
    status: 'ai_handling' as SupportStatus,
    handler: HUMAN_ONLY_CATEGORIES.has(category) ? 'human' : 'ai',
    priority,
    assignedTo: null,
    aiReplies: 0,
    lastMessage: message.slice(0, 300),
    lastSender: 'user',
    lastAt: FieldValue.serverTimestamp(),
    unreadForUser: 0,
    unreadForDesk: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await appendMessage({
    ticketId: ref.id,
    sender: 'user',
    senderName: context.snapshot.displayName ?? 'Customer',
    text: message,
    authorUid: ctx.uid,
  });

  const outcome = await replyAndRoute({
    ticketId: ref.id,
    uid: ctx.uid,
    category,
    subject,
    turns: [{ sender: 'user', text: message }],
    aiReplies: 0,
    basePriority: priority,
  });

  logger.info('Support ticket opened', { ticketId: ref.id, category, status: outcome.status });
  return { ok: true, ticketId: ref.id, status: outcome.status, escalated: outcome.escalated };
});

// ── send a message on an existing ticket ─────────────────────────────────────

const sendSchema = z.object({
  ticketId: docId,
  text: z.string().trim().min(1).max(2000),
});

/** The customer writes again. Re-opens a resolved ticket rather than forking it. */
export const sendSupportMessage = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = sendSchema.safeParse(req.data);
  if (!parsed.success) invalid('Write a message first.');
  const { ticketId, text } = parsed.data;

  await rateLimit(ctx.uid, 'sendSupportMessage', 60, 3600);

  const ref = ticketRef(ticketId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Ticket not found.');
  if (snap.get('userId') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'This is not your ticket.');
  }

  const category = snap.get('category') as SupportCategory;
  const subject = (snap.get('subject') as string | undefined) ?? 'Support request';
  const status = snap.get('status') as SupportStatus;
  const assignedTo = (snap.get('assignedTo') as string | null | undefined) ?? null;
  const aiReplies = (snap.get('aiReplies') as number | undefined) ?? 0;
  const priority = (snap.get('priority') as SupportPriority | undefined) ?? 'normal';

  await appendMessage({
    ticketId,
    sender: 'user',
    senderName: (snap.get('userName') as string | undefined) ?? 'Customer',
    text,
    authorUid: ctx.uid,
  });
  await ref.set(
    {
      lastMessage: text.slice(0, 300),
      lastSender: 'user',
      lastAt: FieldValue.serverTimestamp(),
      unreadForDesk: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // A human owns it, or is about to: the AI stays out of the conversation. It
  // would be talking over a colleague, and the customer already asked not to
  // be handled by a machine.
  const humanOwns = status === 'waiting_human' || status === 'human_handling' || !!assignedTo;
  if (humanOwns) {
    if (asksForHuman(text) || status === 'waiting_human') {
      await notifyDesk(ticketId, priority, subject);
    }
    return { ok: true, status, handledBy: 'human' as const };
  }

  // Replay the thread for the agent.
  const msgs = await db
    .collection(`supportTickets/${ticketId}/messages`)
    .orderBy('createdAt', 'desc')
    .limit(AGENT_CONTEXT_TURNS)
    .get();
  const turns: SupportTurn[] = msgs.docs
    .reverse()
    .map((d) => ({
      sender: (d.get('sender') as SupportTurn['sender'] | undefined) ?? 'user',
      text: (d.get('text') as string | undefined) ?? '',
    }))
    .filter((t) => t.text);

  const outcome = await replyAndRoute({
    ticketId,
    uid: ctx.uid,
    category,
    subject,
    turns,
    aiReplies,
    basePriority: priority,
  });
  return { ok: true, status: outcome.status, handledBy: outcome.escalated ? 'human' : 'ai' };
});

// ── "get me a person" ────────────────────────────────────────────────────────

const humanSchema = z.object({ ticketId: docId, reason: z.string().trim().max(300).optional() });

/**
 * The explicit button. Same destination as typing "I want to talk to a human",
 * and it exists because a button cannot be misread, mis-spelled, or written in
 * a language the pattern list does not cover.
 */
export const requestHumanAgent = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = humanSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a ticketId.');
  const { ticketId, reason } = parsed.data;

  const ref = ticketRef(ticketId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Ticket not found.');
  if (snap.get('userId') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'This is not your ticket.');
  }
  if (snap.get('status') === 'human_handling') {
    return { ok: true, status: 'human_handling' as SupportStatus };
  }

  const priority = (snap.get('priority') as SupportPriority | undefined) ?? 'normal';
  await appendMessage({
    ticketId,
    sender: 'system',
    senderName: AGENT_NAME,
    text: 'Connecting you with the Velocity Rides team. A person will reply here shortly.',
  });
  await ref.set(
    {
      status: 'waiting_human' as SupportStatus,
      handler: 'human',
      escalatedAt: FieldValue.serverTimestamp(),
      escalationReason: reason ?? 'Customer asked for a human',
      lastMessage: 'Connecting you with the Velocity Rides team…',
      lastSender: 'system',
      lastAt: FieldValue.serverTimestamp(),
      unreadForDesk: FieldValue.increment(1),
      unreadForUser: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await notifyDesk(ticketId, priority, (snap.get('subject') as string | undefined) ?? 'Support request');

  logger.info('Support ticket escalated by customer', { ticketId });
  return { ok: true, status: 'waiting_human' as SupportStatus };
});

const readSchema = z.object({ ticketId: docId });

/** The customer opened the thread — clear their unread badge. */
export const markSupportTicketRead = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = readSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a ticketId.');

  const ref = ticketRef(parsed.data.ticketId);
  const snap = await ref.get();
  if (!snap.exists || snap.get('userId') !== ctx.uid) return { ok: true };
  await ref.set({ unreadForUser: 0 }, { merge: true });
  return { ok: true };
});

const rateSchema = z.object({ ticketId: docId, helpful: z.boolean() });

/** Was it actually sorted? The only honest measure of a first-line agent. */
export const rateSupportResolution = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = rateSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a ticketId and a verdict.');
  const { ticketId, helpful } = parsed.data;

  const ref = ticketRef(ticketId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Ticket not found.');
  if (snap.get('userId') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'This is not your ticket.');
  }

  await ref.set(
    {
      satisfaction: helpful ? 'good' : 'bad',
      ratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // "No, that didn't help" is a request for a person, not a star rating.
  if (!helpful && snap.get('status') !== 'human_handling') {
    await ref.set(
      {
        status: 'waiting_human' as SupportStatus,
        handler: 'human',
        escalatedAt: FieldValue.serverTimestamp(),
        escalationReason: 'Customer said the answer did not help',
        unreadForDesk: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await notifyDesk(
      ticketId,
      (snap.get('priority') as SupportPriority | undefined) ?? 'normal',
      (snap.get('subject') as string | undefined) ?? 'Support request',
    );
  }
  return { ok: true };
});

// ── the desk ─────────────────────────────────────────────────────────────────

const adminReplySchema = z.object({
  ticketId: docId,
  text: z.string().trim().min(1).max(4000),
  resolve: z.boolean().optional(),
});

/** A human answers. Takes ownership of the ticket in the same write. */
export const adminReplySupportTicket = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = adminReplySchema.safeParse(req.data);
  if (!parsed.success) invalid('Write a reply first.');
  const { ticketId, text, resolve } = parsed.data;

  const ref = ticketRef(ticketId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Ticket not found.');
  const userId = snap.get('userId') as string;

  const adminName =
    ((await db.doc(`users/${admin.uid}`).get()).get('displayName') as string | undefined) ??
    'Velocity Rides';

  await appendMessage({
    ticketId,
    sender: 'agent',
    senderName: adminName,
    text,
    authorUid: admin.uid,
  });
  await ref.set(
    {
      status: (resolve ? 'resolved' : 'human_handling') as SupportStatus,
      handler: 'human',
      assignedTo: admin.uid,
      assignedName: adminName,
      lastMessage: text.slice(0, 300),
      lastSender: 'agent',
      lastAt: FieldValue.serverTimestamp(),
      unreadForUser: FieldValue.increment(1),
      unreadForDesk: 0,
      ...(resolve ? { resolvedAt: FieldValue.serverTimestamp(), resolvedBy: admin.uid } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await sendToUser(userId, '💬 Velocity Rides replied', text.slice(0, 120), { ticketId });
  return { ok: true };
});

const adminStatusSchema = z.object({
  ticketId: docId,
  status: z.enum(['ai_handling', 'waiting_human', 'human_handling', 'resolved']),
  priority: z.enum(['normal', 'high', 'urgent']).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Claim, re-queue, re-prioritise or close a ticket. */
export const adminSetSupportTicketStatus = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = adminStatusSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a ticketId and a status.');
  const { ticketId, status, priority, note } = parsed.data;

  const ref = ticketRef(ticketId);
  if (!(await ref.get()).exists) invalid('Ticket not found.');

  await ref.set(
    {
      status,
      handler: status === 'ai_handling' ? 'ai' : 'human',
      assignedTo: status === 'human_handling' ? admin.uid : null,
      ...(priority ? { priority } : {}),
      ...(status === 'human_handling' ? { unreadForDesk: 0 } : {}),
      ...(status === 'resolved'
        ? { resolvedAt: FieldValue.serverTimestamp(), resolvedBy: admin.uid }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  if (note) {
    await appendMessage({
      ticketId,
      sender: 'system',
      senderName: 'Velocity Rides',
      text: note,
      authorUid: admin.uid,
    });
  }
  await db.collection('auditLogs').add({
    action: 'support.status',
    ticketId,
    status,
    by: admin.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * The safety net.
 *
 * Two things this catches that nothing else does: a ticket whose AI reply never
 * landed (the instance died between committing the message and posting the
 * answer), and a ticket that has been sitting in the human queue long enough
 * that whoever was notified has plainly missed it. Both end with the desk being
 * told again, because a complaint nobody answers is the only outcome this
 * system is built to make impossible.
 */
export const escalateStaleSupportTickets = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Karachi' },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - STALE_QUEUE_MINUTES * 60_000);

    // Waiting on a person for too long.
    const waiting = await db
      .collection('supportTickets')
      .where('status', '==', 'waiting_human')
      .where('lastAt', '<', cutoff)
      .limit(50)
      .get();

    // Last word was the customer's and nobody — not even the AI — answered.
    const unanswered = await db
      .collection('supportTickets')
      .where('lastSender', '==', 'user')
      .where('lastAt', '<', cutoff)
      .limit(50)
      .get();

    const seen = new Set<string>();
    let nudged = 0;
    for (const doc of [...waiting.docs, ...unanswered.docs]) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const status = doc.get('status') as SupportStatus | undefined;
      if (status === 'resolved') continue;

      // Don't re-nudge the same ticket every quarter of an hour for ever.
      const notified = doc.get('deskNotifiedAt') as Timestamp | undefined;
      if (notified && notified.toMillis() > cutoff.toMillis()) continue;

      await doc.ref.set(
        {
          status: 'waiting_human' as SupportStatus,
          handler: 'human',
          stale: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await notifyDesk(
        doc.id,
        (doc.get('priority') as SupportPriority | undefined) ?? 'normal',
        (doc.get('subject') as string | undefined) ?? 'Support request',
      );
      nudged += 1;
    }

    if (nudged > 0) logger.warn('support: tickets still waiting for a person', { nudged });
  },
);
