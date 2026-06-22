# Deploying Velocity

## Admin panel — Firebase App Hosting (web)

The admin panel (`apps/admin`, Next.js) is deployed with **Firebase App Hosting**.
Because this is a monorepo, App Hosting must be told where the web app lives.

### One-time setup (required)

App Hosting builds whatever is at the backend's **root directory**. The repo root
has no web app, so detection fails (`package.json not found`). Point the backend
at `apps/admin`:

- **Firebase Console** → **App Hosting** → your backend → **Settings** →
  **Deployment** → set **Root directory** to `apps/admin` → Save.
- or **CLI**, when creating the backend:
  ```bash
  firebase apphosting:backends:create --project velocity-fe379
  # when prompted for the root directory, enter: apps/admin
  ```

After that, every push to the connected branch builds and deploys the admin app.
`apphosting.yaml` (repo root) holds the runtime config; the Firebase Web config is
injected automatically as `FIREBASE_WEBAPP_CONFIG`.

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
