/**
 * The mobile-holder bonus: PKR 2,000 once for every approved driver, spent on
 * their commission like any other bonus.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { commissionDue, getCommissionSettings } from '../../domain/commission';
import { pktDayKey, pktPreviousDay } from '../../domain/dailyTarget';
import { grantMobileHolderBonuses, MOBILE_HOLDER_BONUS } from '../mobileHolderBonus';

const TODAY = pktDayKey();
const sweep = () => grantMobileHolderBonuses.run({} as never);

describe('grantMobileHolderBonuses', () => {
  beforeEach(clearFirestore);

  it('gives each approved driver PKR 1,000 once, and it pays a closed day', async () => {
    // Yesterday closed on PKR 10,000 cash: 5% = 500 owed, so this driver is locked.
    await db().doc('drivers/approved').set({
      verificationStatus: 'approved',
      commissionCredit: 300,
      cycleGrossFare: 10_000,
      cycleCashFare: 10_000,
      cycleDay: pktPreviousDay(TODAY),
      cycleGrossToday: 0,
      cycleCashToday: 0,
    });
    await db().doc('drivers/pending').set({ verificationStatus: 'pending' });

    await sweep();
    await sweep(); // a second run must not pay again

    const driver = await db().doc('drivers/approved').get();
    expect(driver.get('commissionCredit')).toBe(300 + MOBILE_HOLDER_BONUS);
    expect(driver.get('mobileHolderBonusAt')).toBeTruthy();
    const rows = await db().collection('drivers/approved/commissionCredits').get();
    expect(rows.docs.map((d) => [d.get('type'), d.get('amount')])).toEqual([['admin_grant', MOBILE_HOLDER_BONUS]]);
    expect(commissionDue(driver, await getCommissionSettings(), TODAY)).toBe(0);

    const pending = await db().doc('drivers/pending').get();
    expect(pending.get('commissionCredit')).toBeUndefined();
  });
});
