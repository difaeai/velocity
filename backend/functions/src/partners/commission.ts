/**
 * Partner Program — crediting commission on a completed ride.
 * ----------------------------------------------------------------------------
 * Called from trips/completeTrip. Split in two halves because Firestore demands
 * all reads happen before any write in a transaction, and the fraud engine has
 * to run queries:
 *
 *   prepare()  — outside the transaction: load the referral edges, the rates,
 *                and decide whether the ride is genuine.
 *   apply(tx)  — inside the transaction: write-only, so the commission credit
 *                commits atomically with the ride's completion. A ride cannot
 *                complete without its commission, and a commission cannot exist
 *                without its ride.
 *
 * Money is credited to `pending`, not to the withdrawable balance. It matures
 * after the hold window (see wallet.ts). That delay is what makes fraud cheap to
 * reverse: a scam ride caught inside the window is clawed back out of money the
 * partner could not yet have withdrawn.
 * ----------------------------------------------------------------------------
 */
import type { Transaction } from 'firebase-admin/firestore';

import { db, FieldValue } from '../lib/firebase';
import { getPartnerSettings, ratesForTier, splitCommission } from './config';
import { assessRide } from './fraud';
import type { FraudAssessment } from './fraud';
import type { PartnerRideStatus, PartnerTier, PartnerTxnStatus } from './types';

interface ReferralEdge {
  uid: string;
  partnerId: string;
  fleetId: string;
  /** Free and Pro earn different rates. Read at settlement, so an upgrade
   * changes what the NEXT ride pays and never re-prices settled ones. */
  tier: PartnerTier;
}

export interface PartnerCreditPlan {
  driverEdge: ReferralEdge | null;
  passengerEdge: ReferralEdge | null;
  /** Already resolved for THIS edge's tier — the split does no tier lookup. */
  driverFleetRate: number;
  passengerFleetRate: number;
  holdHours: number;
  assessment: FraudAssessment;
}

/** No referrals on either side — the overwhelmingly common case, and free. */
const NO_PARTNERS: PartnerCreditPlan = {
  driverEdge: null,
  passengerEdge: null,
  driverFleetRate: 0,
  passengerFleetRate: 0,
  holdHours: 0,
  assessment: { status: 'completed', reason: null, kind: null },
};

async function loadEdge(path: string): Promise<ReferralEdge | null> {
  const snap = await db.doc(path).get();
  if (!snap.exists) return null;
  const partnerId = snap.get('partnerId') as string;
  // A suspended partner keeps their history but stops earning, so drop the edge
  // rather than crediting into an account that is not allowed to be paid.
  const partner = await db.doc(`partners/${partnerId}`).get();
  if (!partner.exists || partner.get('status') !== 'active') return null;
  return {
    uid: snap.get('uid') as string,
    partnerId,
    fleetId: snap.get('fleetId') as string,
    tier: ((partner.get('tier') as PartnerTier | undefined) ?? 'free'),
  };
}

export interface PrepareArgs {
  tripId: string;
  driverId: string;
  passengerId: string;
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  startedAt?: Date | null;
}

/** Run before the settlement transaction. Never throws — a failure here must
 * not block a driver from completing a ride they actually did. */
export async function preparePartnerCredit(args: PrepareArgs): Promise<PartnerCreditPlan> {
  try {
    const [driverEdge, passengerEdge] = await Promise.all([
      loadEdge(`driver_referrals/${args.driverId}`),
      loadEdge(`passenger_referrals/${args.passengerId}`),
    ]);
    if (!driverEdge && !passengerEdge) return NO_PARTNERS;

    const settings = await getPartnerSettings();
    const assessment = await assessRide({
      tripId: args.tripId,
      driverId: args.driverId,
      passengerId: args.passengerId,
      driverPartnerId: driverEdge?.partnerId ?? null,
      passengerPartnerId: passengerEdge?.partnerId ?? null,
      pickup: args.pickup ?? null,
      dropoff: args.dropoff ?? null,
      startedAt: args.startedAt ?? null,
      completedAt: new Date(),
    });

    // Each side is priced by ITS OWN partner's tier — a Pro driver-fleet owner
    // and a free passenger-fleet owner can both be paid on the same ride, at
    // different rates.
    return {
      driverEdge,
      passengerEdge,
      driverFleetRate: driverEdge ? ratesForTier(settings, driverEdge.tier).driverFleetRate : 0,
      passengerFleetRate: passengerEdge
        ? ratesForTier(settings, passengerEdge.tier).passengerFleetRate
        : 0,
      holdHours: settings.holdHours,
      assessment,
    };
  } catch {
    // Degrade to "no partner earnings on this ride" rather than failing the trip.
    return NO_PARTNERS;
  }
}

export interface ApplyArgs {
  tripId: string;
  driverId: string;
  passengerId: string;
  grossFare: number;
  /** Velocity's commission on this ride. The ONLY base a partner cut is taken from. */
  platformCommission: number;
  franchiseCut: number;
  paymentMethod: string;
}

export interface PartnerCreditResult {
  driverFleetCut: number;
  passengerFleetCut: number;
  /** Commission left for Velocity after the franchise and both partner cuts. */
  velocityNet: number;
  rideStatus: PartnerRideStatus;
}

