/**
 * Manual commission settlement — screenshot submission + admin review.
 *
 * The AI vision path needs an ANTHROPIC_API_KEY and network, so these tests
 * cover the deterministic behaviour: with no key configured every submission
 * goes to admin review (never auto-approved), and admin approve/reject settles
 * the money and unlocks (or leaves the driver locked). This mirrors the "safe"
 * auto-unlock policy — nothing is trusted without either a confident AI verdict
 * or a human.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { submitCommissionSettlement, adminReviewCommissionSettlement } from '../commissionSettlement';

const DRIVER = 'driver-settle';
const ADMIN = 'admin-1';

function req<T>(data: T, uid: string, role: string): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

async function seedLockedDriver() {
  await db().doc('config/commissionSettings').set({ rate: 0.15, threshold: 5000 });
  await db().doc('config/settlementAccounts').set({ easypaisaNumber: '03001234567', accountTitle: 'Velocity' });
  await db().doc(`drivers/${DRIVER}`).set({
    verificationStatus: 'approved',
    cycleGrossFare: 5000,
    cycleCashFare: 5000, // 15% → 750 due
  });
}

describe('submitCommissionSettlement (no AI key → admin review)', () => {
  beforeEach(async () => {
    await clearFirestore();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('queues a locked driver for admin review and keeps them locked', async () => {
    await seedLockedDriver();
    const res = await submitCommissionSettlement.run(
      req({ proofPath: `drivers/${DRIVER}/documents/settlement-1`, method: 'easypaisa' }, DRIVER, 'driver'),
    ) as { status: string; settlementId: string; amountDue: number };

    expect(res.status).toBe('pending_review');
    expect(res.amountDue).toBe(750);

    const settle = await db().doc(`commissionSettlements/${res.settlementId}`).get();
    expect(settle.get('status')).toBe('pending_review');
    expect(settle.get('driverId')).toBe(DRIVER);

    // Still locked — cycle untouched until approved.
    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleGrossFare')).toBe(5000);
  });

  it('rejects a screenshot path that is not the driver’s own', async () => {
    await seedLockedDriver();
    await expect(
      submitCommissionSettlement.run(
        req({ proofPath: 'drivers/someone-else/documents/x' }, DRIVER, 'driver'),
      ),
    ).rejects.toThrow(/Invalid screenshot path/);
  });

  it('refuses when no commission is due', async () => {
    await db().doc('config/commissionSettings').set({ rate: 0.15, threshold: 5000 });
    await db().doc(`drivers/${DRIVER}`).set({ verificationStatus: 'approved', cycleGrossFare: 1000, cycleCashFare: 1000 });
    await expect(
      submitCommissionSettlement.run(
        req({ proofPath: `drivers/${DRIVER}/documents/settlement-1` }, DRIVER, 'driver'),
      ),
    ).rejects.toThrow(/No commission is due/);
  });
});

describe('adminReviewCommissionSettlement', () => {
  beforeEach(async () => {
    await clearFirestore();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('approving settles the cycle, ledgers manual revenue and unlocks the driver', async () => {
    await seedLockedDriver();
    const submitted = await submitCommissionSettlement.run(
      req({ proofPath: `drivers/${DRIVER}/documents/settlement-1`, method: 'easypaisa' }, DRIVER, 'driver'),
    ) as { settlementId: string };

    const res = await adminReviewCommissionSettlement.run(
      req({ settlementId: submitted.settlementId, approve: true }, ADMIN, 'admin'),
    ) as { status: string };
    expect(res.status).toBe('approved');

    // Driver unlocked.
    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleGrossFare')).toBe(0);
    expect(driver.get('cycleCashFare')).toBe(0);

    // Realized platform revenue via manual bank transfer.
    const ledger = await db().collection('platformLedger').get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0]!.get('source')).toBe('manual_bank');
    expect(ledger.docs[0]!.get('amount')).toBe(750);

    const counters = await db().doc('system/counters').get();
    expect(counters.get('manualCommissionCollected')).toBe(750);

    const settle = await db().doc(`commissionSettlements/${submitted.settlementId}`).get();
    expect(settle.get('status')).toBe('approved');
  });

  it('rejecting leaves the driver locked with a reason', async () => {
    await seedLockedDriver();
    const submitted = await submitCommissionSettlement.run(
      req({ proofPath: `drivers/${DRIVER}/documents/settlement-1` }, DRIVER, 'driver'),
    ) as { settlementId: string };

    await adminReviewCommissionSettlement.run(
      req({ settlementId: submitted.settlementId, approve: false, reason: 'Blurry receipt' }, ADMIN, 'admin'),
    );

    const settle = await db().doc(`commissionSettlements/${submitted.settlementId}`).get();
    expect(settle.get('status')).toBe('rejected');
    expect(settle.get('rejectionReason')).toBe('Blurry receipt');

    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('cycleGrossFare')).toBe(5000); // still locked
    expect((await db().collection('platformLedger').get()).size).toBe(0);
  });
});
