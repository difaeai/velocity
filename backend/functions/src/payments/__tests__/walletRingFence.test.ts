/**
 * The withdrawal ring-fence — money in through a gateway cannot come back out.
 *
 * This is a regulatory boundary, not a product rule (see domain/walletFunds.ts):
 * a closed-loop prepayment for Velocity's own commission is ordinary merchant
 * activity, but paying that money back out to an Easypaisa number would make us
 * an unlicensed payment service under the SBP's e-money definition.
 *
 * Verified invariants:
 *  - a gateway top-up credits the balance but is NOT withdrawable
 *  - ride earnings ARE withdrawable, and a payout consumes them
 *  - the two mix correctly: a driver who topped up AND drove can withdraw
 *    exactly what they drove for, no more
 *  - a legacy wallet that predates the counters keeps its whole balance
 *    withdrawable, and the first top-up writes that down rather than
 *    silently stranding it (the no-backfill migration)
 *  - earnings already spent on Velocity's charges do not refloat as
 *    withdrawable when a later top-up arrives
 *  - a second payout cannot draw on earnings the first one already took
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { walletFunds } from '../../domain/walletFunds';
import { creditFromIntent } from '../credit';
import { requestPayout } from '../index';

const DRIVER = 'rf-driver';

function driverReq<T>(data: T): CallableRequest<T> {
  return {
    data,
    auth: { uid: DRIVER, token: { uid: DRIVER, role: 'driver' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

/** Drive a gateway top-up through the real credit path. */
async function topUp(amount: number, id = `intent-${Math.random().toString(36).slice(2)}`) {
  await db().doc(`paymentIntents/${id}`).set({
    id, uid: DRIVER, amount, currency: 'PKR', status: 'pending', provider: 'payfast',
  });
  await creditFromIntent(id, `txn-${id}`);
}

/** Credit ride earnings the way completeTrip's wallet settlement does. */
async function earn(amount: number) {
  await db().doc(`wallets/${DRIVER}`).set({
    balance: admin.firestore.FieldValue.increment(amount),
    earned: admin.firestore.FieldValue.increment(amount),
  }, { merge: true });
}

/** Spend on a Velocity charge (commission, fee, subscription): balance only. */
async function spendOnVelocity(amount: number) {
  await db().doc(`wallets/${DRIVER}`).set({
    balance: admin.firestore.FieldValue.increment(-amount),
  }, { merge: true });
}

async function funds() {
  return walletFunds(await db().doc(`wallets/${DRIVER}`).get());
}

async function payout(amount: number) {
  return requestPayout.run(driverReq({ amount, method: 'easypaisa', account: '03001234567' }));
}

