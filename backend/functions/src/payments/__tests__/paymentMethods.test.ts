/**
 * Saved payment methods — the connected-accounts money path.
 *
 * These run against the mock gateway (no real provider credentials in CI), which
 * implements TokenizingProvider in full, so the whole lifecycle is exercisable:
 * connect → default → one-tap charge → remove.
 *
 * The invariants that actually matter here are the money ones: the chargeable
 * token never appears in a client-readable document, a top-up credits exactly
 * once, and nobody can drive someone else's instrument.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import {
  getPaymentMethods,
  createPaymentMethodSetup,
  mockConfirmPaymentMethod,
  setDefaultPaymentMethod,
  deletePaymentMethod,
  topupWithSavedMethod,
} from '../paymentMethods';

const USER = 'user-methods';
const OTHER = 'user-other';

function req<T>(data: T, uid: string, role = 'passenger'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

/** Turn on both flags — saved methods alone cannot charge without top-ups on. */
async function enableFlags(opts: { topups?: boolean } = {}) {
  await db().doc('config/featureFlags').set({
    savedPaymentMethodsEnabled: true,
    walletTopupEnabled: opts.topups !== false,
  });
}

/** Connect one instrument through the mock gateway and return its id. */
async function connect(uid: string, kind = 'easypaisa'): Promise<string> {
  const setup = await createPaymentMethodSetup.run(req({ kind }, uid)) as { setupId: string };
  const res = await mockConfirmPaymentMethod.run(req({ setupId: setup.setupId }, uid)) as { methodId: string };
  return res.methodId;
}

describe('saved payment methods — launch posture', () => {
  beforeEach(clearFirestore);

  it('reports Coming Soon and hides every rail while the flag is off', async () => {
    const res = await getPaymentMethods.run(req({}, USER)) as {
      comingSoon: boolean; methods: unknown[]; supportedKinds: string[];
    };
    expect(res.comingSoon).toBe(true);
    expect(res.methods).toEqual([]);
    expect(res.supportedKinds).toEqual([]);
  });

  it('refuses to connect an account while the flag is off', async () => {
    await expect(
      createPaymentMethodSetup.run(req({ kind: 'easypaisa' }, USER)),
    ).rejects.toThrow(/coming soon/i);
  });

  it('refuses a one-tap top-up while the flag is off', async () => {
    await expect(
      topupWithSavedMethod.run(req({ methodId: 'anything', amount: 500 }, USER)),
    ).rejects.toThrow(/coming soon/i);
  });
});

describe('connecting an instrument', () => {
  beforeEach(async () => {
    await clearFirestore();
    await enableFlags();
  });

  it('saves the instrument and makes the first one the default', async () => {
    const methodId = await connect(USER);

    const doc = await db().doc(`paymentMethods/${methodId}`).get();
    expect(doc.get('uid')).toBe(USER);
    expect(doc.get('kind')).toBe('easypaisa');
    expect(doc.get('isDefault')).toBe(true);
    expect(doc.get('status')).toBe('active');
    expect(doc.get('label')).toBe('Easypaisa •••• 4321');
  });

  it('never puts the chargeable token in the client-readable document', async () => {
    const methodId = await connect(USER);

    const doc = await db().doc(`paymentMethods/${methodId}`).get();
    // The public doc must carry no secret under any key.
    expect(JSON.stringify(doc.data())).not.toContain('mocktok');

    // It lives in the secrets collection instead, which rules deny to clients.
    const secret = await db().doc(`paymentMethodSecrets/${methodId}`).get();
    expect(secret.get('token')).toContain('mocktok');
  });

  it('does not return the token from the listing callable', async () => {
    await connect(USER);
    const res = await getPaymentMethods.run(req({}, USER)) as { methods: unknown[] };
    expect(JSON.stringify(res.methods)).not.toContain('mocktok');
  });

  it('leaves the second instrument non-default', async () => {
    await connect(USER, 'easypaisa');
    const second = await connect(USER, 'jazzcash');
    const doc = await db().doc(`paymentMethods/${second}`).get();
    expect(doc.get('isDefault')).toBe(false);
  });

  it('is idempotent — confirming the same setup twice saves one instrument', async () => {
    const setup = await createPaymentMethodSetup.run(req({ kind: 'card' }, USER)) as { setupId: string };
    const first = await mockConfirmPaymentMethod.run(req({ setupId: setup.setupId }, USER)) as { methodId: string };
    const again = await mockConfirmPaymentMethod.run(req({ setupId: setup.setupId }, USER)) as { methodId: string };

    expect(again.methodId).toBe(first.methodId);
    const all = await db().collection('paymentMethods').where('uid', '==', USER).get();
    expect(all.size).toBe(1);
  });

  it('refuses to confirm somebody else’s setup', async () => {
    const setup = await createPaymentMethodSetup.run(req({ kind: 'easypaisa' }, USER)) as { setupId: string };
    await expect(
      mockConfirmPaymentMethod.run(req({ setupId: setup.setupId }, OTHER)),
    ).rejects.toThrow(/Not your setup/);
  });
});

