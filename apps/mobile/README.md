# Velocity — Mobile App (Expo)

> **Placeholder — scaffolded in Stage 2** (see [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md)).

One React Native (Expo) app for **both passengers and drivers**, shippable to the
**App Store** and **Google Play**. The experience shown is chosen at runtime from
the signed-in user's `role` custom claim.

## Planned stack
- Expo (managed) + TypeScript
- Expo Router (file-based navigation)
- Firebase JS SDK (Auth, Firestore reads, Functions, Storage, Messaging)
- `react-native-maps` for maps & live tracking
- EAS Build / EAS Submit for store delivery

## Key principle
The app **never writes privileged data directly**. All money/role/trip mutations
go through the backend callable functions in `backend/functions`. The app reads
Firestore (scoped by the security rules) and calls functions for actions.

## Planned structure
```
apps/mobile/
├── app/                 # Expo Router routes
│   ├── (auth)/          # phone/OTP sign-in
│   ├── (passenger)/     # booking, bidding, tracking, wallet
│   └── (driver)/        # onboarding, online, bids, navigation, ledger
├── src/
│   ├── api/             # typed wrappers around callable functions
│   ├── auth/            # session + role-claim handling
│   └── ui/              # shared components
└── app.json             # Expo config (App Check, permissions, store metadata)
```