describe('wallet withdrawal ring-fence', () => {
  beforeEach(async () => {
    await clearFirestore();
    await db().doc(`drivers/${DRIVER}`).set({ uid: DRIVER });
  });

  it('credits a gateway top-up to the balance but not to withdrawable', async () => {
    await topUp(1000);

    const f = await funds();
    expect(f.balance).toBe(1000);
    expect(f.toppedUpTotal).toBe(1000);
    expect(f.withdrawable).toBe(0);
    expect(f.ringFenced).toBe(1000);
  });

  it('refuses a payout of topped-up money', async () => {
    await topUp(1000);

    await expect(payout(1000)).rejects.toThrow(/ride earnings/i);
    // and nothing moved
    expect((await funds()).balance).toBe(1000);
  });

  it('allows a payout of ride earnings, and consumes them', async () => {
    await topUp(1000);
    await earn(500);

    expect((await funds()).withdrawable).toBe(500);

    await payout(500);

    const f = await funds();
    expect(f.balance).toBe(1000);       // the topped-up money stays
    expect(f.withdrawable).toBe(0);     // the earnings are gone
    expect(f.ringFenced).toBe(1000);
  });

  it('lets a driver withdraw exactly what they drove for, no more', async () => {
    await topUp(1000);
    await earn(500);

    await expect(payout(501)).rejects.toThrow(/ride earnings/i);
    await payout(500);
    await expect(payout(1)).rejects.toThrow(/ride earnings/i);
  });

  it('keeps earnings withdrawable after Velocity charges eat the topped-up money', async () => {
    await topUp(1000);
    await earn(500);
    await spendOnVelocity(300); // commission paid out of the ring-fenced pot

    const f = await funds();
    expect(f.balance).toBe(1200);
    expect(f.withdrawable).toBe(500);

    await payout(500);
    expect((await funds()).balance).toBe(700); // pure gateway money, locked in
  });

  it('caps withdrawable at the balance when charges exceed the earnings', async () => {
    await earn(500);
    await spendOnVelocity(300);

    // Never topped up, so the whole remaining balance is theirs.
    const f = await funds();
    expect(f.balance).toBe(200);
    expect(f.withdrawable).toBe(200);
  });

  // ── Migration: wallets that predate the counters ───────────────────────────

  it('treats a legacy wallet with no counters as fully withdrawable', async () => {
    await db().doc(`wallets/${DRIVER}`).set({ balance: 5000 });

    const f = await funds();
    expect(f.toppedUpTotal).toBe(0);
    expect(f.withdrawable).toBe(5000);

    await payout(5000);
    expect((await funds()).balance).toBe(0);
  });

  it('writes a legacy balance down as earned on the first top-up', async () => {
    await db().doc(`wallets/${DRIVER}`).set({ balance: 5000 });
    await topUp(1000);

    const f = await funds();
    expect(f.balance).toBe(6000);
    // The 5,000 they already had stays theirs; only the new 1,000 is fenced.
    expect(f.withdrawable).toBe(5000);
    expect(f.ringFenced).toBe(1000);
  });

  it('leaves `earned` non-negative when a legacy wallet pays out first', async () => {
    await db().doc(`wallets/${DRIVER}`).set({ balance: 5000 });
    await payout(2000);

    // A blind decrement would have written -2000 here and stranded the rest.
    const f = await funds();
    expect(f.balance).toBe(3000);
    expect(f.earned).toBe(3000);
    expect(f.withdrawable).toBe(3000);
  });

  // ── The clamp ──────────────────────────────────────────────────────────────

  it('does not refloat spent earnings when a later top-up arrives', async () => {
    await earn(500);
    await spendOnVelocity(300); // they are now owed 200, not 500
    await topUp(1000);

    const f = await funds();
    expect(f.balance).toBe(1200);
    // Without the clamp in creditFromIntent this would read 500, handing the
    // driver 300 rupees of gateway money.
    expect(f.withdrawable).toBe(200);
    expect(f.ringFenced).toBe(1000);
  });

  it('accumulates toppedUpTotal across several top-ups', async () => {
    await topUp(500);
    await topUp(700);

    const f = await funds();
    expect(f.balance).toBe(1200);
    expect(f.toppedUpTotal).toBe(1200);
    expect(f.withdrawable).toBe(0);
  });

  it('does not double-credit a retried gateway callback', async () => {
    await db().doc('paymentIntents/retry-1').set({
      id: 'retry-1', uid: DRIVER, amount: 1000, currency: 'PKR', status: 'pending', provider: 'payfast',
    });
    await creditFromIntent('retry-1', 'txn-1');
    await creditFromIntent('retry-1', 'txn-1');

    const f = await funds();
    expect(f.balance).toBe(1000);
    expect(f.toppedUpTotal).toBe(1000);
  });

  it('cannot pay out the same earnings twice', async () => {
    await earn(400);
    await topUp(100); // force the strict path

    await payout(400);
    await expect(payout(400)).rejects.toThrow(/ride earnings/i);
    expect((await funds()).balance).toBe(100);
  });
});

describe('walletFunds()', () => {
  const snapOf = (data: Record<string, unknown> | undefined) =>
    ({ get: (k: string) => data?.[k] }) as admin.firestore.DocumentSnapshot;

  it('reads a missing wallet as all zeroes', () => {
    expect(walletFunds(undefined)).toMatchObject({ balance: 0, withdrawable: 0, ringFenced: 0 });
  });

  it('ignores a stale `earned` on a wallet that never took gateway money', () => {
    const f = walletFunds(snapOf({ balance: 300, earned: 9999 }));
    expect(f.withdrawable).toBe(300);
  });

  it('never reports negative withdrawable from corrupt data', () => {
    const f = walletFunds(snapOf({ balance: 100, toppedUpTotal: 50, earned: -500 }));
    expect(f.withdrawable).toBe(0);
    expect(f.ringFenced).toBe(100);
  });

  it('ignores non-numeric fields', () => {
    const f = walletFunds(snapOf({ balance: 'lots', toppedUpTotal: null, earned: undefined }));
    expect(f.balance).toBe(0);
    expect(f.withdrawable).toBe(0);
  });
});
