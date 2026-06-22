# Architecture

## Components

| Component | Tech | Responsibility |
|-----------|------|----------------|
| **Mobile app** | React Native (Expo) | Single app for passengers **and** drivers. Role is resolved at runtime from the signed-in user's custom claim, which selects the passenger or driver experience. |
| **Admin panel** | Web (React) | Driver approvals, live operations, finance, safety desk. Restricted to `admin` role. |
| **Backend** | Firebase Cloud Functions (Node 22 + TypeScript) | The **only** writer of money, roles, verification and trip state. Exposes callable functions; runs auth triggers. |
| **Database** | Cloud Firestore | Persistent store. Locked down by `firestore.rules`. |
| **Auth** | Firebase Auth (phone/OTP recommended for PK) | Identity. Roles are carried as **custom claims** set by the backend. |
| **Storage** | Cloud Storage | Avatars (public-read) and KYC/vehicle documents (private). |

## Single app, two experiences

There is exactly one mobile binary. After sign-in the app reads the user's
`role` claim:

- `passenger` → booking, bidding, tracking, wallet, safety.
- `driver` → onboarding, go-online, incoming bids, navigation, earnings ledger.
- A passenger can *become* a driver by submitting onboarding; an admin approval
  flips their claim to `driver`, and the app reveals the driver experience.

This keeps store submission simple (one app each for iOS/Android) while serving
both audiences, exactly as requested.

## Roles & authorisation

Roles live in Firebase Auth **custom claims** (`request.auth.token.role`), which
**only the backend can set** (`users/setUserRole`, `drivers/approveDriver`).
Security rules and callable guards both read this claim, so a client can never
escalate its own privileges.

```
passenger  → default for every new account
driver     → granted by admin approval after onboarding
admin      → granted by another admin (bootstrap the first one manually, see SECURITY.md)
```

## Data model (Firestore)

| Path | Who writes | Notes |
|------|-----------|-------|
| `users/{uid}` | backend + owner (safe fields only) | Profile + `role` mirror + `activeTripId`. |
| `drivers/{uid}` | backend + owner (presence only) | Verification, rating, vehicle. Driver may update only `online`/`lastLocation`/`heading`/`lastSeenAt`. |
| `trips/{tripId}` | **backend only** | Server-authoritative state machine. |
| `trips/{tripId}/bids/{bidId}` | **backend only** | Driver bids; readable by the passenger + bidder. |
| `wallets/{uid}` + `/transactions` | **backend only** | Balances + immutable ledger. |
| `system/counters` | **backend only** | Platform revenue/commission/payout/trips. Admin-readable. |
| `safetyEvents/{id}` | **backend only** | SOS / route deviations. Reporter + admin readable. |
| `auditLogs/{id}` | **backend only** | Privileged-action trail. Admin-readable. |
| `config/{doc}` | admin | Public app config (fares, ride types). Any signed-in user reads. |

## Trip lifecycle (state machine)

```
requested ──acceptBid──▶ matched ──▶ arriving ──▶ arrived ──▶ in_progress ──▶ completed
    │                       │            │            │
    └───────────── cancelTrip (passenger or driver) ─┘     completeTrip → settlement
```

Every transition is a callable function that validates **who** the caller is and
whether the **(from → to)** edge is legal. `completeTrip` is the only place a
settlement (gross, 10% commission, driver payout, passenger share) is computed,
and it updates the driver wallet, the ledger and the platform counters in a
single Firestore transaction.

## Backend functions

| Function | Caller | Purpose |
|----------|--------|---------|
| `onUserCreate` / `onUserDelete` | (auth trigger) | Provision/clean up profile, wallet, default role. |
| `setUserRole` | admin | Assign any role. |
| `submitDriverOnboarding` | any user | Submit KYC/vehicle → status `pending`. |
| `approveDriver` / `rejectDriver` | admin | Verify or reject/suspend; grant/revoke driver role. |
| `createTrip` | passenger | Open a ride request (fare validated against bounds). |
| `placeBid` | approved+online driver | Bid on an open request. |
| `acceptBid` | passenger | Lock fare, assign driver. |
| `updateTripStatus` | assigned driver | Advance arriving → arrived → in_progress. |
| `cancelTrip` | participant | Cancel a not-yet-started trip. |
| `completeTrip` | assigned driver | Settle money, finish trip. |
| `raiseSafetyEvent` | participant | SOS / route-deviation alert. |
| `resolveSafetyEvent` | admin | Close an alert. |

Region is pinned to **`asia-south1`** (Mumbai), the closest GCP region to
Pakistan, to reduce matching/tracking latency.
