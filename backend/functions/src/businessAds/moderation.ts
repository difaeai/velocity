/**
 * "Find your Customers" — keeping Queries civil.
 * ----------------------------------------------------------------------------
 * A Queries conversation puts a stranger's words on a shopkeeper's phone and a
 * shopkeeper's words on a customer's phone. Both sides need a way out that does
 * not depend on the other being reasonable.
 *
 * BLOCK — per PAIR, not per thread
 * --------------------------------
 * `businessAdQueryBlocks/{ownerUid}_{askerUid}` holds who blocked whom. It is
 * per business × customer rather than per offer: blocking someone who keeps
 * writing about offer A must not let them start again on offer B.
 *
 *   byBusiness  the shop stopped this customer messaging it
 *   byCustomer  the customer stopped this shop messaging them — AND stops that
 *               shop's offers being pushed to them (checkNearbyBusinessAds). A
 *               customer who blocked a business does not want its promotions.
 *   byAdmin     Velocity closed the conversation after a report
 *
 * Every thread between the pair mirrors the three flags so the chat screen can
 * show the right state without reading a server-only doc.
 *
 * REPORT
 * ------
 * Either side can report. The report carries a snapshot of the last messages,
 * because the admin reviewing it must see what was actually said even if the
 * thread keeps moving. Reporting can block in the same step.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';

export type BlockSide = 'byBusiness' | 'byCustomer' | 'byAdmin';

export interface PairBlock {
  byBusiness: boolean;
  byCustomer: boolean;
  byAdmin: boolean;
}

const REPORT_REASONS = ['spam', 'abusive', 'scam', 'inappropriate', 'other'] as const;

export function blockId(ownerUid: string, askerUid: string): string {
  return `${ownerUid}_${askerUid}`;
}

export async function getPairBlock(ownerUid: string, askerUid: string): Promise<PairBlock> {
  const snap = await db.doc(`businessAdQueryBlocks/${blockId(ownerUid, askerUid)}`).get();
  return {
    byBusiness: snap.get('byBusiness') === true,
    byCustomer: snap.get('byCustomer') === true,
    byAdmin: snap.get('byAdmin') === true,
  };
}

/**
 * Throws the message the SENDER should read. Worded per side so a blocked person
 * learns only that they cannot write, never a detail about the other party.
 */
export function assertNotBlocked(block: PairBlock, sender: 'business' | 'customer'): void {
  if (block.byAdmin) invalid('This conversation was closed by Velocity Rides.');
  if (sender === 'customer') {
    if (block.byCustomer) invalid('You blocked this business. Unblock it to send a message.');
    if (block.byBusiness) invalid('You can’t send messages to this business.');
  } else {
    if (block.byBusiness) invalid('You blocked this customer. Unblock them to reply.');
    if (block.byCustomer) invalid('This customer is no longer accepting messages.');
  }
}

/** Sets one side's flag on the pair and mirrors it onto every thread between them. */
export async function setPairBlock(
  ownerUid: string,
  askerUid: string,
  side: BlockSide,
  blocked: boolean,
  actorUid: string,
): Promise<void> {
  await db.doc(`businessAdQueryBlocks/${blockId(ownerUid, askerUid)}`).set(
    {
      ownerUid,
      askerUid,
      [side]: blocked,
      [`${side}At`]: blocked ? FieldValue.serverTimestamp() : null,
      updatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const threads = await db
    .collection('businessAdQueries')
    .where('ownerUid', '==', ownerUid)
    .where('askerUid', '==', askerUid)
    .get();
  if (threads.empty) return;

  const flag = side === 'byBusiness' ? 'blockedByBusiness' : side === 'byCustomer' ? 'blockedByCustomer' : 'blockedByAdmin';
  const batch = db.batch();
  for (const t of threads.docs) batch.update(t.ref, { [flag]: blocked });
  await batch.commit();
}

/** Which side of a thread the caller is on, or a refusal if neither. */
async function threadForCaller(queryId: string, uid: string) {
  const snap = await db.doc(`businessAdQueries/${queryId}`).get();
  if (!snap.exists) invalid('That conversation no longer exists.');
  const ownerUid = snap.get('ownerUid') as string;
  const askerUid = snap.get('askerUid') as string;
  if (uid !== ownerUid && uid !== askerUid) invalid('That conversation belongs to someone else.');
  return { snap, ownerUid, askerUid, side: (uid === ownerUid ? 'business' : 'customer') as 'business' | 'customer' };
}

/** Block or unblock the other person in a conversation. Either side may. */
export const setBusinessAdQueryBlock = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await rateLimit(uid, 'businessAdQueryBlock', 30, 3600);
  const parsed = z
    .object({ queryId: z.string().min(1).max(260), blocked: z.boolean() })
    .safeParse(req.data);
  if (!parsed.success) invalid('Invalid request.');
  const { queryId, blocked } = parsed.data;

  const { ownerUid, askerUid, side } = await threadForCaller(queryId, uid);
  await setPairBlock(ownerUid, askerUid, side === 'business' ? 'byBusiness' : 'byCustomer', blocked, uid);

  logger.info('Business ad query block changed', { queryId, side, blocked });
  return { ok: true, blocked };
});

