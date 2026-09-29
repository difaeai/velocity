# Payments

Wallet top-ups, ride payments, commission collection and driver payouts.
**All money movement is server-authoritative and transactional** — wallets are
never client-writable (enforced by the rules).

## Launch posture (feature flags)

The wallet top-up economy and Travel Mate subscriptions are **fully built but
switched off for launch** — we grow the user base first, monetise later. Flags
live in `config/featureFlags` (admin-editable from the dashboard → Feature
flags) and are read live by the app, so flipping one re-enables the feature
app-wide with no deploy. Defaults:

| Flag | Default | Effect when off |
|------|---------|-----------------|
| `walletTopupEnabled` | `false` | Wallet top-ups show "Coming Soon"; `createTopupIntent`/`getPaymentOptions` decline; ride booking is cash-only (the Wallet pay option is disabled). |
| `savedPaymentMethodsEnabled` | `false` | Payment methods screen shows "Coming Soon"; connecting, charging and removing an instrument all decline. |
| `travelMateSubscriptionsEnabled` | `false` | Paid plans show "Coming Soon"; `requestTravelMateSubscription` declines. |
| `travelMateFree` | `true` | Travel Mate likes are unlimited for everyone (`travelMateSwipe` grants a very high free allowance). |

`savedPaymentMethodsEnabled` is deliberately **separate** from
`walletTopupEnabled`: tokenisation (charging a stored instrument again on our
say-so) is a distinct merchant permission every Pakistani gateway grants on top
of plain checkout, so basic top-ups are expected to go live first and connected
accounts to follow.

While top-ups are off, drivers settle their commission by **manual bank
transfer + AI-verified screenshot** (below) rather than from their wallet.

## Flow

**Top-up:** app → `createTopupIntent(amount)` → backend creates a `paymentIntents`
doc + asks the provider to charge → user pays on the gateway → the gateway calls
`paymentWebhook` → the backend verifies it and **credits the wallet idempotently**.
Gateway settlement (where the customer's money physically lands) is the JazzCash /
Easypaisa / bank **merchant account registered with the gateway**.

**Saved payment methods (connected accounts):** the inDrive-style model — the
user authorises Velocity once at the gateway and later top-ups are one tap.
`createPaymentMethodSetup(kind)` creates a `paymentMethodSetups` doc and returns
a URL; the user authorises at the gateway; the gateway returns a reusable token
to `paymentMethodCallback`, which stores it and writes a `paymentMethods` doc.
`topupWithSavedMethod(methodId, amount)` then charges that token
server-to-server and credits the wallet through the **same idempotent
`creditFromIntent`** the gateway webhook uses, so both routes into the wallet
share one money path.

The token is split out exactly like `paymentIntentSecrets`: display data lives
in `paymentMethods/{id}` (owner-readable), the chargeable token in
`paymentMethodSecrets/{id}` which **rules deny to every client, owner and admin
alike**. It is only ever read by server code through the Admin SDK. A charge
that comes back `tokenDead` marks the method `revoked` so the user is prompted
to reconnect rather than retrying a dead instrument forever.

Only a provider implementing `TokenizingProvider` can do this; a gateway may be
fully configured for checkout and still not support it. The **mock** provider
implements it in full, so the whole connect → default → one-tap → remove flow is
testable end to end without any merchant contract.

**Wallet ride (escrow):** trips created with `paymentMethod: 'wallet'` are
rejected at `createTrip` if the passenger can't afford the offer. When the
passenger accepts a bid, `acceptBid` **holds the full fare** from their wallet
(`ride_hold` ledger entry, `walletHold` on the trip). `cancelTrip` releases the
hold back (`ride_hold_refund`). `completeTrip` settles it: the driver's wallet
is credited with the fare minus commission, and the commission is written to
`platformLedger` (`ride_commission`, source `wallet`) plus the
`system/counters.walletCommissionCollected` counter.

**Cash ride commission (settle cycle):** every completed ride grows the
driver's `cycleGrossFare`; cash rides also grow `cycleCashFare`. When
`cycleGrossFare` reaches the admin threshold (`config/commissionSettings`,
dashboard Commission page) the driver is **locked**: `placeBid`,
`driverRespondToRequest` and `driverAcceptPoolBatch` reject them, and the app
pauses on the wallet screen with incoming rides blurred. What they owe is
`rate × cycleCashFare` only — commission on wallet rides was already deducted
at completion, so mixed cycles never pay twice and an all-online cycle clears
automatically at `completeTrip` without locking. `payCommission` **debits the
amount from the driver's wallet** (they top it up via the gateway, so the money
reaches the platform), ledgers it (`platformLedger`, source `cash_cycle`,
`system/counters.cashCommissionCollected`) and resets both cycle counters to
zero. `payCommission` is the wallet path and stays wired for when top-ups are
re-enabled; at launch drivers use the manual path below instead.

