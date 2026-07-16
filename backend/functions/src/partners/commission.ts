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
import { getPartnerSettings, partnerCut, ratesForTier } from './config';
import { assessRide, logFraud } from './fraud';
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

/**
 * A pool ride carries riders beyond the primary passenger, and each may have
 * been recruited by a different partner. Each co-rider edge is priced on the
 * commission attributable to THEIR fare, not the whole ride's. An edge that
 * collides with the driver's partner is kept but pre-flagged, so the ride still
 * shows in that partner's history as scam rather than silently vanishing.
 */
interface CoRiderEdge {
  edge: ReferralEdge;
  rate: number;
  flagged: { reason: string } | null;
}

export interface PartnerCreditPlan {
  driverEdge: ReferralEdge | null;
  passengerEdge: ReferralEdge | null;
  coRiderEdges: CoRiderEdge[];
  /** Already resolved for THIS edge's tier — the split does no tier lookup. */
  driverFleetRate: number;
  passengerFleetRate: number;
  holdHours: number;
  assessment: FraudAssessment;
}

/**
 * The slice of a ride's commission attributable to one rider's fare. The fare
 * is clamped to the gross so corrupted pool data can skew one rider's share
 * but never claim more than the whole commission.
 */
function commissionShare(commission: number, fare: number, grossFare: number): number {
  if (!(grossFare > 0)) return 0;
  return Math.round((commission * Math.min(fare, grossFare)) / grossFare);
}

/** No referrals on either side — the overwhelmingly common case, and free. */
const NO_PARTNERS: PartnerCreditPlan = {
  driverEdge: null,
  passengerEdge: null,
  coRiderEdges: [],
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
  /** Pool rides only: the other riders aboard, beyond the primary passenger. */
  coRiderIds?: string[];
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  startedAt?: Date | null;
}

/** Run before the settlement transaction. Never throws — a failure here must
 * not block a driver from completing a ride they actually did. */
