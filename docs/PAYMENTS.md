# Payments

Wallet top-ups and driver payouts. **All money movement is server-authoritative
and transactional** — wallets are never client-writable (enforced by the rules).

## Flow

**Top-up:** app → `createTopupIntent(amount)` → backend creates a `paymentIntents`
doc + asks the provider to charge → user pays on the gateway → the gateway calls
`paymentWebhook` → the backend verifies it and **credits the wallet idempotently**.

**Payout:** driver → `requestPayout(amount)` → backend checks balance, reserves
the funds and queues a `payouts` doc → an admin disburses it (gateway/bank) and
calls `markPayoutPaid`.

| Function | Caller | Purpose |
|----------|--------|---------|
| `createTopupIntent` | any user | Start a wallet top-up; returns a gateway redirect. |
| `paymentWebhook` (HTTP) | gateway | Verified callback that credits the wallet. |
| `mockConfirmTopup` | owner (mock only) | Dev shortcut to simulate a successful charge. |
| `requestPayout` | driver | Reserve balance and queue a cash-out. |
| `markPayoutPaid` | admin | Mark a payout disbursed. |

## Providers

The provider is selected by the `PAYMENTS_PROVIDER` env var (default `mock`).
`backend/functions/src/payments/providers.ts` defines the interface and ships:

- **`mock`** — no real money; used in development and CI.
- **`jazzcash`, `easypaisa`** — placeholder adapters that throw until configured.

### Going live

1. Implement `createCharge` (gateway "initiate" API) and `verifyWebhook`
   (HMAC / secure-hash check) in the adapter.
2. Store gateway credentials as **Cloud Functions secrets** (never commit them):
   ```bash
   firebase functions:secrets:set JAZZCASH_MERCHANT_ID
   firebase functions:secrets:set JAZZCASH_PASSWORD
   firebase functions:secrets:set JAZZCASH_INTEGRITY_SALT
   ```
   and bind them on the relevant functions.
3. Set `PAYMENTS_PROVIDER=jazzcash` (or `easypaisa`) and deploy.
4. Configure the gateway's webhook URL to the deployed `paymentWebhook` endpoint.

> Until then, the **mock** provider keeps the full wallet UX testable end-to-end.
