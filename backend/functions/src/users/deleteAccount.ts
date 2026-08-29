/**
 * Self-service account deletion.
 *
 * App Store Review guideline 5.1.1(v) requires that an account created in the
 * app can be deleted from inside the app — a link to a web page is the single
 * most common rejection under that rule, and Play's Data Safety section asks
 * for the same thing. So this is the one privileged operation a user may
 * perform on themselves with no admin in the loop, and it has to be right the
 * first time: there is no undo.
 *
 * Three tiers of data, and the difference matters legally as much as technically:
 *
 *   PURGE      Personal data owned by this user alone — profile, wallet, CNIC
 *              images, Travel Partner posts, saved places. Gone.
 *
 *   ANONYMISE  Records that belong to somebody ELSE as much as to the deleted
 *              user: a driver's completed trips, the money ledger, safety
 *              reports. Deleting these would corrupt another person's history
 *              and destroy records we are expected to keep, so the row survives
 *              with every identifying field stripped. The uid stays as a bare
 *              key that no longer resolves to a human being.
 *
 *   BLOCK      Money in flight, in either direction. We do not silently
 *              confiscate a balance we owe, and we do not let an outstanding
 *              commission bill be deleted away. Each blocker names the amount
 *              and how to clear it.
 *
 * Ordering is deliberate: Firestore and Storage are purged BEFORE the Auth user
 * is deleted. A failure halfway through therefore leaves an account that can
 * still sign in and retry, rather than orphaned data belonging to a uid that no
 * longer exists and nobody can reach.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, storage, FieldValue } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { walletOutstanding } from '../domain/cancellation';
import { getCommissionSettings, commissionDue } from '../domain/commission';
import { ACTIVE_STATUSES } from '../trips';
import type { TripStatus } from '../domain/types';

/**
 * What the user must send to confirm. Checked server-side so a mis-wired button
 * can never delete an account on its own.
 */
export const CONFIRM_PHRASE = 'DELETE';

const schema = z.object({
  confirm: z.literal(CONFIRM_PHRASE),
});

/**
 * Docs keyed directly by uid. Deleted recursively, so subcollections go too —
 * users/{uid}/savedPlaces, users/{uid}/dailyRoutes, notifications/{uid}/items,
 * travelMateProfiles/{uid}/swipes.
 */
const OWNED_DOC_COLLECTIONS = [
  'users',
  'wallets',
  'drivers',
  'userPresence',
  'notifications',
  'travelMateProfiles',
  'travelMateQuota',
  'commuteSchedules',
  'driverRoutes',
  'cnicVerifications',
  'partners',
  'partner_wallets',
  'businessAdvertisers',
  'businessAdApplications',
] as const;

/**
 * Auto-id docs found by an owner field. Purged outright — none of these is a
 * record another user needs, and every one carries the deleted user's name,
 * photo or route history.
 */
const OWNED_QUERIES: ReadonlyArray<{
  collection: string;
  field: string;
  op?: 'array-contains';
}> = [
  { collection: 'openRequests', field: 'passengerId' },
  { collection: 'scheduledRides', field: 'uid' },
  { collection: 'paymentMethods', field: 'uid' },
  { collection: 'paymentMethodSetups', field: 'uid' },
  { collection: 'travelMatePosts', field: 'authorId' },
  { collection: 'travelMateSubscriptions', field: 'uid' },
  { collection: 'travelMateMatches', field: 'users', op: 'array-contains' },
  { collection: 'poolRides', field: 'driverId' },
  { collection: 'poolRideRequests', field: 'passengers', op: 'array-contains' },
  { collection: 'businessAds', field: 'ownerUid' },
];

/**
 * Records kept for the other party's sake, with the deleted user's identity
 * removed. The uid field itself is left alone — it is what ties a driver's
 * earnings to the trip that produced them, and once the account is gone it
 * names nobody.
 */
const ANONYMISE_QUERIES: ReadonlyArray<{ collection: string; field: string }> = [
  { collection: 'trips', field: 'passengerId' },
  { collection: 'trips', field: 'driverId' },
  { collection: 'transactions', field: 'driverId' },
  { collection: 'transactions', field: 'passengerId' },
  { collection: 'disputes', field: 'passengerId' },
  { collection: 'disputes', field: 'driverId' },
  { collection: 'safetyEvents', field: 'passengerId' },
  { collection: 'safetyEvents', field: 'driverId' },
  { collection: 'ratings', field: 'raterId' },
  { collection: 'requestReports', field: 'reportedBy' },
  { collection: 'courierOrders', field: 'passengerId' },
  { collection: 'freightRequests', field: 'passengerId' },
  { collection: 'intercityBookings', field: 'passengerId' },
  { collection: 'commissionSettlements', field: 'driverId' },
];

/**
 * Identity-bearing field names scrubbed from any anonymised doc that carries
 * them.
 *
 * Matching on field NAME rather than per-collection schemas is deliberate.
 * These documents are written by a dozen modules that each denormalise a
 * slightly different subset, and a hard-coded per-collection list would
 * silently miss the next one somebody adds. Route, fare and timestamp fields
 * are untouched: those are the record we are keeping.
 */
