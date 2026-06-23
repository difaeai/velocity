# Deploying Velocity

## Admin panel — Firebase App Hosting (web)

The admin panel is a **Next.js app at the repository root**, so Firebase App
Hosting detects and builds it automatically — **no backend configuration or root
directory change needed**. Every push to the connected branch builds and deploys.

- `apphosting.yaml` (repo root) holds the runtime config.
- The Firebase Web config is injected automatically as `FIREBASE_WEBAPP_CONFIG`.
- The other workspaces (`apps/mobile`, `backend/functions`, `tests`) are separate
  packages that App Hosting ignores.

> The admin panel is gated to the `admin` role. Bootstrap the first admin once
> (see `docs/SECURITY.md`), then manage the rest from the panel.

## Backend — Cloud Functions

```bash
firebase deploy --only functions          # requires the Blaze plan
```

## Security rules & indexes

```bash
firebase deploy --only firestore:rules,storage:rules,firestore:indexes
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