**Manual settlement (launch — bank transfer + AI-verified screenshot):** with
wallet top-ups off, the locked driver transfers the amount due to Velocity's
account (`config/settlementAccounts`) and uploads a screenshot.
`submitCommissionSettlement` sends it to a Claude vision model
(`lib/paymentProofAI.ts`, key = `ANTHROPIC_API_KEY` secret) which checks the
receipt is genuine, ≥ the amount due, and sent to a Velocity account. Policy is
**safe auto-unlock**: only a clearly-genuine, correct-amount, correct-recipient
verdict settles automatically (resets the cycle, ledgers `platformLedger`
source `manual_bank`, `system/counters.manualCommissionCollected`, unlocks the
driver). An obvious fake is rejected (driver re-uploads); anything uncertain —
and everything, if no AI key is set — becomes a `commissionSettlements` doc with
status `pending_review` for an admin to approve/reject
(`adminReviewCommissionSettlement`, dashboard → Settlements). AI-approve and
admin-approve share the same money transaction (`applyManualSettlement`).

**Cancellation fees:** cancelling a trip nobody has taken yet (`requested`) is
free — the passenger is only withdrawing an offer. Once a driver has accepted
(`matched` / `arriving` / `arrived`), whoever walks away owes Velocity a share of
the **locked fare**: **5% from a passenger, 8% from a driver** (admin-set in
`config/cancellationSettings`, dashboard → Cancellation fees). `in_progress`
trips still cannot be cancelled by anyone. `cancelTrip` charges the fee inside
the same transaction that cancels the trip: it comes out of the canceller's
**wallet balance first** (a cancelling passenger's released `walletHold` counts
toward that), and only the shortfall becomes **`wallets/{uid}.outstanding`** — a
debt to Velocity that passengers and drivers alike can carry. Balance is never
driven negative. The whole fee is ledgered (`platformLedger`,
`cancellation_fee`, with `collected` vs `outstanding` split) plus the
`system/counters.cancellationFees*` counters.

Small debts don't get in the way; once `outstanding` reaches
`outstandingLimit` (default 300 PKR) the account is **blocked** —
`createTrip` rejects the passenger and `placeBid` rejects the driver. They clear
it the same way locked drivers clear commission: transfer to Velocity's account
and upload a screenshot. `submitCancellationFeeSettlement` runs the identical
AI check (`decideProofOutcome`, the one auto-approve policy shared with
commission) and either clears the debt outright or files a
`commissionSettlements` doc with `kind: 'cancellation_fee'` into the **same**
admin review queue (dashboard → Settlements). AI-approve and admin-approve share
one money transaction (`applyCancellationFeeSettlement`), which clears only
`amountDue` — a fee charged *after* the transfer was sent survives it rather than
being silently forgiven.

**Travel Mate subscriptions:** wallet payments are debited at admin approval
(never held in escrow); manual Easypaisa/JazzCash/bank payments are sent
directly to the platform accounts shown in the app (from
`config/settlementAccounts`, admin-maintained) and verified by the approving
admin. Either way the approval writes a `travelmate_subscription` entry to
`platformLedger` and bumps `system/counters.travelMateRevenue`.

**Payout:** driver → `requestPayout(amount, method, account)` → backend checks
the **withdrawable** balance (not the whole balance — see below), reserves the
funds and queues a `payouts` doc with the driver's Easypaisa/JazzCash number or
bank IBAN → an admin disburses it from the platform account and calls
`markPayoutPaid`.

## The withdrawal ring-fence

**Money that came in through a payment gateway can never be paid back out.**
This is a regulatory boundary, not a product rule.

