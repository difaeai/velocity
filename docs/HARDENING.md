# Hardening & Launch

Production-readiness checklist for Velocity. Items marked **(you)** require
console access or external accounts and can't be done from the repo.

## In place

- **Default-deny security rules** with role-based access and field whitelists
  (Firestore + Storage), covered by 13 emulator tests in CI.
- **Server-authoritative money** (wallets/counters server-write only; settlement,
  top-ups and payouts in transactions).
- **Input validation** (zod) on every callable.
- **Rate limiting** — per-user fixed-window limiter (`lib/ratelimit.ts`) on
  `createTrip`, `placeBid`, `createTopupIntent`, `raiseSafetyEvent`. Counters live
  in the server-only `rateLimits` collection.
- **Secrets hygiene** — `.gitignore` blocks service-account JSON and `.env`;
  gateway keys go in Functions secrets.

## To enable before launch

### Firestore TTL **(you)**
Add a TTL policy on `rateLimits.expireAt` (and optionally `paymentIntents`) so
counters self-delete:
Firebase Console → Firestore → TTL → add policy on collection `rateLimits`,
field `expireAt`.

### Firebase App Check **(you + code)**
Stops traffic from anything other than your genuine apps.
1. Register providers: **Play Integrity** (Android), **App Attest** (iOS),
   **reCAPTCHA Enterprise** (admin web).
2. Mobile: use a development build with `@react-native-firebase/app-check` (or a
   custom provider) and initialise on startup. Admin: `initializeAppCheck` with
   `ReCaptchaEnterpriseProvider` using your site key (`NEXT_PUBLIC_RECAPTCHA_KEY`).
3. Turn on **enforcement** for Cloud Functions, Firestore and Storage once both
   apps report healthy.

### Auth providers **(you)**
- Enable **Phone** sign-in (primary for PK) + configure reCAPTCHA/SMS region
  allow-list; swap the email dev sign-in for phone/OTP.
- Enable **Email/Password** if keeping it for admins.

### Monitoring **(you)**
- Cloud Functions error reporting + alerts on `safetyEvents` (SOS).
- Budget alerts on the Blaze plan.

## Store submission **(you)**

Mobile builds use EAS (`apps/mobile/eas.json`):
```bash
cd apps/mobile
npx eas build --platform all       # production builds
npx eas submit --platform all      # App Store + Play Store
```
Requirements:
- **Apple Developer** account ($99/yr) + App Store Connect app record.
- **Google Play Console** account ($25 once) + app record.
- Store listing: icon/screenshots, description, **privacy policy URL**, data-safety
  form (location, payments, identity docs), age rating.
- iOS permission strings are set in `app.json` (`ios.infoPlist`).

## Admin panel deploy
See [`DEPLOY.md`](DEPLOY.md) — set the App Hosting **Root directory** to `apps/admin`.