describe('one-tap top-up', () => {
  beforeEach(async () => {
    await clearFirestore();
    await enableFlags();
  });

  it('credits the wallet and ledgers the top-up', async () => {
    const methodId = await connect(USER);
    const res = await topupWithSavedMethod.run(req({ methodId, amount: 1500 }, USER)) as { amount: number };
    expect(res.amount).toBe(1500);

    const wallet = await db().doc(`wallets/${USER}`).get();
    expect(wallet.get('balance')).toBe(1500);

    const txns = await db().collection(`wallets/${USER}/transactions`).get();
    expect(txns.size).toBe(1);
    expect(txns.docs[0].get('type')).toBe('topup');
    expect(txns.docs[0].get('amount')).toBe(1500);
  });

  it('accumulates across separate top-ups', async () => {
    const methodId = await connect(USER);
    await topupWithSavedMethod.run(req({ methodId, amount: 500 }, USER));
    await topupWithSavedMethod.run(req({ methodId, amount: 700 }, USER));

    const wallet = await db().doc(`wallets/${USER}`).get();
    expect(wallet.get('balance')).toBe(1200);
  });

  it('marks the intent paid so a replayed credit cannot double-spend', async () => {
    const methodId = await connect(USER);
    const res = await topupWithSavedMethod.run(req({ methodId, amount: 800 }, USER)) as { intentId: string };

    const intent = await db().doc(`paymentIntents/${res.intentId}`).get();
    expect(intent.get('status')).toBe('paid');
    expect(intent.get('source')).toBe('saved_method');

    // Re-running the credit for the same intent must not add a second 800.
    const { creditFromIntent } = await import('../credit');
    await creditFromIntent(res.intentId, 'replay');
    const wallet = await db().doc(`wallets/${USER}`).get();
    expect(wallet.get('balance')).toBe(800);
  });

  it('refuses to charge an instrument belonging to someone else', async () => {
    const methodId = await connect(USER);
    await expect(
      topupWithSavedMethod.run(req({ methodId, amount: 500 }, OTHER)),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses a revoked instrument', async () => {
    const methodId = await connect(USER);
    await db().doc(`paymentMethods/${methodId}`).set({ status: 'revoked' }, { merge: true });
    await expect(
      topupWithSavedMethod.run(req({ methodId, amount: 500 }, USER)),
    ).rejects.toThrow(/no longer usable/i);
  });

  it('still refuses when wallet top-ups themselves are switched off', async () => {
    const methodId = await connect(USER);
    await enableFlags({ topups: false });
    await expect(
      topupWithSavedMethod.run(req({ methodId, amount: 500 }, USER)),
    ).rejects.toThrow(/coming soon/i);
  });

  it('rejects an amount below the minimum', async () => {
    const methodId = await connect(USER);
    await expect(
      topupWithSavedMethod.run(req({ methodId, amount: 50 }, USER)),
    ).rejects.toThrow(/100/);
  });
});

describe('managing instruments', () => {
  beforeEach(async () => {
    await clearFirestore();
    await enableFlags();
  });

  it('moves the default flag and clears it from the previous holder', async () => {
    const first = await connect(USER, 'easypaisa');
    const second = await connect(USER, 'jazzcash');

    await setDefaultPaymentMethod.run(req({ methodId: second }, USER));

    expect((await db().doc(`paymentMethods/${first}`).get()).get('isDefault')).toBe(false);
    expect((await db().doc(`paymentMethods/${second}`).get()).get('isDefault')).toBe(true);
  });

  it('deletes the instrument and its token together', async () => {
    const methodId = await connect(USER);
    await deletePaymentMethod.run(req({ methodId }, USER));

    expect((await db().doc(`paymentMethods/${methodId}`).get()).exists).toBe(false);
    expect((await db().doc(`paymentMethodSecrets/${methodId}`).get()).exists).toBe(false);
  });

  it('promotes another instrument when the default is removed', async () => {
    const first = await connect(USER, 'easypaisa');
    const second = await connect(USER, 'jazzcash');

    await deletePaymentMethod.run(req({ methodId: first }, USER));

    expect((await db().doc(`paymentMethods/${second}`).get()).get('isDefault')).toBe(true);
  });

  it('refuses to delete somebody else’s instrument', async () => {
    const methodId = await connect(USER);
    await expect(
      deletePaymentMethod.run(req({ methodId }, OTHER)),
    ).rejects.toThrow(/not found/i);
    expect((await db().doc(`paymentMethods/${methodId}`).get()).exists).toBe(true);
  });
});