The State Bank of Pakistan defines e-money as value issued on receipt of funds
and "accepted as a means of payment by entities **other than the issuer**".
Issuing it needs an EMI licence and a Rs 200 million capital base. A balance a
driver tops up to pay Velocity's own commission is *not* e-money — only Velocity
accepts it, so it is a closed-loop prepayment for our own service. That holds
only while the money cannot come back out: a driver who could top up 10,000
through PayFast and withdraw 10,000 to Easypaisa would make us an unlicensed
payment service.

Two server-only counters on `wallets/{uid}` enforce it (`domain/walletFunds.ts`
is the single place that reads them):

| Field | Written by | Meaning |
|-------|-----------|---------|
| `toppedUpTotal` | `creditFromIntent` only | Lifetime gateway top-ups. Monotonic. Marks the wallet as holding gateway money. |
| `earned` | `completeTrip` (+), `requestPayout` (−), clamped by `creditFromIntent` | Ride earnings credited, less payouts already taken. |

`withdrawable = min(balance, earned)`; the rest is spendable only on Velocity's
own charges (commission, cancellation fees, subscriptions). Nothing else touches
either field — the `min` does the work, so there is no ring-fenced pot for the
nine places that debit a wallet to remember to decrement.

Two details that are easy to get wrong, both covered by
`payments/__tests__/walletRingFence.test.ts`:

- **Migration is automatic.** A wallet with `toppedUpTotal` absent or zero has
  provably never taken gateway money, so its whole balance stays withdrawable.
  `creditFromIntent` writes that number into `earned` on the first top-up, so no
  backfill script ever has to run against production.
- **`earned` is written as an exact value, never blind-incremented downward.**
  On a wallet where the field does not exist yet, a decrement would start from
  zero and leave it negative, locking a driver out of earnings they are owed.
- **Every top-up clamps `earned` down to the balance first.** A driver who
  earned 500 and paid 300 of it in commission is owed 200; without the clamp the
  next top-up would refloat `earned` above the balance and turn 300 rupees of
  gateway money into withdrawable cash.

⚠️ **Still open.** Two paths put a user's money in front of a third party and so
sit closer to the e-money line than the driver wallet does: wallet-paid rides
(`acceptBid` holds a passenger's balance and `completeTrip` settles it to a
driver) and the Travel Partner fare split (`travelMate/groups.ts` debits riders'
wallets and credits the booker's — a genuine user-to-user transfer). Both are
harmless while `walletTopupEnabled` is false, because no gateway money can reach
a passenger wallet. **Decide on them before flipping that flag.**

| Function | Caller | Purpose |
|----------|--------|---------|
| `createTopupIntent` | any user | Start a wallet top-up; returns a gateway redirect. |
| `paymentWebhook` (HTTP) | gateway | Verified callback that credits the wallet. |
| `mockConfirmTopup` | owner (mock only) | Dev shortcut to simulate a successful charge. |
| `requestPayout` | driver | Reserve balance and queue a cash-out to Easypaisa/JazzCash/bank. |
| `markPayoutPaid` | admin | Mark a payout disbursed. |
| `payCommission` | driver | Pay the cash-ride commission cycle from the wallet. |
| `submitCancellationFeeSettlement` | any user | Clear unpaid cancellation fees with a payment screenshot. |
| `getPaymentMethods` | any user | List connected instruments (display data only). |
| `createPaymentMethodSetup` | any user | Start connecting an Easypaisa/JazzCash/bank/card account. |
| `paymentMethodSetupPage` (HTTP) | browser | Hosted page that auto-submits the gateway's authorisation form. |
| `paymentMethodCallback` (HTTP) | gateway | Verified callback that stores the reusable token. |
| `mockConfirmPaymentMethod` | owner (mock only) | Dev shortcut to simulate a successful authorisation. |
| `setDefaultPaymentMethod` | any user | Choose which instrument one-tap top-ups use. |
| `deletePaymentMethod` | any user | Revoke at the gateway, then delete the token and the doc. |
| `topupWithSavedMethod` | any user | One-tap top-up charged against a saved instrument. |

## Platform books

- `platformLedger/{id}` — one append-only entry per realized platform revenue
  event (`ride_commission` wallet/cash, `cancellation_fee`,
  `cancellation_fee_settled`, `travelmate_subscription`). Admin-read only;
  written exclusively inside the money transactions above.
- `system/counters` — running totals (`walletCommissionCollected`,
  `cashCommissionCollected`, `cancellationFeesCharged`,
  `cancellationFeesCollected`, `cancellationFeesOutstanding`,
  `travelMateRevenue`, plus the existing trip totals) for the dashboard.
- `wallets/{uid}.outstanding` — unpaid cancellation fees this user owes
  Velocity. Server-written only; drives the booking/bidding block.
- `wallets/{uid}.toppedUpTotal` / `.earned` — the withdrawal ring-fence (above).
  Server-written only; `requestPayout` refuses anything above
  `min(balance, earned)`.
- `paymentMethods/{id}` — a connected instrument's display data (kind, masked
  tail, brand, default flag, status). Owner-readable, server-written only.
