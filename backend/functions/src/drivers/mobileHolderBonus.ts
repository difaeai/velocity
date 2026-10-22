/**
 * PKR 2,000 of bonus for a mobile holder — once, for every driver.
 *
 * The offer: fit a mobile holder in the car, and the commission on your rides
 * comes off these 2,000 instead of out of your pocket until they are used up.
 * It is ordinary `commissionCredit`, so the code that already spends a bonus
 * spends this one (domain/commission.ts, drivers/cycle.ts), the app already
 * shows it on the home screen as "Your bonus", and like every bonus it can
 * never be withdrawn.
 *
 * WHY A SWEEP AND NOT A HOOK ON APPROVAL. An account becomes a driving account
 * along several roads (the verification engine, an admin's approval, an
 * admin-created driver, a franchise sign-up), and every driver approved before
 * this shipped needs it too. One pass over the approved fleet covers all of
 * them, and a road added later cannot leave anybody out. Commission only falls
 * due when a day closes, so the hour between runs costs a new driver nothing —
 * at worst a few minutes of lock just after midnight, which lifts by itself the
 * moment the bonus lands, because the lock is worked out net of the bonus.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import { sendToUser } from '../lib/fcm';
import { commissionCredit } from '../domain/commission';

export const MOBILE_HOLDER_BONUS = 2000;

/** Grants per run. Whoever is left over is picked up by the next run. */
const MAX_GRANTS_PER_RUN = 500;

/**
 * Give one driver the bonus unless they have had it. True when it was granted.
 *
 * `mobileHolderBonusAt` is the once-ever guard, read in the same transaction
 * that writes it. Drivers cannot write that field (the firestore.rules
 * allowlist), so nobody can clear it to be paid twice.
 *
 * shortcut: once per account, not per person — a driver who deletes their
 * account and is approved again under a new one gets it again; key the guard
 * on a CNIC hash if that ever shows up in the audit log.
 */
export async function grantMobileHolderBonus(driverId: string): Promise<boolean> {
  const driverRef = db.doc(`drivers/${driverId}`);
  const granted = await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists || snap.get('mobileHolderBonusAt')) return false;

    tx.set(
      driverRef,
      {
        commissionCredit: commissionCredit(snap) + MOBILE_HOLDER_BONUS,
        commissionCreditEarned: FieldValue.increment(MOBILE_HOLDER_BONUS),
        mobileHolderBonusAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // An admin grant because the app already on drivers' phones labels that
    // type ("Bonus added by Velocity Rides"); a new type would show there with
    // no title until the next release.
    tx.set(driverRef.collection('commissionCredits').doc(), {
      type: 'admin_grant',
      amount: MOBILE_HOLDER_BONUS,
      reason: 'For a mobile holder in your car',
      by: 'system',
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('auditLogs').doc(), {
      action: 'commissionCredit.granted',
      driverId,
      amount: MOBILE_HOLDER_BONUS,
      reason: 'mobile_holder',
      by: 'system',
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!granted) return false;

  try {
    await sendToUser(
      driverId,
      `🎁 PKR ${MOBILE_HOLDER_BONUS.toLocaleString()} for a mobile holder`,
      `Fit a mobile holder in your car. Commission on your rides now comes off this ` +
        `PKR ${MOBILE_HOLDER_BONUS.toLocaleString()} bonus, so you pay Velocity Rides nothing until it is used up.`,
    );
  } catch (e) {
    // The bonus is in; only the announcement failed. The home screen shows it.
    logger.warn('mobileHolderBonus: push failed', { driverId, error: (e as Error).message });
  }
  return true;
}

export const grantMobileHolderBonuses = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Asia/Karachi', timeoutSeconds: 540 },
  async () => {
    // shortcut: reads every approved driver each run (one read each); move to
    // an approvedAt cursor if the fleet grows into the tens of thousands.
    const snap = await db
      .collection('drivers')
      .where('verificationStatus', '==', 'approved')
      .select('mobileHolderBonusAt')
      .get();

    let granted = 0;
    for (const driver of snap.docs) {
      if (granted >= MAX_GRANTS_PER_RUN) break;
      if (driver.get('mobileHolderBonusAt')) continue;
      try {
        if (await grantMobileHolderBonus(driver.id)) granted += 1;
      } catch (e) {
        // One bad document must not hold up the rest of the fleet.
        logger.warn('mobileHolderBonus: grant failed', { driverId: driver.id, error: (e as Error).message });
      }
    }
    logger.info('mobileHolderBonus: run done', { checked: snap.size, granted });
  },
);
