/**
 * The one place a wallet is credited from a paid top-up intent.
 *
 * Shared by the gateway callback (`paymentWebhook`) and one-tap charges against
 * a saved payment method, so both routes into the wallet run the same
 * transaction and the same idempotency rule: an intent already marked `paid`
 * credits nothing a second time, no matter how many times the gateway retries.
 */
import { db, FieldValue } from '../lib/firebase';

/** Idempotently credits a wallet from a paid intent. Returns false if unknown. */
export async function creditFromIntent(intentId: string, providerTxnRef: string): Promise<boolean> {
  const intentRef = db.doc(`paymentIntents/${intentId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(intentRef);
    if (!snap.exists) return false;
    if (snap.get('status') === 'paid') return true; // already credited
    const uid = snap.get('uid') as string;
    const amount = snap.get('amount') as number;
    const walletRef = db.doc(`wallets/${uid}`);
    const txRef = walletRef.collection('transactions').doc();
    tx.set(intentRef, { status: 'paid', providerTxnRef, paidAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(
      walletRef,
      { balance: FieldValue.increment(amount), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(txRef, {
      type: 'topup',
      amount,
      intentId,
      provider: snap.get('provider') ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}
