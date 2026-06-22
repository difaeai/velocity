# Roadmap

Reaching a store-ready, secure ride-hailing platform is a staged effort. This is
the plan; each stage is independently shippable and verifiable.

### ✅ Stage 1 — Secure foundation (this stage)
- Monorepo structure.
- Locked-down Firestore + Storage security rules (default-deny, role-based).
- Cloud Functions backend: auth/roles, driver onboarding + admin verification,
  full trip state machine, **server-authoritative** money settlement, safety
  events. Compiles, lints, and rules are covered by passing emulator tests.
- Architecture + security documentation.

### ⏭️ Stage 2 — Mobile app foundation (Expo)
- `apps/mobile`: Expo + TypeScript + Expo Router.
- Firebase Auth (phone/OTP) sign-in/up.
- Role-aware shell: passenger vs driver experience from the user's claim.
- Typed client SDK wrapping the callable functions (no direct privileged writes).
- Shared domain types extracted into `packages/shared` and consumed by app +
  backend.

### ⏭️ Stage 3 — Passenger experience
- Maps + places (Google Maps SDK / `react-native-maps`), live driver tracking.
- Booking → bidding → match → track → invoice, wired to the backend.
- Wallet view, ride history, ratings.
- Push notifications (FCM) for bids/status.

### ⏭️ Stage 4 — Driver experience
- Onboarding with document upload to the private Storage paths.
- Go-online presence + location streaming, incoming-bid handling, navigation,
  earnings ledger.

### ⏭️ Stage 5 — Admin panel
- `apps/admin`: React web app (admin-claim gated).
- Driver approvals, live operations map, finance, safety desk — reading the same
  Firestore, evolving the look-and-feel from `legacy-demo/`.

### ⏭️ Stage 6 — Payments & money-out
- Pakistan payment rails (e.g. JazzCash/Easypaisa/card via a PCI-compliant
  gateway) behind Cloud Functions; gateway keys in Functions secrets.
- Driver payouts, refunds, reconciliation against `system/counters`.

### ⏭️ Stage 7 — Hardening & launch
- Firebase App Check (Play Integrity / App Attest) on app + backend.
- Rate limiting, abuse controls, monitoring/alerting.
- Legal: privacy policy, terms, data-retention.
- EAS Build + store assets; **Play Store** and **App Store** submission.

## Build & ship reference (mobile, when we reach it)

```bash
# Expo Application Services handles iOS + Android builds and submission:
npx eas build --platform all
npx eas submit --platform all
```

App Check, signing, and store listings are configured in Stage 7.
