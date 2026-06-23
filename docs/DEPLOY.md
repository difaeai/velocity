# Deploying Velocity

## Admin panel — Firebase App Hosting (web)

The admin panel is a **Next.js app at the repository root**, so Firebase App
Hosting detects and builds it automatically — **no backend configuration or root
directory change needed**. Every push to the connected branch builds and deploys.

- `apphosting.yaml` (repo root) holds the runtime config.
- The Firebase Web config is injected automatically as `FIREBASE_WEBAPP_CONFIG`.
- The other workspaces (`apps/mobile`, `backend/functions`, `tests`) are separate
  packages that App Hosting ignores.

> The admin panel is gated to the `admin` role — bootstrap the first admin once
> (below), then manage the rest from the panel.

## First admin (bootstrap)

There is no built-in admin account (by design). Create a user in **Firebase
Console → Authentication**, then grant it the `admin` claim once. Easiest in
**Google Cloud Shell** (already authenticated, no local setup):

```bash
cd ~ && git clone https://github.com/difaeai/velocity.git
npm install firebase-admin
node velocity/scripts/grant-admin.mjs you@example.com
```

Then **sign out and back in** to the admin panel. All other admins are managed
from inside the panel afterwards.

## Backend — Cloud Functions

Requires the **Blaze** (pay-as-you-go) plan. Run from the repo root:

```bash
cd backend/functions && npm install && cd ..
firebase deploy --only functions --project velocity-fe379
```

## Security rules & indexes

```bash
firebase deploy --only firestore:rules,storage,firestore:indexes --project velocity-fe379
```

## Mobile app — Expo / EAS

```bash
cd apps/mobile
npx eas build --platform all      # iOS + Android builds
npx eas submit --platform all     # App Store + Play Store
```

App Store / Play Store submission requires Apple Developer and Google Play
Console accounts; phone/OTP auth and App Check are enabled in the Firebase
console (tracked in `docs/ROADMAP.md`).
