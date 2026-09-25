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

Add the same policy on **`userPresence.expireAt`**. This one is not just tidying:
`userPresence` holds each user's last known position for the home-map dots, and
the TTL is what makes presence lapse when somebody stops opening the app. Without
it, a location written once stays in the collection indefinitely.

Add it on **`otpChallenges.expireAt`** too. These are the WhatsApp sign-in
challenges (see [WHATSAPP_OTP.md](WHATSAPP_OTP.md)). The TTL is housekeeping
rather than security — a challenge is dead five minutes in by its own
`validUntilMs`, and single-use besides — but without the policy every login the
platform has ever served accumulates as a document nobody reads.

**`mapsCache.expireAt` is not a console step — run the script** *(done 2026-09-25,
policy ACTIVE)*:

```
node scripts/set-firestore-ttl.mjs
```

This one is a licence obligation rather than housekeeping. `mapsCache` holds
coordinates and route polylines bought from Google, and the Maps Platform terms
allow caching latitude and longitude "for up to 30 consecutive calendar days,
after which Customer must delete the cached latitude and longitude values."

It cannot be done in the console, and not for a trivial reason: the TTL form only
offers collections that already hold documents, and this policy has to exist
*before* the first address is cached. The Firestore Admin API has no such
restriction, which is what the script uses. Running it again is safe — it reports
an existing policy and changes nothing.

The app does not depend on the policy: `sweepMapsCache` deletes expired
coordinates daily and every read re-checks `expireAt` before serving anything. The
policy is the cheaper way to do the same thing first, and it is the native answer
if Google ever asks.

**Never add a TTL policy to `mapsPlaceIds` or `velocityLocations`.** The script
asserts both are policy-free and fails if they are not. `mapsPlaceIds` holds place
IDs and nothing else — no coordinates, no addresses — and place IDs are expressly
exempt from the caching restrictions, which is what makes a repeat address lookup a
$5-per-1,000 call instead of a $32 one. `velocityLocations` holds coordinates
measured by our own drivers' phones, so it is ours outright and expiring it would
destroy our own data. See `backend/functions/src/lib/mapsCache.ts` and
`backend/functions/src/locations/registry.ts`.

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
- Enable **Phone** sign-in (primary for PK) + configure the SMS region allow-list
  so Pakistan (+92) is permitted.
- Enable **Email/Password** if keeping it for admins.

### Phone sign-in is natively verified **(you — one required step)**
Verification runs through `@react-native-firebase/auth`, so Android attests the app
with **Play Integrity** instead of solving a reCAPTCHA in a hidden WebView. That
unattested WebView traffic was why Firebase's anti-abuse throttle refused real
users with `auth/error-code:-39`.

For attestation to actually succeed you **must** register the app's signing
certificate fingerprints in **Firebase Console → Project Settings → Your apps →
Android → Add fingerprint**:
- the **Play App Signing** SHA-256 (Play Console → Test and release → App signing)
  — this is the one that matters for released builds;
- the upload/debug SHA-1 + SHA-256 for anything you install by hand.

Without a matching fingerprint, Play Integrity fails and the native SDK falls back
to a reCAPTCHA challenge — working, but back to the traffic profile that gets
throttled. Note that sideloaded builds (an AAB/APK you install directly rather than
through Play) can still hit that fallback even when configured correctly, so judge
this from a Play track, not from a local install.

Use **Phone numbers for testing** (Console → Authentication → Sign-in method) for
development. Test numbers are exempt from the anti-abuse throttle, so they never
burn quota and never get the whole project rate-limited.

The client keeps a local send brake regardless (`src/lib/otpThrottle.ts`) — native
attestation makes the throttle far rarer, not impossible.

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
See [`DEPLOY.md`](DEPLOY.md). The admin app is at the repo root, so App Hosting
builds it automatically — no root-directory change needed.
