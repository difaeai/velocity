/**
 * Telling drivers their day closed short — 00:05, Pakistan time.
 *
 * The money rule does not need this job. A day's commission becomes payable at
 * midnight on its own, because "payable" is derived from today's date and the
 * day stamped on the cycle (domain/commission.ts) — there is no flag to flip
 * and nothing to sweep. What a driver needs is to be TOLD, before they put the
 * car on the road and find out from an error message.
 *
 * So this is a notification job and nothing else. It writes no money fields. If
 * it fails, or is never deployed, the lock still works exactly the same; the
 * driver just learns about it the hard way.
 *
 * WHY 00:05 AND NOT MIDNIGHT. A ride that ends at 23:59:50 settles for a second
 * or two, and its transaction is what stamps the day on the cycle. Reading the
 * cycles five minutes later means the last rides of the night are counted in
 * the figure the driver is quoted.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { sendToUser } from '../lib/fcm';
import {
  commissionBreakdown,
  getCommissionSettings,
  readCycle,
} from '../domain/commission';
import { pktDayKey, pktPreviousDay } from '../domain/dailyTarget';

/**
 * How many drivers one run will look at.
 *
 * The query only matches drivers carrying unsettled cash, which is a small
 * slice of the fleet — but a cap means a bad data state cannot turn a nightly
 * job into an unbounded bill. If it is ever hit, the log says so.
 */
const MAX_DRIVERS = 2000;

export const notifyClosedCommissionDays = onSchedule(
  { schedule: 'every day 00:05', timeZone: 'Asia/Karachi' },
  async () => {
    const settings = await getCommissionSettings();
    const today = pktDayKey();
    const yesterday = pktPreviousDay(today);

    // Only drivers holding unsettled cash can owe anything.
    const snap = await db
      .collection('drivers')
      .where('cycleCashFare', '>', 0)
      .limit(MAX_DRIVERS)
      .get();
    if (snap.size === MAX_DRIVERS) {
      logger.warn('closeDay: hit the driver cap in one run', { cap: MAX_DRIVERS });
    }

    let told = 0;
    for (const driverSnap of snap.docs) {
      const breakdown = commissionBreakdown(driverSnap, settings, today);
      if (breakdown.due <= 0) continue;

      // Was it yesterday that closed, or has this debt been sitting there? The
      // wording changes, because "yesterday fell short" is wrong on day three
      // and a driver who reads a wrong reason stops reading the rest.
      const cycleDay = readCycle(driverSnap).day;
      const fresh = cycleDay === yesterday;
      const target = Math.max(1, Math.round(settings.dailyTargetRides));
      const rides = settings.dailyTargetPoolOnly ? 'pool rides' : 'rides';

      try {
        await sendToUser(
          driverSnap.id,
          '🔒 Commission due before you drive',
          (fresh
            ? `Yesterday ended on fewer than ${target} ${rides}, so ${Math.round(settings.rate * 100)}% of the cash you took — PKR ${breakdown.due.toLocaleString()} — is due now. `
            : `PKR ${breakdown.due.toLocaleString()} of commission is still unpaid from an earlier day. `) +
            `Pay it and upload the screenshot to start taking rides again. ` +
            `${target} ${rides} in a day and that day costs you nothing.`,
        );
        told += 1;
      } catch (e) {
        // One driver's dead token must not stop the rest of the fleet hearing.
        logger.warn('closeDay: push failed', {
          driverId: driverSnap.id,
          error: (e as Error).message,
        });
      }
    }

    logger.info('closeDay: notified drivers with commission due', {
      day: today,
      checked: snap.size,
      told,
    });
  },
);
