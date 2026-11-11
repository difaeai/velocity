/**
 * What a paid card does, against the emulators: one `studioPayments` document,
 * approved by the gateway rather than a person, and the plan parked on whoever
 * paid. Then the cases that must change nothing — Stripe's own retry of the
 * same event, a session nobody paid, and a session carrying no plan of ours.
 *
 * The session below is not invented: it is the real object Stripe returned for
 * a sandbox payment made with 4242 4242 4242 4242 against this very code
 * (2026-11-11), trimmed to the fields `recordCardPayment` reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The receipt reader and the mailbox live outside the emulators; a card payment
// has no receipt to read, but importing the module must not reach for them.
vi.mock('../mailer', () => ({ sendStudioMail: async () => undefined }));
vi.mock('../paymentCheck', () => ({ checkStudioPayment: async () => undefined }));

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { recordCardPayment } from '../cardPay';

const UID = 'card-buyer';
const SESSION_ID = 'cs_test_a0WZnuJBgiAkzqZ6btmgVEAnDrdvCINTpCYZaZqOfkB1iUGeTcSWZTsvEW';

const paidSession = (over: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  payment_status: 'paid',
  status: 'complete',
  amount_total: 3200,
  currency: 'usd',
  payment_intent: 'pi_3UacloK57y7yv4e81fKAwgtE',
  customer_details: { email: 'test-buyer@example.com' },
  // `wid` empty is the sign-up path: paid before any workspace exists.
  metadata: { uid: UID, wid: '', plan: 'all', billing: 'month', amountUsd: '32' },
  ...over,
});

describe('a card payment Stripe has proved', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it('writes the payment approved and parks the plan on the person', async () => {
    expect(await recordCardPayment(paidSession())).toBe('approved');

    const pay = (await db().doc(`studioPayments/${SESSION_ID}`).get()).data();
    expect(pay).toMatchObject({
      uid: UID,
      wid: null,
      plan: 'all',
      billing: 'month',
      amountUsd: 32,
      method: 'card',
      status: 'approved',
      decidedBy: 'stripe',
      // No receipt and no transaction ID to claim: the gateway is the proof.
      screenshotPath: null,
      txnKey: null,
      txnId: 'pi_3UacloK57y7yv4e81fKAwgtE',
      email: 'test-buyer@example.com',
    });
    expect((await db().doc(`studioUsers/${UID}`).get()).get('prepaid')).toMatchObject({
      plan: 'all',
      billing: 'month',
      paymentId: SESSION_ID,
    });
  });

  it('is harmless when Stripe delivers the same event again', async () => {
    expect(await recordCardPayment(paidSession())).toBe('approved');
    const first = (await db().doc(`studioPayments/${SESSION_ID}`).get()).get('decidedAtMs');

    // Same session id, so the retry lands on the same document and decides nothing twice.
    expect(await recordCardPayment(paidSession())).toBe('already');
    expect((await db().doc(`studioPayments/${SESSION_ID}`).get()).get('decidedAtMs')).toBe(first);
    const snap = await db().collection('studioPayments').get();
    expect(snap.size).toBe(1);
  });

  it('buys a year when that is what was paid for', async () => {
    await recordCardPayment(paidSession({ amount_total: 37250, metadata: { uid: UID, wid: '', plan: 'all', billing: 'year', amountUsd: '372.48' } }));
    expect((await db().doc(`studioPayments/${SESSION_ID}`).get()).data()).toMatchObject({ billing: 'year', amountUsd: 372.5 });
    expect((await db().doc(`studioUsers/${UID}`).get()).get('prepaid')).toMatchObject({ billing: 'year' });
  });

  it('writes nothing for a session nobody paid', async () => {
    expect(await recordCardPayment(paidSession({ payment_status: 'unpaid', status: 'open' }))).toBe('ignored');
    expect((await db().collection('studioPayments').get()).empty).toBe(true);
  });

  it('writes nothing when the metadata is not ours', async () => {
    expect(await recordCardPayment(paidSession({ metadata: { uid: UID, wid: '', plan: 'not-a-plan', billing: 'month' } }))).toBe('ignored');
    expect(await recordCardPayment(paidSession({ metadata: { wid: '', plan: 'all', billing: 'month' } }))).toBe('ignored');
    expect((await db().collection('studioPayments').get()).empty).toBe(true);
  });

  it('refuses a session id that could not be a document id', async () => {
    expect(await recordCardPayment(paidSession({ id: 'cs_test_../../admin' }))).toBe('ignored');
    expect(await recordCardPayment(paidSession({ id: 'pi_123' }))).toBe('ignored');
  });
});