- `paymentMethodSecrets/{id}` — the gateway token that can charge it. **Denied
  to every client, owner and admin alike**; server-only via the Admin SDK.
- `paymentMethodSetups/{id}` / `paymentMethodSetupSecrets/{id}` — the
  authorisation handshake and its per-setup callback secret, same split.
- `config/settlementAccounts` — the platform's receiving accounts
  (`easypaisaNumber`, `jazzcashNumber`, `bankName`, `bankIban`, `accountTitle`),
  maintained by admins; the app shows the right one for manual transfers.
- `config/cancellationSettings` — `passengerFeeRate`, `driverFeeRate`,
  `outstandingLimit`. Admin-set from the dashboard; the app streams them so the
  fee it warns about is always the one the backend will charge.

## Providers

The provider is selected by the `PAYMENTS_PROVIDER` env var (default `mock`).
`backend/functions/src/payments/providers.ts` defines the interface and ships:

- **`mock`** — no real money; used in development and CI. The only provider that
  currently implements `TokenizingProvider`, so saved methods are exercisable
  end to end in dev.
- **`payfast`** — the single-contract aggregator: one merchant account fronting
  cards, JazzCash, Easypaisa, HBL Konnect and bank transfer.
- **`jazzcash`, `easypaisa`** — direct per-rail adapters.

### Which one to get

**PayFast first.** One contract covers four rails, where direct JazzCash +
Easypaisa means two onboardings for a narrower method list (no cards, no
Konnect). It also accepts individuals and unregistered businesses, so it does
not block on SECP registration. Apply at <https://getstarted.apps.net.pk/signup>
with NTN, CNIC and a utility bill. Keep the JazzCash/Easypaisa adapters as a
fallback — they need zero code if PayFast onboarding drags.

⚠️ **The PayFast adapter is sandbox-verified, not production-verified.**
gopayfast.com/docs is IP-gated, so its field names were confirmed empirically
against the sandbox on 2026-07-20 with a real card payment (PKR 150, err_code
000) rather than from documentation. The access-token path, the checkout field
set and the callback fields all checked out. **Two things still must be checked
against the integration pack that arrives with the merchant account before the
first live rupee:** the `SIGNATURE` formula (a payment succeeded with a
deliberately wrong value and with the field absent, so it may simply be ignored
— do not rely on it as security) and the **production base URL**.
`PAYFAST_BASE_URL` has no live default so the adapter fails closed rather than
posting real money at the sandbox. Success/failure is read from our own return
URLs plus the per-intent secret, never from guessed response field names.

### Going live

The JazzCash and Easypaisa adapters are fully implemented (Page Redirection v1.1
with HMAC-SHA256 secure-hash verification; Easypay hosted checkout with optional
server-to-server inquiry). For those, going live is **configuration only**:

1. Get merchant credentials from the JazzCash / Easypay merchant portals.
2. Provide them as function environment variables — the keys are listed in
   `backend/functions/.env.example`:
   - **CI (normal path):** create a `PAYMENTS_GATEWAY_ENV` GitHub Actions
     secret whose content is the filled-in `KEY=value` lines. The deploy
     workflow writes it to `backend/functions/.env.velocity-fe379` before
     `firebase deploy`, so the next merge to main ships it.
   - **Manual deploy:** copy `.env.example` to `.env.velocity-fe379` locally,
     fill it in (it is gitignored) and deploy.
3. Flip `JAZZCASH_ENV` / `EASYPAISA_ENV` to `live` when leaving the sandbox.
4. No webhook needs registering with the gateway — the signed checkout form
   already carries the callback URL (`paymentWebhook` with the per-intent
   secret token) on every transaction.

A provider appears in the app's top-up picker automatically once its
credentials are non-empty (`getPaymentOptions`). Until then, the **mock**
provider keeps the full wallet UX testable end-to-end.
