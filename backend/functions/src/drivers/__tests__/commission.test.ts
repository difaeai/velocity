/**
 * Paying the commission a closed day left owing — cash, online and mixed days.
 *
 * The rule under test: every completed ride grows `cycleGrossFare`; only cash
 * rides grow `cycleCashFare`. Nothing is payable while the day is still
 * running; once it has closed the driver owes `rate × its cash fares` and
 * cannot take new work until it is cleared. Paying debits the wallet, ledgers
 * platform revenue, and drops the settled days off the cycle while leaving the
 * day the driver is standing in alone.
 *
 * There is no PKR threshold any more — see domain/commission.ts for why it had
 * to go.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { pktDayKey, pktPreviousDay } from '../../domain/dailyTarget';
import { payCommission } from '../index';

const DRIVER = 'driver-kamran';

/** Today and yesterday, Pakistan time — the only two days that matter here. */
const TODAY = pktDayKey();
const YESTERDAY = pktPreviousDay(TODAY);

function driverReq<T>(data: T, uid = DRIVER): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role: 'driver' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

/**
 * Seed a driver whose fares are from a day that has already closed, so they are
 * payable. `openGross`/`openCash` add fares from today on top, which must
 * survive the payment untouched.
 */
async function seed({
  cycleGrossFare,
  cycleCashFare,
  balance,
  rate = 0.15,
  openGross = 0,
  openCash = 0,
  commissionCredit,
}: {
  cycleGrossFare: number;
  cycleCashFare?: number;
  balance: number;
  rate?: number;
  openGross?: number;
  openCash?: number;
  commissionCredit?: number;
}) {
  await db().doc('config/commissionSettings').set({ rate });
  await db().doc(`drivers/${DRIVER}`).set({
    verificationStatus: 'approved',
    cycleGrossFare: cycleGrossFare + openGross,
    ...(cycleCashFare === undefined ? {} : { cycleCashFare: cycleCashFare + openCash }),
    // Whatever is NOT today's is what has closed and become due.
    cycleDay: openGross > 0 || openCash > 0 ? TODAY : YESTERDAY,
    cycleGrossToday: openGross,
    cycleCashToday: openCash,
    ...(commissionCredit === undefined ? {} : { commissionCredit }),
  });
  await db().doc(`wallets/${DRIVER}`).set({ balance });
}

