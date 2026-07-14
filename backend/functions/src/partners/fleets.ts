/**
 * Partner Program — the referral code and the two fleets.
 *
 * A partner has ONE code, five digits, minted when an admin approves them. Both
 * of their fleets carry it, and which fleet a recruit lands in is decided by who
 * the recruit is, not by which code they typed: a driver redeeming 48213 joins
 * that partner's driver fleet, a passenger redeeming the same 48213 joins their
 * passenger fleet.
 *
 * One code rather than two is a deliberate simplification of what a partner has
 * to explain out loud. "Use my code, 48213" works on a poster, over a phone
 * call, and in a WhatsApp forward. Two codes means a partner eventually gives
 * somebody the wrong one, and the recruit lands in a fleet that earns nothing
 * for them because they are the wrong type for it.
 *
 * Both fleets are created at approval, not on demand — an approved partner who
 * has to press "create fleet" before their code works is a partner whose first
 * ten recruits bounced.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';

import { db, FieldValue } from '../lib/firebase';
import { invalid } from '../lib/guards';
import type { FleetType } from './types';

/** Normalizes whatever the user typed or pasted into the canonical code form. */
export function normalizeCode(raw: string): string {
  return raw.trim().replace(/\D/g, '');
}

/**
 * A five-digit code no other partner holds.
 *
 * 90,000 codes is small enough that collisions are real once the program has a
 * few thousand partners, so this checks and retries rather than trusting
 * randomness. Handing back a duplicate would silently merge two partners'
 * recruits into one fleet, which is unrecoverable once rides start settling.
 */
export async function mintPartnerCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = String(Math.floor(10000 + Math.random() * 90000));
    const clash = await db
      .collection('partners')
      .where('referralCode', '==', code)
      .limit(1)
      .get();
    if (clash.empty) return code;
  }
  throw new Error('Could not mint a unique referral code.');
}

/**
 * Create a partner's driver and passenger fleets, both carrying their code.
 * Called from the approval transaction, so it takes the batch/transaction.
 */
export function createFleetsForPartner(
  tx: Transaction,
  args: { partnerId: string; code: string; fullName: string },
): { driverFleetId: string; passengerFleetId: string } {
  const now = FieldValue.serverTimestamp();
  const driverRef = db.collection('partner_fleets').doc();
  const passengerRef = db.collection('partner_fleets').doc();

  const base = {
    partnerId: args.partnerId,
    code: args.code,
    members: 0,
    completedRides: 0,
    lifetimeEarnings: 0,
    createdAt: now,
    updatedAt: now,
  };

  tx.set(driverRef, {
    ...base,
    id: driverRef.id,
    type: 'driver' as FleetType,
    name: `${args.fullName} — Driver Fleet`,
  });
  tx.set(passengerRef, {
    ...base,
    id: passengerRef.id,
    type: 'passenger' as FleetType,
    name: `${args.fullName} — Passenger Fleet`,
  });

  return { driverFleetId: driverRef.id, passengerFleetId: passengerRef.id };
}

const previewSchema = z.object({ code: z.string().trim().min(4).max(10) });

/**
 * Public: what a recruit sees before they redeem a code — who invited them.
 * Deliberately returns no partner PII beyond a display name.
 */
export const previewPartnerFleet = onCall(async (req) => {
  const parsed = previewSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid referral code.');
  const code = normalizeCode(parsed.data.code);

  const snap = await db.collection('partners').where('referralCode', '==', code).limit(1).get();
  if (snap.empty) invalid('That referral code does not exist.');

  const partner = snap.docs[0];
  if (partner.get('status') !== 'active') {
    invalid('That referral code is no longer active.');
  }

  return {
    ok: true,
    code,
    partnerName: (partner.get('fullName') as string) ?? 'A Velocity partner',
    partnerLevel: (partner.get('level') as string) ?? 'bronze',
    partnerTier: (partner.get('tier') as string) ?? 'free',
  };
});
