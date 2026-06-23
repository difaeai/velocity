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

### ✅ Stage 2 — Mobile app foundation (Expo) — _in progress_
- ✅ `apps/mobile`: Expo SDK 56 + TypeScript + Expo Router. Builds (typecheck +
  iOS/Android bundle), covered by CI.
- ✅ Firebase Auth wired with AsyncStorage persistence; email sign-in working.
- ✅ Role-aware shell: one binary renders the passenger or driver experience
  from the user's claim, with guarded route groups.
- ✅ Typed client SDK wrapping the callable functions (no direct privileged writes).
- ⏳ Remaining: phone/OTP auth (needs reCAPTCHA / dev build), and extracting the
  shared domain types into `packages/shared` consumed by app + backend.

### ✅ Stage 3 — Passenger experience
- ✅ Booking → bidding → match → track → invoice, wired to the backend.
- ⏳ Remaining: live map tiles (needs Maps key), ride history, ratings, FCM push.

### ✅ Stage 4 — Driver experience
- ✅ Onboarding with document upload to private Storage; go-online presence,
  incoming-request feed + bidding, trip progression, earnings ledger.
- ⏳ Remaining: continuous location streaming / turn-by-turn navigation.

### ✅ Stage 5 — Admin panel
- ✅ Next.js admin at the repo root (admin-claim gated): driver approvals, counters
  overview, payouts, safety desk. Deployed via Firebase App Hosting.

### ✅ Stage 6 — Payments & money-out
- ✅ Wallet top-ups (intent + verified webhook) and driver payouts behind Cloud
  Functions; provider abstraction (mock + JazzCash/Easypaisa stubs).
- ⏳ Remaining **(you)**: implement a live gateway adapter + secrets; refunds.

### ✅ Stage 7 — Hardening & launch — _in progress_
- ✅ Per-user rate limiting on abuse-prone callables; EAS build config; iOS
  permission strings; hardening + store-submission docs (`docs/HARDENING.md`).
- ⏳ Remaining **(you)**: enable App Check + Firestore TTL + phone auth in the
  console; privacy policy/terms; Apple/Google accounts + store submission.

## Build & ship reference (mobile, when we reach it)

```bash
# Expo Application Services handles iOS + Android builds and submission:
npx eas build --platform all
npx eas submit --platform all
```

App Check, signing, and store listings are configured in Stage 7.