export async function preparePartnerCredit(args: PrepareArgs): Promise<PartnerCreditPlan> {
  try {
    const coRiderIds = args.coRiderIds ?? [];
    const [driverEdge, passengerEdge, ...coRiderRaw] = await Promise.all([
      loadEdge(`driver_referrals/${args.driverId}`),
      loadEdge(`passenger_referrals/${args.passengerId}`),
      ...coRiderIds.map((uid) => loadEdge(`passenger_referrals/${uid}`)),
    ]);
    if (!driverEdge && !passengerEdge && coRiderRaw.every((e) => !e)) return NO_PARTNERS;

    const settings = await getPartnerSettings();
    let assessment = await assessRide({
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

    // assessRide catches the driver's fleet owner riding as the PRIMARY
    // passenger; a pool lets them take any other seat instead — with or
    // without a referral edge of their own — and farm the driver-side cut on
    // a ride they staged. Same fraud, same verdict: the whole ride pays zero.
    if (
      assessment.status === 'completed' &&
      driverEdge &&
      coRiderIds.includes(driverEdge.partnerId)
    ) {
      const reason = 'The fleet owner was a rider on their own driver’s pool ride.';
      await logFraud({
        kind: 'collusion',
        partnerId: driverEdge.partnerId,
        subjectUid: args.driverId,
        detail: reason,
        tripId: args.tripId,
      });
      assessment = { status: 'scam', reason, kind: 'collusion' };
    }

    // Co-riders get the same collusion rules as the primary passenger: a partner
    // who owns both the driver and a rider can stage that seat, so it pays zero.
    // The edge stays in the plan pre-flagged, so the ride still appears in that
    // partner's history marked as scam.
    const coRiderEdges: CoRiderEdge[] = [];
    for (const edge of coRiderRaw) {
      if (!edge) continue;
      let flagged: { reason: string } | null = null;
      if (driverEdge && edge.partnerId === driverEdge.partnerId) {
        flagged = { reason: 'Driver and pool rider were both recruited by the same partner.' };
      } else if (edge.partnerId === args.driverId) {
        flagged = { reason: 'The fleet owner drove their own recruited pool rider.' };
      }
      if (flagged) {
        await logFraud({
          kind: 'collusion',
          partnerId: edge.partnerId,
          subjectUid: edge.uid,
          detail: flagged.reason,
          tripId: args.tripId,
        });
      }
      coRiderEdges.push({
        edge,
        rate: ratesForTier(settings, edge.tier).passengerFleetRate,
        flagged,
      });
    }

    // Each side is priced by ITS OWN partner's tier — a Pro driver-fleet owner
    // and a free passenger-fleet owner can both be paid on the same ride, at
    // different rates.
    return {
      driverEdge,
      passengerEdge,
      coRiderEdges,
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
  /** What the primary passenger personally paid. Defaults to the gross fare —
   * correct for solo rides; pool call sites pass the rider's own share. */
  passengerFare?: number;
  /** Pool rides: what each co-rider personally paid, keyed by uid. */
  coRiderFares?: Record<string, number>;
}

export interface PartnerCreditResult {
  driverFleetCut: number;
  /** All passenger-side cuts — the primary passenger's partner plus co-riders'. */
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
  const { driverEdge, passengerEdge, coRiderEdges, assessment } = plan;
  const genuine = assessment.status === 'completed';
  const commission = args.platformCommission;

  // Priority payout: franchise (already taken by the caller) → driver fleet →
  // each passenger-side fleet in order. Every cut is capped at what remains, so
  // Velocity's net can reach zero but never go below it. A flagged ride wants
  // zero everywhere — the rule lives here and nowhere else.
  let remaining = Math.max(0, commission - Math.max(0, args.franchiseCut));

  const maturesAt = new Date(Date.now() + plan.holdHours * 3_600_000);

  const driverWanted = genuine && driverEdge ? partnerCut(commission, plan.driverFleetRate) : 0;
  const driverFleetCut = Math.min(remaining, driverWanted);
  remaining -= driverFleetCut;
  if (driverEdge) {
    creditFleet(tx, {
      edge: driverEdge,
      memberUid: args.driverId,
      counterparty: args.passengerId,
      cut: driverFleetCut,
      rideFare: args.grossFare,
      args,
      assessment,
      maturesAt,
      role: 'driver',
    });
  }

  // A passenger-side partner earns on the commission attributable to the fare
  // THEIR recruit paid — on a solo ride that is the whole commission, on a pool
  // it is their rider's share of it.
  const primaryFare = args.passengerFare ?? args.grossFare;
  const primaryWanted =
    genuine && passengerEdge
      ? partnerCut(commissionShare(commission, primaryFare, args.grossFare), plan.passengerFleetRate)
      : 0;
  const primaryCut = Math.min(remaining, primaryWanted);
  remaining -= primaryCut;
  if (passengerEdge) {
    creditFleet(tx, {
      edge: passengerEdge,
      memberUid: args.passengerId,
      counterparty: args.driverId,
      cut: primaryCut,
      rideFare: primaryFare,
      args,
      assessment,
      maturesAt,
      role: 'passenger',
    });
  }

  let passengerFleetCut = primaryCut;
  for (const co of coRiderEdges) {
    const fare = args.coRiderFares?.[co.edge.uid] ?? 0;
    const wanted =
      genuine && !co.flagged && fare > 0
        ? partnerCut(commissionShare(commission, fare, args.grossFare), co.rate)
        : 0;
    const cut = Math.min(remaining, wanted);
    remaining -= cut;
    passengerFleetCut += cut;
    creditFleet(tx, {
      edge: co.edge,
      memberUid: co.edge.uid,
      counterparty: args.driverId,
      cut,
      rideFare: fare,
      args,
      // A collusion-flagged co-rider seat is a scam row for THAT partner even
      // when the ride as a whole is genuine for everyone else.
      assessment: co.flagged
        ? { status: 'scam', reason: co.flagged.reason, kind: 'collusion' }
        : assessment,
      maturesAt,
      role: 'passenger',
    });
  }

  return {
    driverFleetCut,
    passengerFleetCut,
    velocityNet: remaining,
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
    /** What this row's member personally paid — the gross for the driver row,
     * the rider's own share on a pool. */
    rideFare: number;
    args: ApplyArgs;
    assessment: FraudAssessment;
    maturesAt: Date;
    role: 'driver' | 'passenger';
  },
) {
  const { edge, cut, args, assessment } = p;
  const genuine = assessment.status === 'completed';
  const now = FieldValue.serverTimestamp();

  // Immutable receipt. Keyed by trip+member+role so a retried settlement can
  // never pay the same ride twice — and so one partner holding edges on both
  // sides of a ride (or behind two riders of a pool) gets one row per edge
  // instead of the rows silently overwriting each other.
  const txnRef = db.doc(`partner_transactions/${args.tripId}_${p.memberUid}_${p.role}`);
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
    rideFare: p.rideFare,
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
  // Valued at what THIS member paid or drove, so a pool rider's row never claims
  // the whole car's fare.
  tx.set(
    db.doc(
      p.role === 'driver'
        ? `driver_referrals/${p.memberUid}`
        : `passenger_referrals/${p.memberUid}`,
    ),
    {
      completedRides: FieldValue.increment(genuine ? 1 : 0),
      flaggedRides: FieldValue.increment(genuine ? 0 : 1),
      totalRideValue: FieldValue.increment(genuine ? p.rideFare : 0),
      platformCommissionGenerated: FieldValue.increment(
        genuine ? commissionShare(args.platformCommission, p.rideFare, args.grossFare) : 0,
      ),
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
