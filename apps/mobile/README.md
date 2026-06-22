# Velocity — Mobile App (Expo)

One React Native (Expo SDK 56) app for **both passengers and drivers**,
shippable to the **App Store** and **Google Play**. The experience is chosen at
runtime from the signed-in user's `role` custom claim (set by the backend).

## Stack
- Expo SDK 56 · React Native 0.85 · React 19 · TypeScript
- Expo Router (file-based navigation)
- Firebase JS SDK (Auth, Firestore, Functions) — works in Expo Go and dev builds
- Auth persisted with AsyncStorage

## Run

```bash
npm install
npx expo start          # then press i / a, or scan the QR with Expo Go
```

Config defaults to the `velocity-fe379` Firebase project; override per
environment with `EXPO_PUBLIC_*` vars (see `.env.example`). For **email/password**
sign-in to work, enable that provider in Firebase Auth.

## Verify (what CI runs)

```bash
npm run typecheck       # tsc --noEmit
npm run export          # expo export -p ios -p android (bundles the app)
```

## Structure

```
app/                     # Expo Router routes
├── _layout.tsx          # providers (SafeArea + Auth) + Slot
├── index.tsx            # routes by auth/role → auth | passenger | driver
├── auth/sign-in.tsx     # email sign-in (phone/OTP comes next stage)
├── passenger/home.tsx   # passenger experience (guarded)
└── driver/home.tsx      # driver experience (guarded, role === 'driver')
src/
├── firebase.ts          # Firebase init (auth persistence, asia-south1 functions)
├── config.ts            # Firebase config + brand colors
├── auth/AuthContext.tsx # user + role-claim state
├── api/client.ts        # typed wrappers around backend callables
├── domain/types.ts      # client mirror of the backend domain model
└── ui/components.tsx     # shared Button / Card / Badge
```

## Key principle
The app **never writes privileged data directly** (money, roles, trip state).
The security rules forbid it; every action goes through a backend callable in
`src/api/client.ts`.

## Next stages (see `../../docs/ROADMAP.md`)
Phone/OTP auth, maps + live tracking, the booking→bidding→trip flow, driver
onboarding with document upload, push notifications, and App Check.
