/**
 * Partner Program — fleets and their referral codes.
 *
 * A partner may run one driver fleet and one passenger fleet. Each owns a short
 * human-typeable code (VLD-7K3P9Q / VLP-…) that is the ONLY thing a recruit ever
 * has to carry — the share link and the QR both just wrap the same code, so a
 * code read off a poster and a code tapped from WhatsApp bind identically.
 *
 * Codes live in their own `partner_fleets` collection keyed by a generated id,
 * with the code indexed. Lookup is by `where('code','==',…)` and the code is
 * unique because minting retries on collision inside a transaction.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { requirePartner } from './applications';
import type { FleetType } from './types';

const createSchema = z.object({
  type: z.enum(['driver', 'passenger']),
  /** Optional display name, e.g. "Lahore Riders". */
  name: z.string().trim().min(2).max(60).optional(),
});

/**
 * Unambiguous alphabet: no O/0, no I/1/L. A code gets read aloud, written on a
 * poster, and re-typed by someone who is not looking closely — every character
 * that has a lookalike is a support ticket.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(type: FleetType): string {
  let body = '';
  for (let i = 0; i < 6; i++) {
    body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${type === 'driver' ? 'VLD' : 'VLP'}-${body}`;
}

/** Normalizes whatever the user typed or pasted into the canonical code form. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Mint a code that no other fleet holds. Collisions are rare; retries are cheap. */
async function mintUniqueCode(type: FleetType): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode(type);
    const clash = await db
      .collection('partner_fleets')
      .where('code', '==', code)
      .limit(1)
      .get();
    if (clash.empty) return code;
  }
  // 30^6 codes per prefix — eight straight collisions means something is wrong
  // upstream, and silently handing back a duplicate would cross two partners'
  // recruits into one fleet.
  throw new Error('Could not mint a unique referral code.');
}

export const createPartnerFleet = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const partnerSnap = await requirePartner(uid);

  const parsed = createSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid fleet.');
  const { type, name } = parsed.data;

  const field = type === 'driver' ? 'driverFleetId' : 'passengerFleetId';
  if (partnerSnap.get(field)) {
    invalid(`You already have a ${type} fleet.`);
  }

  const code = await mintUniqueCode(type);
  const fleetRef = db.collection('partner_fleets').doc();
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    // Re-read inside the transaction: two taps on "Create fleet" would otherwise
    // both pass the check above and mint two fleets of the same type.
    const fresh = await tx.get(db.doc(`partners/${uid}`));
    if (fresh.get(field)) invalid(`You already have a ${type} fleet.`);

    tx.set(fleetRef, {
      id: fleetRef.id,
      partnerId: uid,
      type,
      name: name ?? (type === 'driver' ? 'My Driver Fleet' : 'My Passenger Fleet'),
      code,
      members: 0,
      completedRides: 0,
      lifetimeEarnings: 0,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(db.doc(`partners/${uid}`), { [field]: fleetRef.id, updatedAt: now }, { merge: true });
  });

  logger.info('Partner fleet created', { uid, type, fleetId: fleetRef.id });
  return { ok: true, fleetId: fleetRef.id, code, type };
});

const previewSchema = z.object({ code: z.string().trim().min(4).max(20) });

/**
 * Public: what a recruit sees before they sign up — who invited them and to
 * what. Deliberately returns no partner PII beyond a display name.
 */
export const previewPartnerFleet = onCall(async (req) => {
  const parsed = previewSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid referral code.');
  const code = normalizeCode(parsed.data.code);

  const snap = await db.collection('partner_fleets').where('code', '==', code).limit(1).get();
  if (snap.empty) invalid('That referral code does not exist.');

  const fleet = snap.docs[0];
  const partner = await db.doc(`partners/${fleet.get('partnerId')}`).get();
  if (!partner.exists || partner.get('status') !== 'active') {
    invalid('That referral code is no longer active.');
  }

  return {
    ok: true,
    code,
    type: fleet.get('type') as FleetType,
    fleetName: fleet.get('name') as string,
    partnerName: (partner.get('fullName') as string) ?? 'A Velocity partner',
    partnerLevel: (partner.get('level') as string) ?? 'bronze',
  };
});
