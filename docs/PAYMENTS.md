# Payments

Wallet top-ups, ride payments, commission collection and driver payouts.
**All money movement is server-authoritative and transactional** — wallets are
never client-writable (enforced by the rules).

## Flow

**Top-up:** app → `createTopupIntent(amount)` → backend creates a `paymentIntents`
doc + asks the provider to charge → user pays on the gateway → the gateway calls
`paymentWebhook` → the backend verifies it and **credits the wallet idempotently**.
Gateway settlement (where the customer's money physically lands) is the JazzCash /
Easypaisa / bank **merchant account registered with the gateway**.

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
zero.

**Travel Mate subscriptions:** wallet payments are debited at admin approval
(never held in escrow); manual Easypaisa/JazzCash/bank payments are sent
directly to the platform accounts shown in the app (from
`config/settlementAccounts`, admin-maintained) and verified by the approving
admin. Either way the approval writes a `travelmate_subscription` entry to
`platformLedger` and bumps `system/counters.travelMateRevenue`.

**Payout:** driver → `requestPayout(amount, method, account)` → backend checks
balance, reserves the funds and queues a `payouts` doc with the driver's
Easypaisa/JazzCash number or bank IBAN → an admin disburses it from the platform
account and calls `markPayoutPaid`.

| Function | Caller | Purpose |
|----------|--------|---------|
| `createTopupIntent` | any user | Start a wallet top-up; returns a gateway redirect. |
| `paymentWebhook` (HTTP) | gateway | Verified callback that credits the wallet. |
| `mockConfirmTopup` | owner (mock only) | Dev shortcut to simulate a successful charge. |
| `requestPayout` | driver | Reserve balance and queue a cash-out to Easypaisa/JazzCash/bank. |
| `markPayoutPaid` | admin | Mark a payout disbursed. |
| `payCommission` | driver | Pay the cash-ride commission cycle from the wallet. |

## Platform books

- `platformLedger/{id}` — one append-only entry per realized platform revenue
  event (`ride_commission` wallet/cash, `travelmate_subscription`). Admin-read
  only; written exclusively inside the money transactions above.
- `system/counters` — running totals (`walletCommissionCollected`,
  `cashCommissionCollected`, `travelMateRevenue`, plus the existing trip
  totals) for the dashboard.
- `config/settlementAccounts` — the platform's receiving accounts
  (`easypaisaNumber`, `jazzcashNumber`, `bankName`, `bankIban`, `accountTitle`),
  maintained by admins; the app shows the right one for manual transfers.

## Providers

The provider is selected by the `PAYMENTS_PROVIDER` env var (default `mock`).
`backend/functions/src/payments/providers.ts` defines the interface and ships:

- **`mock`** — no real money; used in development and CI.
- **`jazzcash`, `easypaisa`** — placeholder adapters that throw until configured.

### Going live

The adapters are fully implemented (JazzCash Page Redirection v1.1 with
HMAC-SHA256 secure-hash verification; Easypaisa hosted checkout with optional
server-to-server inquiry). Going live is **configuration only**:

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