/** Report the other person. Optionally blocks them in the same step. */
export const reportBusinessAdQuery = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await rateLimit(uid, 'businessAdQueryReport', 10, 86_400);
  const parsed = z
    .object({
      queryId: z.string().min(1).max(260),
      reason: z.enum(REPORT_REASONS),
      note: z.string().trim().max(500).optional(),
      block: z.boolean().optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid report.');
  const { queryId, reason, note, block } = parsed.data;

  const { snap, ownerUid, askerUid, side } = await threadForCaller(queryId, uid);

  // What was said, frozen at the moment of the report.
  const recent = await snap.ref.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
  const messages = recent.docs
    .map((m) => ({
      from: m.get('from') as string,
      text: m.get('text') as string,
      atMs: (m.get('createdAt') as Timestamp | undefined)?.toMillis?.() ?? null,
    }))
    .reverse();

  const reportRef = db.collection('businessAdQueryReports').doc();
  await reportRef.set({
    reportId: reportRef.id,
    queryId,
    adId: snap.get('adId') ?? null,
    adTitle: snap.get('adTitle') ?? null,
    businessName: snap.get('businessName') ?? null,
    askerName: snap.get('askerName') ?? null,
    ownerUid,
    askerUid,
    reporterUid: uid,
    reporterSide: side,
    reportedUid: side === 'business' ? askerUid : ownerUid,
    reason,
    note: note ?? null,
    alsoBlocked: block === true,
    messages,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
  });
  await snap.ref.update({ reportCount: FieldValue.increment(1) });

  if (block) {
    await setPairBlock(ownerUid, askerUid, side === 'business' ? 'byBusiness' : 'byCustomer', true, uid);
  }

  logger.info('Business ad query reported', { queryId, side, reason, block: block === true });
  return { ok: true, reportId: reportRef.id };
});

/**
 * Admin: close a report. `dismiss` leaves the conversation as it is; `block`
 * closes it for both sides (byAdmin); `unblock` reopens one Velocity closed.
 */
export const adminResolveBusinessAdQueryReport = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = z
    .object({
      reportId: z.string().min(1).max(128),
      action: z.enum(['dismiss', 'block', 'unblock']),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) invalid('Invalid request.');
  const { reportId, action, note } = parsed.data;

  const ref = db.doc(`businessAdQueryReports/${reportId}`);
  const report = await ref.get();
  if (!report.exists) invalid('That report no longer exists.');
  const ownerUid = report.get('ownerUid') as string;
  const askerUid = report.get('askerUid') as string;

  if (action !== 'dismiss') {
    await setPairBlock(ownerUid, askerUid, 'byAdmin', action === 'block', admin.uid);
  }

  await ref.update({
    status: action === 'dismiss' ? 'dismissed' : 'actioned',
    resolution: action,
    resolutionNote: note ?? null,
    resolvedBy: admin.uid,
    resolvedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('auditLogs').add({
    type: `businessAd.query.${action}`,
    actor: admin.uid,
    targetUid: report.get('reportedUid') ?? null,
    reportId,
    queryId: report.get('queryId') ?? null,
    note: note ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

/** The businesses this customer has blocked — their offers are not pushed to them. */
export async function businessesBlockedByCustomer(uid: string): Promise<Set<string>> {
  const snap = await db
    .collection('businessAdQueryBlocks')
    .where('askerUid', '==', uid)
    .where('byCustomer', '==', true)
    .limit(200)
    .get();
  return new Set(snap.docs.map((d) => d.get('ownerUid') as string));
}
