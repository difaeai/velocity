/**
 * Commission cycle settlement — cash, online and mixed cycles.
 *
 * The rule under test: every completed ride grows `cycleGrossFare`; only cash
 * rides grow `cycleCashFare`. At the admin threshold the driver is locked and
 * owes `rate × cycleCashFare` (online commission was already collected at
 * trip completion). Settling debits the wallet, ledgers platform revenue and
 * resets the cycle to zero.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { payCommission } from '../index';

const DRIVER = 'driver-kamran';

function driverReq<T>(data: T, uid = DRIVER): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role: 'driver' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

async function seed({
  cycleGrossFare,
  cycleCashFare,
  balance,
  rate = 0.15,
  threshold = 5000,
}: {
  cycleGrossFare: number;
  cycleCashFare?: number;
  balance: number;
  rate?: number;
  threshold?: number;
}) {
  await db().doc('config/commissionSettings').set({ rate, threshold });
  await db().doc(`drivers/${DRIVER}`).set({
    verificationStatus: 'approved',
    cycleGrossFare,
    ...(cycleCashFare === undefined ? {} : { cycleCashFare }),
  });
  await db().doc(`wallets/${DRIVER}`).set({ balance });
}

describe('payCommission', () => {
  beforeEach(clearFirestore);

  it('all-cash cycle: charges rate × cash fares and resets the cycle', async () => {
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

  it('mixed cycle: only the cash portion is charged (online already collected)', async () => {
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

  it('all-online cycle: settles with no wallet debit', async () => {
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

  it('rejects below the threshold', async () => {
    await seed({ cycleGrossFare: 4999, cycleCashFare: 4999, balance: 10000 });
    await expect(payCommission.run(driverReq({}))).rejects.toThrow(/threshold not reached/i);
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

  it('uses the admin-set rate and threshold from config', async () => {
    await seed({ cycleGrossFare: 3000, cycleCashFare: 3000, balance: 1000, rate: 0.2, threshold: 3000 });

    const res = await payCommission.run(driverReq({}));
    expect(res).toEqual({ ok: true, amountPaid: 600 }); // 20% of 3000
  });
});