const PERSONAL_FIELDS = [
  'passengerName',
  'passengerPhone',
  'passengerPhotoURL',
  'driverName',
  'driverPhone',
  'driverPhotoURL',
  'raterName',
  'reporterName',
  'authorName',
  'authorPhotoURL',
  'displayName',
  'photoURL',
  'name',
  'phone',
  'phoneNumber',
  'email',
  'cnic',
  'senderName',
  'customerName',
  'contactPhone',
] as const;

/** Nested identity maps denormalised onto trip-like docs. */
const PERSONAL_MAP_FIELDS = ['driverInfo.displayName', 'driverInfo.photoURL'] as const;

/** Storage prefixes holding this user's uploads. */
function ownedStoragePrefixes(uid: string): string[] {
  return [
    `cnic/${uid}/`,
    `drivers/${uid}/`,
    `travelMateChat/${uid}/`,
    `travelMateFeedMedia/${uid}/`,
    `travelMateFeedVideos/${uid}/`,
    `businessAdMedia/${uid}/`,
    `businessAdPayments/${uid}/`,
    `partners/${uid}/`,
    `users/${uid}/`,
  ];
}

/**
 * Single files named for the uid rather than living under a folder.
 *
 * `settlements/{uid}/` is deliberately NOT here: those are bank-transfer proofs
 * attached to commission payments, which is exactly the financial record the
 * anonymise tier exists to preserve.
 */
function ownedStorageFiles(uid: string): string[] {
  return [`avatars/${uid}.jpg`, `travelMatePhotos/${uid}.jpg`];
}

/** What a stripped name becomes. */
const REDACTED = 'Deleted user';

/** Firestore caps a batch at 500 writes; 300 leaves room for the audit update. */
const PAGE = 300;

export interface DeletionState {
  /** Status of the trip the user's profile currently points at, if any. */
  activeTripStatus: TripStatus | null;
  /** Cancellation fees the user owes Velocity. */
  outstandingFees: number;
  /** Commission a driver owes Velocity. */
  commissionDue: number;
  /** Ride credit Velocity owes the user. */
  walletBalance: number;
  /** Partner-program earnings Velocity owes the user. */
  partnerBalance: number;
}

/**
 * The one decision worth testing on its own: may this account go?
 *
 * Returns the reason it may not, phrased for the person reading it on their
 * phone, or null when deletion may proceed. Money owed in EITHER direction
 * blocks — confiscating a balance would be theft, and letting a bill be deleted
 * would make "delete account" the cheapest way to skip a commission payment.
 */
export function describeDeletionBlocker(state: DeletionState): string | null {
  if (state.activeTripStatus && ACTIVE_STATUSES.has(state.activeTripStatus)) {
    return 'You have a ride in progress. Finish or cancel it before deleting your account.';
  }
  if (state.outstandingFees > 0) {
    return `You have PKR ${state.outstandingFees} in unpaid cancellation fees. Settle them before deleting your account.`;
  }
  if (state.commissionDue > 0) {
    return `You owe PKR ${state.commissionDue} in commission. Settle it before deleting your account.`;
  }
  if (state.walletBalance > 0) {
    return `Your wallet still holds PKR ${state.walletBalance}. Spend or withdraw it first — deleting your account does not refund it.`;
  }
  if (state.partnerBalance > 0) {
    return `You have PKR ${state.partnerBalance} in unpaid partner earnings. Withdraw them before deleting your account.`;
  }
  return null;
}

/** Reads everything the blocker check needs. */
async function loadDeletionState(uid: string): Promise<DeletionState> {
  const [userSnap, walletSnap, driverSnap, partnerWalletSnap, commission] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`wallets/${uid}`).get(),
    db.doc(`drivers/${uid}`).get(),
    db.doc(`partner_wallets/${uid}`).get(),
    getCommissionSettings(),
  ]);

  const activeTripId = userSnap.get('activeTripId') as string | undefined;
  let activeTripStatus: TripStatus | null = null;
  if (activeTripId) {
    const tripSnap = await db.doc(`trips/${activeTripId}`).get();
    activeTripStatus = tripSnap.exists ? ((tripSnap.get('status') as TripStatus) ?? null) : null;
  }

  return {
    activeTripStatus,
    outstandingFees: walletOutstanding(walletSnap),
    commissionDue: driverSnap.exists ? commissionDue(driverSnap, commission) : 0,
    walletBalance: Math.max(0, (walletSnap.get('balance') as number | undefined) ?? 0),
    partnerBalance: Math.max(0, (partnerWalletSnap.get('balance') as number | undefined) ?? 0),
  };
}

/**
 * Deletes every doc a query matches, a page at a time.
 *
 * Re-runs the same query rather than paging with a cursor: the previous page no
 * longer exists, so the next `get()` returns fresh matches and the loop ends
 * naturally when none are left.
 */
