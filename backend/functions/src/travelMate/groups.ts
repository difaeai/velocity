/**
 * Velocity — Travel Mate — Phase 4 groups + fare split (callable, v2)
 * ----------------------------------------------------------------------------
 * createTravelMateGroup — a matched user starts a 2–4 person commute group.
 * joinTravelMateGroup    — a user joins a group they're matched into.
 * settleTravelMateSplit  — after the group rides together on ONE normal trip,
 *                          divide the fare equally via wallet transfers between
 *                          the passengers. The driver is paid the full fare as
 *                          usual and sees nothing different — ZERO driver change.
 *
 * Wire-up:
 *   export { createTravelMateGroup, joinTravelMateGroup, settleTravelMateSplit }
 *     from './travelMate/groups';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';
const FARE_FIELD = 'fare'; // trip gross-fare field name

function matchId(a: string, b: string): string { return [a, b].sort().join('_'); }

async function areMatched(a: string, b: string): Promise<boolean> {
  const snap = await db.doc(`travelMateMatches/${matchId(a, b)}`).get();
  return snap.exists && (snap.data()!.status ?? 'active') === 'active';
}

// ---------------------------------------------------------------------------
const CreateInput = z.object({
  name: z.string().trim().max(80).optional(),
  destinationName: z.string().trim().max(120).optional(),
  schedule: z.object({
    days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).min(1),
    departTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }).optional(),
});

export const createTravelMateGroup = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = CreateInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid group data.');

  const profSnap = await db.doc(`travelMateProfiles/${uid}`).get();
  if (!profSnap.exists) throw new HttpsError('failed-precondition', 'Set up your profile first.');
  const prof = profSnap.data()!;

  const settings = (await db.doc('config/travelMateSettings').get()).data() || {};
  const maxSize: number = settings.maxGroupSize ?? 4;

  const ref = db.collection('travelMateGroups').doc();
  await ref.set({
    name: parsed.data.name ?? `${prof.destination?.name ?? 'Commute'} group`,
    createdBy: uid,
    members: [uid],
    memberInfo: { [uid]: { displayName: prof.displayName ?? 'Member', photoURL: prof.photoURL ?? null } },
    destinationName: parsed.data.destinationName ?? prof.destination?.name ?? '',
    schedule: parsed.data.schedule ?? prof.schedule ?? null,
    maxSize,
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { groupId: ref.id };
});

// ---------------------------------------------------------------------------
const JoinInput = z.object({ groupId: z.string().min(1).max(128) });

export const joinTravelMateGroup = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = JoinInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const groupRef = db.doc(`travelMateGroups/${parsed.data.groupId}`);

  const profSnap = await db.doc(`travelMateProfiles/${uid}`).get();
  if (!profSnap.exists) throw new HttpsError('failed-precondition', 'Set up your profile first.');
  const prof = profSnap.data()!;

  // Must be matched with at least one current member (mutual consent precondition).
  const preSnap = await groupRef.get();
  if (!preSnap.exists) throw new HttpsError('not-found', 'Group not found.');
  const members: string[] = preSnap.data()!.members ?? [];
  if (members.includes(uid)) return { joined: true, alreadyMember: true };
  const matchedChecks = await Promise.all(members.map((m) => areMatched(uid, m)));
  if (!matchedChecks.some(Boolean)) {
    throw new HttpsError('permission-denied', "You can only join a group you've matched into.");
  }

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Group not found.');
    const g = snap.data()!;
    const cur: string[] = g.members ?? [];
    if (cur.includes(uid)) return;
    if (cur.length >= (g.maxSize ?? 4)) throw new HttpsError('failed-precondition', 'Group is full.');
    if (g.status !== 'open') throw new HttpsError('failed-precondition', 'Group is not open.');
    tx.update(groupRef, {
      members: admin.firestore.FieldValue.arrayUnion(uid),
      [`memberInfo.${uid}`]: { displayName: prof.displayName ?? 'Member', photoURL: prof.photoURL ?? null },
    });
  });
  return { joined: true };
});

// ---------------------------------------------------------------------------
const SettleInput = z.object({
  groupId: z.string().min(1).max(128),
  tripId: z.string().min(1).max(128),
  riderUids: z.array(z.string().min(1)).min(2).max(4),
  amountPKR: z.number().positive().optional(),
});

export const settleTravelMateSplit = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const bookerUid = req.auth.uid;
  const parsed = SettleInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid settlement.');
  const { groupId, tripId, riderUids, amountPKR } = parsed.data;

  const riders = Array.from(new Set(riderUids));
  if (!riders.includes(bookerUid)) {
    throw new HttpsError('invalid-argument', 'Only the member who booked can settle.');
  }

  const groupRef = db.doc(`travelMateGroups/${groupId}`);
  const settlementRef = groupRef.collection('settlements').doc(tripId);
  const tripRef = db.doc(`trips/${tripId}`);

  const result = await db.runTransaction(async (tx) => {
    const [groupSnap, settledSnap, tripSnap] = await Promise.all([
      tx.get(groupRef), tx.get(settlementRef), tx.get(tripRef),
    ]);
    if (!groupSnap.exists) throw new HttpsError('not-found', 'Group not found.');
    if (settledSnap.exists) throw new HttpsError('already-exists', 'This trip is already settled.');

    const members: string[] = groupSnap.data()!.members ?? [];
    if (!riders.every((r) => members.includes(r))) {
      throw new HttpsError('invalid-argument', 'All riders must be group members.');
    }

    const tripData = tripSnap.exists ? tripSnap.data()! : null;
    const fare: number = (tripData && typeof tripData[FARE_FIELD] === 'number')
      ? tripData[FARE_FIELD]
      : (amountPKR ?? 0);
    if (fare <= 0) throw new HttpsError('failed-precondition', 'Could not determine the fare to split.');

    const n = riders.length;
    const share = Math.round(fare / n);
    const others = riders.filter((r) => r !== bookerUid);

    const walletRefs = new Map(others.map((u) => [u, db.doc(`wallets/${u}`)]));
    const walletSnaps = await Promise.all(others.map((u) => tx.get(walletRefs.get(u)!)));
    const balances = new Map<string, number>();
    others.forEach((u, i) => balances.set(u, walletSnaps[i].exists ? (walletSnaps[i].data()!.balance ?? 0) : 0));
    const short = others.filter((u) => (balances.get(u) ?? 0) < share);
    if (short.length) {
      throw new HttpsError('failed-precondition', 'A rider has insufficient wallet balance.', { short, share });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    let collected = 0;
    for (const u of others) {
      const wRef = walletRefs.get(u)!;
      tx.update(wRef, { balance: (balances.get(u) ?? 0) - share });
      tx.set(wRef.collection('transactions').doc(), {
        type: 'debit', amount: share, currency: 'PKR',
        reason: 'travelMate_fare_split', groupId, tripId, toUid: bookerUid, createdAt: now,
      });
      collected += share;
    }
    const bookerWallet = db.doc(`wallets/${bookerUid}`);
    const bSnap = await tx.get(bookerWallet);
    const bBal = bSnap.exists ? (bSnap.data()!.balance ?? 0) : 0;
    tx.update(bookerWallet, { balance: bBal + collected });
    tx.set(bookerWallet.collection('transactions').doc(), {
      type: 'credit', amount: collected, currency: 'PKR',
      reason: 'travelMate_fare_split_collected', groupId, tripId, fromRiders: others, createdAt: now,
    });

    tx.set(settlementRef, {
      tripId, groupId, bookerUid, riders, fare, share, collected, createdAt: now,
    });

    return { fare, share, riders: n, collected, bookerNetCost: fare - collected };
  });

  return { settled: true, ...result };
});
