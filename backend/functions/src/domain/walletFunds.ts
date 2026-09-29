/**
 * Which part of a wallet balance is allowed to leave the platform as cash.
 *
 * WHY THIS EXISTS — it is a regulatory boundary, not a product rule.
 *
 * The State Bank of Pakistan defines e-money as monetary value issued on
 * receipt of funds and "accepted as a means of payment by entities other than
 * the issuer". Issuing e-money requires an EMI licence and a Rs 200 million
 * capital base, which Velocity does not have and does not want to need.
 *
 * A balance a driver tops up to pay Velocity's own commission is NOT e-money:
 * only Velocity accepts it, so it is a closed-loop prepayment for our own
 * service — ordinary merchant activity. That stays true only while the money
 * cannot come back out. The moment a driver can top up PKR 10,000 through a
 * gateway and withdraw PKR 10,000 to their Easypaisa account, we are moving
 * other people's money between instruments, the loop is open, and we are
 * running an unlicensed payment service.
 *
 * So: gateway money in can only ever be spent on Velocity charges. Only money
 * the platform genuinely owes the driver — their share of fares they actually
 * drove — can be withdrawn.
 *
 * HOW IT IS TRACKED — two counters on `wallets/{uid}`, both server-written only
 * (the rules deny every client write to the whole collection):
 *
 *   `toppedUpTotal`  Lifetime sum of gateway top-ups. Monotonic — it only ever
 *                    increases, and `creditFromIntent` is the only writer. It
 *                    is not a spendable pot; it exists to answer one question:
 *                    has this wallet ever taken money from a gateway?
 *
 *   `earned`         Ride earnings credited to this wallet, less payouts
 *                    already requested against them. Incremented only by the
 *                    trip settlement in `completeTrip`, decremented only by
 *                    `requestPayout`.
 *
 * Nothing else touches either field. Spending does not reduce `earned` —
 * `withdrawable` takes `min(balance, earned)`, so a driver who spends their
 * earnings down is capped by `balance` automatically and a driver who spends
 * their topped-up money is still owed what they drove for. That is why there is
 * no "consume the ring-fenced pot first" bookkeeping spread across the nine
 * places that debit a wallet: the minimum does that work, and there is no
 * invariant for a future debit path to forget to maintain.
 *
 * Worked example — a driver tops up 1,000 and then drives 500 of earnings:
 *
 *   balance 1,500 · toppedUpTotal 1,000 · earned 500  → withdrawable 500
 *   pays 300 commission →  balance 1,200 · earned 500 → withdrawable 500
 *   withdraws 500       →  balance   700 · earned   0 → withdrawable   0
 *
 * The 700 left over is gateway money. It can pay commission, cancellation fees
 * or a subscription. It cannot be cashed out, and it never could have been.
 */
import type { DocumentSnapshot } from 'firebase-admin/firestore';

/** A wallet's balance split by where the money came from. All PKR. */
export interface WalletFunds {
  /** Everything in the wallet. */
  balance: number;
  /** Lifetime gateway top-ups — see the file header. */
  toppedUpTotal: number;
  /** Ride earnings credited, less payouts already taken against them. */
  earned: number;
  /** What a payout request may draw on right now. */
  withdrawable: number;
  /** The rest — gateway money, spendable only on Velocity's own charges. */
  ringFenced: number;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Split a wallet snapshot into what may be withdrawn and what may not.
 *
 * Accepts a missing document (a wallet that was never created reads as zero
 * throughout) so callers do not have to branch on existence.
 */
export function walletFunds(snap: DocumentSnapshot | undefined): WalletFunds {
  const balance = Math.max(0, num(snap?.get('balance')));
  const toppedUpTotal = Math.max(0, num(snap?.get('toppedUpTotal')));

  // A wallet that has never received gateway money cannot be holding any, so
  // all of it is withdrawable whatever `earned` happens to say.
  //
  // This is also the migration: every wallet that exists today predates the
  // gateway going live, so its balance came from a trip settlement or an admin
  // adjustment and is genuinely the user's to take. `creditFromIntent` seeds
  // `earned` from the balance on the first top-up, so a legacy balance keeps
  // its withdrawable status the moment the field starts being consulted, with
  // no backfill script to run against production.
  const earned = toppedUpTotal > 0 ? num(snap?.get('earned')) : balance;

  const withdrawable = Math.max(0, Math.min(balance, earned));
  return {
    balance,
    toppedUpTotal,
    earned,
    withdrawable,
    ringFenced: balance - withdrawable,
  };
}