async function deleteQuery(
  collection: string,
  field: string,
  uid: string,
  op: 'array-contains' | '==',
): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await db.collection(collection).where(field, op, uid).limit(PAGE).get();
    if (snap.empty) return removed;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    removed += snap.size;
    if (snap.size < PAGE) return removed;
  }
}

/**
 * Strips identity fields from every doc a query matches.
 *
 * Only fields the doc actually carries are written, so an update can never
 * resurrect a field the schema never had — and a doc that has already been
 * scrubbed produces an empty patch and is skipped, which is what makes a retry
 * after a partial failure cheap. Paging uses a cursor here because, unlike the
 * delete path, the documents stay where they are.
 */
async function anonymiseQuery(collection: string, field: string, uid: string): Promise<number> {
  let scrubbed = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = db.collection(collection).where(field, '==', uid).limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) return scrubbed;

    const batch = db.batch();
    let writes = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const patch: Record<string, unknown> = {};

      for (const f of PERSONAL_FIELDS) {
        if (!(f in data) || data[f] === null) continue;
        // A name becomes a readable placeholder so the other party's history
        // still reads as a sentence; everything else simply goes.
        patch[f] = f.toLowerCase().includes('name') ? REDACTED : null;
      }

      for (const path of PERSONAL_MAP_FIELDS) {
        const [head, leaf] = path.split('.') as [string, string];
        const parent = data[head] as Record<string, unknown> | undefined;
        if (parent && parent[leaf] !== undefined && parent[leaf] !== null) {
          patch[path] = leaf.toLowerCase().includes('name') ? REDACTED : null;
        }
      }

      if (Object.keys(patch).length === 0) continue;
      patch.anonymisedAt = FieldValue.serverTimestamp();
      batch.update(doc.ref, patch);
      writes += 1;
    }

    if (writes > 0) await batch.commit();
    scrubbed += writes;

    cursor = snap.docs[snap.size - 1];
    if (snap.size < PAGE) return scrubbed;
  }
}

/**
 * Removes the user's uploads.
 *
 * Storage failures are logged but never fatal: a stranded image is a smaller
 * problem than an account that cannot be deleted, and the guideline we are
 * satisfying is about the account.
 */
async function purgeStorage(uid: string): Promise<void> {
  const bucket = storage.bucket();
  await Promise.all([
    ...ownedStoragePrefixes(uid).map((prefix) =>
      bucket.deleteFiles({ prefix }).catch((e: unknown) => {
        logger.warn('deleteMyAccount: storage prefix failed', { uid, prefix, error: String(e) });
      }),
    ),
    ...ownedStorageFiles(uid).map((path) =>
      bucket
        .file(path)
        .delete()
        .catch(() => undefined),
    ),
  ]);
}

/**
 * Deletes the caller's own account and everything it owns.
 *
 * Deliberately takes no uid: there is no shape of this request that lets one
 * user delete another. Admins have adminDeletePassenger for that, and it leaves
 * an audit trail naming the admin.
 */
export const deleteMyAccount = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = schema.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', `Confirm with "${CONFIRM_PHRASE}".`);
  }

  // Low ceiling: a legitimate user does this once, ever. Anything more is a bug
  // or an attack, and the operation is expensive and irreversible.
  await rateLimit(ctx.uid, 'deleteMyAccount', 3, 3600);

  const blocker = describeDeletionBlocker(await loadDeletionState(ctx.uid));
  if (blocker) throw new HttpsError('failed-precondition', blocker);

  // Written before anything is destroyed, so a purge that dies halfway still
  // leaves evidence that the user asked. Audit logs are a compliance record and
  // are deliberately not anonymised — the uid here names nobody once the
  // account is gone.
  const auditRef = db.collection('auditLogs').doc();
  await auditRef.set({
    type: 'account.selfDeleted',
    actor: ctx.uid,
    targetUid: ctx.uid,
    role: ctx.role,
    status: 'started',
    createdAt: FieldValue.serverTimestamp(),
  });

  let purged = 0;
  for (const { collection, field, op } of OWNED_QUERIES) {
    purged += await deleteQuery(collection, field, ctx.uid, op ?? '==');
  }

  let anonymised = 0;
  for (const { collection, field } of ANONYMISE_QUERIES) {
    anonymised += await anonymiseQuery(collection, field, ctx.uid);
  }

  // Recursive: takes users/{uid}/savedPlaces, notifications/{uid}/items and the
  // rest of the subcollections with it.
  for (const collection of OWNED_DOC_COLLECTIONS) {
    await db.recursiveDelete(db.doc(`${collection}/${ctx.uid}`));
  }

  await purgeStorage(ctx.uid);

  // Last, and only once the data is gone: while the Auth user exists the caller
  // can sign in and retry, so nothing that could still fail may come after it.
  await auth.deleteUser(ctx.uid);

  await auditRef.update({
    status: 'completed',
    docsPurged: purged,
    docsAnonymised: anonymised,
    completedAt: FieldValue.serverTimestamp(),
  });

  logger.info('deleteMyAccount', { uid: ctx.uid, purged, anonymised });
  return { ok: true };
});
