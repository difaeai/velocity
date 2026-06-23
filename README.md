# Velocity 🚗🏍️

AI-assisted ride-hailing and smart ride-pooling platform for Pakistan
(formerly the *ShareRide Pakistan* prototype).

This repository is being rebuilt from a browser prototype into a **production
system**:

- **One mobile app** (React Native / Expo) containing **both** the passenger and
  the driver experience, shippable to the **App Store** and **Google Play**.
- **One admin panel** (web) for operations, driver approvals, finance and safety.
- **A secure backend** on **Firebase Cloud Functions (Node + TypeScript)** that
  is the single source of truth for money, roles and trip state.

> **Status — Stage 1 (Secure Foundation) complete.** The backend, the security
> rules and the data model are in place and verified. The mobile app and admin
> panel are scaffolded next — see [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Repository layout

```
velocity/
├── firebase.json            # Firebase project config (rules, functions, emulators)
├── .firebaserc              # Project alias → velocity-fe379
├── firestore.rules          # 🔒 Firestore security rules (default-deny, role-based)
├── storage.rules            # 🔒 Cloud Storage security rules
├── firestore.indexes.json   # Composite indexes
├── backend/
│   └── functions/           # Cloud Functions (TypeScript) — the secure backend
│       └── src/
│           ├── domain/      # Shared types + server-authoritative fare logic
│           ├── lib/         # Admin SDK init + auth/role guards
│           ├── users/       # Provisioning + role management
│           ├── drivers/     # Onboarding + admin verification
│           ├── trips/       # Trip state machine + money settlement
│           └── safety/      # SOS / route-deviation events
├── apphosting.yaml         # Firebase App Hosting runtime config
├── app/ components/ lib/    # Next.js admin panel (at repo root → App Hosting builds it)
├── apps/
│   └── mobile/              # Expo app (passenger + driver)
├── tests/                   # Security-rules unit tests (Firebase emulator)
├── docs/                    # ARCHITECTURE · SECURITY · DEPLOY · PAYMENTS · HARDENING · ROADMAP
└── legacy-demo/             # The original HTML/JS prototype, kept as a UX reference
```

---

## Why the original demo was replaced

`legacy-demo/` is the previous single-file browser prototype. It is a great
**UX reference**, but it was a *simulation*, not a product:

- It ran entirely in the browser with **no authentication**.
- It talked to Firestore in **“test mode”**, meaning the entire database was
  **readable and writable by anyone on the internet**.
- **Money, driver approvals and trip state were decided on the client**, so they
  could be forged trivially.

[`docs/SECURITY.md`](docs/SECURITY.md) lists every loophole and how this stage
closes it.

---

## Getting started (backend)

Prerequisites: Node 22, a Firebase project (already `velocity-fe379`), and for
deployment the **Blaze** plan (Cloud Functions requires it).

```bash
# Install backend deps
cd backend/functions && npm install

# Type-check / build / lint
npm run build
npm run lint

# Run everything locally against the emulator suite
npm run serve          # functions + firestore + auth + storage emulators
```

### Run the security-rules tests

```bash
cd tests && npm install && npm test    # boots the Firestore emulator, runs the suite
```

### Deploy (when ready)

```bash
firebase deploy --only firestore:rules,storage:rules    # ship the locked-down rules
firebase deploy --only functions                        # ship the backend
```

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full plan through app-store
submission.