/**
 * Write the credits. Call inside the settlement transaction, after all reads.
 *
 * A flagged ride still writes a transaction row — with a zero cut and its
 * verdict attached — because a partner who sees a ride disappear assumes a bug,
 * while a partner who sees it marked "scam — zero commission" understands the
 * rule they are being held to.
 */
export function applyPartnerCredit(
  tx: Transaction,
  plan: PartnerCreditPlan,
  args: ApplyArgs,
): PartnerCreditResult {
  const { driverEdge, passengerEdge, assessment } = plan;
  const genuine = assessment.status === 'completed';

  const split = splitCommission({
    platformCommission: args.platformCommission,
    franchiseCut: args.franchiseCut,
    // A flagged ride pays nobody: the rate is dropped to zero rather than the
    // cut being zeroed afterwards, so there is one place the rule lives.
    driverFleetRate: genuine && driverEdge ? plan.driverFleetRate : null,
    passengerFleetRate: genuine && passengerEdge ? plan.passengerFleetRate : null,
  });

  const maturesAt = new Date(Date.now() + plan.holdHours * 3_600_000);

  if (driverEdge) {
    creditFleet(tx, {
      edge: driverEdge,
      memberUid: args.driverId,
      counterparty: args.passengerId,
      cut: split.driverFleetCut,
      args,
      assessment,
      maturesAt,
      role: 'driver',
    });
  }
  if (passengerEdge) {
    creditFleet(tx, {
      edge: passengerEdge,
      memberUid: args.passengerId,
      counterparty: args.driverId,
      cut: split.passengerFleetCut,
      args,
      assessment,
      maturesAt,
      role: 'passenger',
    });
  }

  return {
    driverFleetCut: split.driverFleetCut,
    passengerFleetCut: split.passengerFleetCut,
    velocityNet: split.velocityNet,
    rideStatus: assessment.status,
  };
}

function creditFleet(
  tx: Transaction,
  p: {
    edge: ReferralEdge;
    memberUid: string;
    counterparty: string;
    cut: number;
    args: ApplyArgs;
    assessment: FraudAssessment;
    maturesAt: Date;
    role: 'driver' | 'passenger';
  },
) {
  const { edge, cut, args, assessment } = p;
  const genuine = assessment.status === 'completed';
  const now = FieldValue.serverTimestamp();

  // Immutable receipt. Keyed by trip+partner so a retried settlement can never
  // pay the same ride twice.
  const txnRef = db.doc(`partner_transactions/${args.tripId}_${edge.partnerId}`);
  const txnStatus: PartnerTxnStatus = !genuine || cut === 0 ? 'reversed' : 'pending';

  tx.set(txnRef, {
    id: txnRef.id,
    partnerId: edge.partnerId,
    fleetId: edge.fleetId,
    fleetType: p.role,
    // The tier this row was priced at. A partner who later upgrades can still
    // see why an old ride paid what it paid.
    tier: edge.tier,
    tripId: args.tripId,
    memberUid: p.memberUid,
    counterpartyUid: p.counterparty,
    rideFare: args.grossFare,
    platformCommission: args.platformCommission,
    fleetCommission: cut,
    rideStatus: assessment.status,
    fraudReason: assessment.reason,
    fraudKind: assessment.kind,
    paymentMethod: args.paymentMethod,
    status: txnStatus,
    maturesAt: genuine && cut > 0 ? p.maturesAt : null,
    createdAt: now,
  });

  // Per-member counters — what the fleet list shows for this driver/passenger.
  tx.set(
    db.doc(
      p.role === 'driver'
        ? `driver_referrals/${p.memberUid}`
        : `passenger_referrals/${p.memberUid}`,
    ),
    {
      completedRides: FieldValue.increment(genuine ? 1 : 0),
      flaggedRides: FieldValue.increment(genuine ? 0 : 1),
      totalRideValue: FieldValue.increment(genuine ? args.grossFare : 0),
      platformCommissionGenerated: FieldValue.increment(genuine ? args.platformCommission : 0),
      fleetCommissionGenerated: FieldValue.increment(cut),
      lastRideAt: now,
    },
    { merge: true },
  );

  tx.set(
    db.doc(`partner_fleets/${edge.fleetId}`),
    {
      completedRides: FieldValue.increment(genuine ? 1 : 0),
      lifetimeEarnings: FieldValue.increment(cut),
      updatedAt: now,
    },
    { merge: true },
  );

  tx.set(
    db.doc(`partners/${edge.partnerId}`),
    {
      completedRides: FieldValue.increment(genuine ? 1 : 0),
      flaggedRides: FieldValue.increment(genuine ? 0 : 1),
      lifetimeEarnings: FieldValue.increment(cut),
      updatedAt: now,
    },
    { merge: true },
  );

  if (cut > 0) {
    // Into `pending`, not `balance` — see the file header.
    tx.set(
      db.doc(`partner_wallets/${edge.partnerId}`),
      {
        pending: FieldValue.increment(cut),
        lifetimeEarnings: FieldValue.increment(cut),
        updatedAt: now,
      },
      { merge: true },
    );
  }
}
