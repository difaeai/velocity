/**
 * The one place a wallet is credited from a paid top-up intent.
 *
 * Shared by the gateway callback (`paymentWebhook`) and one-tap charges against
 * a saved payment method, so both routes into the wallet run the same
 * transaction and the same idempotency rule: an intent already marked `paid`
 * credits nothing a second time, no matter how many times the gateway retries.
 *
 * This is also the only writer of `toppedUpTotal`, the counter that marks a
 * wallet as holding gateway money and therefore closes it to withdrawal — see
 * domain/walletFunds.ts for why that boundary exists.
 */
import { db, FieldValue } from '../lib/firebase';
import { walletFunds } from '../domain/walletFunds';
import { trySettleCommissionFromWallet } from '../drivers/autoSettle';

/** Idempotently credits a wallet from a paid intent. Returns false if unknown. */
export async function creditFromIntent(intentId: string, providerTxnRef: string): Promise<boolean> {
  const credited = await applyCredit(intentId, providerTxnRef);

  // A driver who tops up is very often a driver who topped up BECAUSE a closed
  // day locked them. Settling here means the money that just landed clears the
  // lock by itself, rather than the driver having to find a second button
  // after the gateway sends them back to the app.
  //
  // Deliberately after the credit transaction and deliberately unable to fail
  // it: the money has reached the wallet either way, and a settlement that did
  // not happen leaves the driver exactly where the manual path already puts
  // them. It is a no-op for a passenger, who has no driver document.
  if (credited.uid) {
    await trySettleCommissionFromWallet({ driverId: credited.uid, trigger: 'topup' });
  }
  return credited.ok;
}

/** The credit itself. Returns the wallet it landed in, when one was credited. */
async function applyCredit(
  intentId: string,
  providerTxnRef: string,
): Promise<{ ok: boolean; uid: string | null }> {
  const intentRef = db.doc(`paymentIntents/${intentId}`);
  return db.runTransaction(async (tx): Promise<{ ok: boolean; uid: string | null }> => {
    const snap = await tx.get(intentRef);
    if (!snap.exists) return { ok: false, uid: null };
    // Already credited. No settle attempt either: a gateway retrying a
    // callback must not re-run anything downstream of the money.
    if (snap.get('status') === 'paid') return { ok: true, uid: null };
    const uid = snap.get('uid') as string;
    const amount = snap.get('amount') as number;
    const walletRef = db.doc(`wallets/${uid}`);
    // Read before write (Firestore transaction invariant), and needed anyway to
    // seed `earned` the first time this wallet ever takes gateway money.
    const walletSnap = await tx.get(walletRef);
    const txRef = walletRef.collection('transactions').doc();
    tx.set(intentRef, { status: 'paid', providerTxnRef, paidAt: FieldValue.serverTimestamp() }, { merge: true });

    // Settle what is withdrawable BEFORE this credit lands, and store it.
    //
    // Two jobs in one line. On a wallet that has never taken gateway money this
    // is the migration: `walletFunds` was trusting the whole balance, and this
    // writes that same number down so it keeps its withdrawable status once the
    // wallet starts being read the strict way — no backfill script.
    //
    // On every later top-up it settles earnings the driver has already spent on
    // Velocity's charges. A driver who earned 500 and paid 300 of it in
    // commission is owed 200, not 500; without clamping here, the next top-up
    // would refloat `earned` above the balance and 300 rupees of gateway money
    // would become withdrawable.
    const earnedBeforeTopup = walletFunds(walletSnap).withdrawable;

    tx.set(
      walletRef,
      {
        balance: FieldValue.increment(amount),
        // Deliberately NOT added to `earned`: gateway money is never the
        // platform's debt to the user, so it can never be paid back out.
        toppedUpTotal: FieldValue.increment(amount),
        earned: earnedBeforeTopup,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(txRef, {
      type: 'topup',
      amount,
      intentId,
      provider: snap.get('provider') ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, uid };
  });
}