describe('payCommission', () => {
  beforeEach(clearFirestore);

  it('all-cash closed day: charges rate × cash fares and clears the cycle', async () => {
    await seed({ cycleGrossFare: 5000, cycleCashFare: 5000, balance: 1000 });

    const res = await payCommission.run(driverReq({}));
    expect(res).toEqual({ ok: true, amountPaid: 750 }); // 15% of 5000

    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleGrossFare')).toBe(0);
    expect(driver.get('cycleCashFare')).toBe(0);

    const wallet = await db().doc(`wallets/${DRIVER}`).get();
    expect(wallet.get('balance')).toBe(250);

    const ledger = await db().collection('platformLedger').get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0]!.get('amount')).toBe(750);
    expect(ledger.docs[0]!.get('source')).toBe('cash_cycle');

    const counters = await db().doc('system/counters').get();
    expect(counters.get('cashCommissionCollected')).toBe(750);
  });

  it('mixed day: only the cash portion is charged (online already collected)', async () => {
    // 5 200 gross of which 2 000 was cash — commission on the 3 200 online
    // part was deducted from the held fares at completeTrip.
    await seed({ cycleGrossFare: 5200, cycleCashFare: 2000, balance: 500 });

    const res = await payCommission.run(driverReq({}));
    expect(res).toEqual({ ok: true, amountPaid: 300 }); // 15% of 2000

    const wallet = await db().doc(`wallets/${DRIVER}`).get();
    expect(wallet.get('balance')).toBe(200);
    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleGrossFare')).toBe(0);
  });

  it('leaves the day still running on the cycle', async () => {
    // Yesterday owes 750; today has taken another 1,200 that is not payable
    // yet and may never be, if the driver reaches the target.
    await seed({
      cycleGrossFare: 5000,
      cycleCashFare: 5000,
      balance: 1000,
      openGross: 1200,
      openCash: 1200,
    });

    const res = await payCommission.run(driverReq({}));
    expect(res).toEqual({ ok: true, amountPaid: 750 });

    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleGrossFare')).toBe(1200);
    expect(driver.get('cycleCashFare')).toBe(1200);
    expect(driver.get('cycleCashToday')).toBe(1200);
    expect(driver.get('cycleDay')).toBe(TODAY);
  });

  it('spends the driver bonus first and only charges the wallet the remainder', async () => {
    await seed({ cycleGrossFare: 5000, cycleCashFare: 5000, balance: 1000, commissionCredit: 500 });

    const res = await payCommission.run(driverReq({}));
    expect(res).toEqual({ ok: true, amountPaid: 250 }); // 750 owed − 500 bonus

    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('commissionCredit')).toBe(0);
    const wallet = await db().doc(`wallets/${DRIVER}`).get();
    expect(wallet.get('balance')).toBe(750);
  });

  it('all-online day: settles with no wallet debit', async () => {
    await seed({ cycleGrossFare: 6000, cycleCashFare: 0, balance: 50 });

    const res = await payCommission.run(driverReq({}));
    expect(res).toEqual({ ok: true, amountPaid: 0 });

    const wallet = await db().doc(`wallets/${DRIVER}`).get();
    expect(wallet.get('balance')).toBe(50);
    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleGrossFare')).toBe(0);
    expect((await db().collection('platformLedger').get()).size).toBe(0);
  });

  it('legacy driver without cycleCashFare: whole gross treated as cash', async () => {
    await seed({ cycleGrossFare: 5000, balance: 800 });

    const res = await payCommission.run(driverReq({}));
    expect(res).toEqual({ ok: true, amountPaid: 750 });
  });

  it('rejects a driver whose day has not closed yet', async () => {
    // PKR 9,000 taken today. However much it is, it is not payable until
    // midnight — and if they reach the target it never will be.
    await db().doc('config/commissionSettings').set({ rate: 0.15 });
    await db().doc(`drivers/${DRIVER}`).set({
      verificationStatus: 'approved',
      cycleGrossFare: 9000,
      cycleCashFare: 9000,
      cycleDay: TODAY,
      cycleGrossToday: 9000,
      cycleCashToday: 9000,
    });
    await db().doc(`wallets/${DRIVER}`).set({ balance: 10_000 });

    await expect(payCommission.run(driverReq({}))).rejects.toThrow(/no commission is due/i);
    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleCashFare')).toBe(9000);
  });

  it('rejects a driver carried over from the old scheme on their grace day', async () => {
    // No `cycleDay` at all: the whole cycle reads as the open day, so the
    // deploy itself cannot make anybody owe money overnight.
    await db().doc('config/commissionSettings').set({ rate: 0.15 });
    await db().doc(`drivers/${DRIVER}`).set({
      verificationStatus: 'approved',
      cycleGrossFare: 7000,
      cycleCashFare: 7000,
    });
    await db().doc(`wallets/${DRIVER}`).set({ balance: 10_000 });

    await expect(payCommission.run(driverReq({}))).rejects.toThrow(/no commission is due/i);
  });

  it('rejects when the wallet cannot cover the commission, naming the shortfall', async () => {
    await seed({ cycleGrossFare: 5000, cycleCashFare: 5000, balance: 700 });
    await expect(payCommission.run(driverReq({}))).rejects.toThrow(/Top up 50 PKR/);

    // Nothing moved.
    const wallet = await db().doc(`wallets/${DRIVER}`).get();
    expect(wallet.get('balance')).toBe(700);
    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleGrossFare')).toBe(5000);
  });

  it('uses the admin-set rate from config', async () => {
    await seed({ cycleGrossFare: 3000, cycleCashFare: 3000, balance: 1000, rate: 0.2 });

    const res = await payCommission.run(driverReq({}));
    expect(res).toEqual({ ok: true, amountPaid: 600 }); // 20% of 3000
  });
});
