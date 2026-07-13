/**
 * Clearing unpaid cancellation fees — screenshot submission + admin review.
 *
 * The AI vision path needs an ANTHROPIC_API_KEY and network, so these tests
 * cover the deterministic behaviour: with no key configured every submission
 * goes to admin review (never auto-cleared), and admin approve/reject either
 * clears the debt or leaves it standing. Mirrors the driver commission tests —
 * the two flows share one auto-approve policy (decideProofOutcome).
 *
 * Verified invariants:
 *  - a passenger (not just a driver) can submit — anyone can owe a fee
 *  - submitting does NOT clear the debt on its own; only approval does
 *  - approval clears exactly `amountDue`, so a fee charged after the transfer
 *    was sent survives it instead of being silently forgiven
 *  - approval is idempotent and books the money to the ledger + counters
 *  SECURITY: you cannot submit a proof uploaded under someone else's path
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { submitCancellationFeeSettlement } from '../cancellationFees';
import { adminReviewCommissionSettlement } from '../../drivers/commissionSettlement';

const PASSENGER = 'fee-passenger';
const ADMIN = 'fee-admin';

function adminReq<T>(data: T): CallableRequest<T> {
  return {
    data,
    auth: { uid: ADMIN, token: { uid: ADMIN, role: 'admin' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

const PROOF = `settlements/${PASSENGER}/fee-1`;

async function seedDebtor(outstanding = 120) {
  await db().doc('config/settlementAccounts').set({
    easypaisaNumber: '03001234567',
    accountTitle: 'Velocity',
  });
  await db().doc(`wallets/${PASSENGER}`).set({ balance: 0, outstanding });
}

async function outstandingOf(uid: string): Promise<number> {
  const snap = await db().doc(`wallets/${uid}`).get();
  return (snap.get('outstanding') as number | undefined) ?? 0;
}

beforeEach(async () => {
  await clearFirestore();
  delete process.env.ANTHROPIC_API_KEY;
});

describe('submitCancellationFeeSettlement (no AI key → admin review)', () => {
  it('queues a passenger for review and leaves the debt standing', async () => {
    await seedDebtor(120);

    const res = await submitCancellationFeeSettlement.run(
      makeReq({ proofPath: PROOF, method: 'easypaisa' }, PASSENGER),
    ) as { status: string; settlementId: string; amountDue: number };

    expect(res.status).toBe('pending_review');
    expect(res.amountDue).toBe(120);

    const settle = await db().doc(`commissionSettlements/${res.settlementId}`).get();
    expect(settle.get('kind')).toBe('cancellation_fee');
    expect(settle.get('userId')).toBe(PASSENGER);
    expect(settle.get('status')).toBe('pending_review');

    // Submitting proves nothing yet — still owed until a human says otherwise.
    expect(await outstandingOf(PASSENGER)).toBe(120);
  });

  it('rejects a user who owes nothing', async () => {
    await db().doc(`wallets/${PASSENGER}`).set({ balance: 0, outstanding: 0 });

    await expect(
      submitCancellationFeeSettlement.run(makeReq({ proofPath: PROOF }, PASSENGER)),
    ).rejects.toThrow(/no cancellation fees/i);
  });

  it("rejects a proof uploaded under someone else's path", async () => {
    await seedDebtor();

    await expect(
      submitCancellationFeeSettlement.run(
        makeReq({ proofPath: 'settlements/somebody-else/fee-1' }, PASSENGER),
      ),
    ).rejects.toThrow(/Invalid screenshot path/);
  });
});

describe('adminReviewCommissionSettlement — cancellation fees', () => {
  it('clears the debt on approval and books the money', async () => {
    await seedDebtor(120);
    const { settlementId } = await submitCancellationFeeSettlement.run(
      makeReq({ proofPath: PROOF, method: 'easypaisa' }, PASSENGER),
    ) as { settlementId: string };

    await adminReviewCommissionSettlement.run(adminReq({ settlementId, approve: true }));

    expect(await outstandingOf(PASSENGER)).toBe(0);

    const settle = await db().doc(`commissionSettlements/${settlementId}`).get();
    expect(settle.get('status')).toBe('approved');
    expect(settle.get('clearedAmount')).toBe(120);

    const ledger = await db().collection('platformLedger')
      .where('type', '==', 'cancellation_fee_settled').get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0]!.data()).toMatchObject({
      userId: PASSENGER, amount: 120, source: 'manual_bank', verifiedBy: ADMIN,
    });

    const counters = await db().doc('system/counters').get();
    expect(counters.get('cancellationFeesCollected')).toBe(120);
    expect(counters.get('cancellationFeesOutstanding')).toBe(-120);
  });

  it('only clears what was paid for — a fee charged since the transfer survives', async () => {
    await seedDebtor(120);
    const { settlementId } = await submitCancellationFeeSettlement.run(
      makeReq({ proofPath: PROOF }, PASSENGER),
    ) as { settlementId: string };

    // They cancel another ride while the screenshot sits in the review queue.
    await db().doc(`wallets/${PASSENGER}`).set({ outstanding: 200 }, { merge: true });

    await adminReviewCommissionSettlement.run(adminReq({ settlementId, approve: true }));

    // The 120 they actually paid is gone; the newer 80 is still owed.
    expect(await outstandingOf(PASSENGER)).toBe(80);
  });

  it('leaves the debt standing on rejection', async () => {
    await seedDebtor(120);
    const { settlementId } = await submitCancellationFeeSettlement.run(
      makeReq({ proofPath: PROOF }, PASSENGER),
    ) as { settlementId: string };

    await adminReviewCommissionSettlement.run(
      adminReq({ settlementId, approve: false, reason: 'Receipt is edited.' }),
    );

    expect(await outstandingOf(PASSENGER)).toBe(120);
    const settle = await db().doc(`commissionSettlements/${settlementId}`).get();
    expect(settle.get('status')).toBe('rejected');
    expect(settle.get('rejectionReason')).toBe('Receipt is edited.');
  });

  it('is idempotent — approving twice does not clear the debt twice', async () => {
    await seedDebtor(120);
    const { settlementId } = await submitCancellationFeeSettlement.run(
      makeReq({ proofPath: PROOF }, PASSENGER),
    ) as { settlementId: string };

    await adminReviewCommissionSettlement.run(adminReq({ settlementId, approve: true }));
    // A fresh fee arrives, then an admin double-clicks approve on the old doc.
    await db().doc(`wallets/${PASSENGER}`).set({ outstanding: 50 }, { merge: true });
    await adminReviewCommissionSettlement.run(adminReq({ settlementId, approve: true }));

    expect(await outstandingOf(PASSENGER)).toBe(50); // untouched by the replay
    const ledger = await db().collection('platformLedger')
      .where('type', '==', 'cancellation_fee_settled').get();
    expect(ledger.size).toBe(1);
  });
});
