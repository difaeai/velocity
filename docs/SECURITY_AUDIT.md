# Security audit — 2026-09-18

Full review of the three shipping surfaces: the Android app, the iOS app, and
the web (marketing site, admin console, fleet portal), plus the Cloud Functions
and security rules all three depend on.

Everything below was checked against the code in this repository at
`b8c2de4`. Findings marked **FIXED** were fixed in the same pass and carry a
test; findings marked **OPEN** need a decision, a console change, or an
operational step that cannot be done from the repo.

Severity is about what an attacker gets, not how clever the bug is.

---

## Verification baseline

Everything here was run, not assumed:

| Surface | Check | Result |
| --- | --- | --- |
| Mobile | `tsc --noEmit` | clean |
| Mobile | `vitest run` | 122 passed |
| Backend | `tsc --noEmit`, `eslint src` | clean |
| Backend | emulator suite (`npm test`) | 542 passed |
| Rules | `firestore.rules.test.mjs` (emulator) | 29 passed |
| Web | `tsc --noEmit` | clean |

Two cross-checks written for this audit, both now permanent tests:

- every navigation target in `app/` and `src/` resolves to a real expo-router
  route (`apps/mobile/src/lib/__tests__/routes.test.ts`);
- every callable the clients invoke exists **and** is re-exported from
  `backend/functions/src/index.ts`, so it is actually deployed — 150/150 for the
  mobile app, 66/66 for the admin console.

---

## FIXED — Critical

### 1. The mock payment gateway could credit wallets in production

`backend/functions/src/payments/` — `index.ts`, `providers.ts`, `paymentMethods.ts`

`resolveProvider()` falls back to the **mock** provider whenever no real gateway
has credentials, which is the state every deployment is in until the PayFast
merchant account goes live. The mock reports every charge and every callback as
a success without talking to anybody.

In that state:

- `paymentWebhook` is an **unauthenticated** `onRequest`. Its mock branch was
  guarded only by `isMockProvider()`, so a plain
  `POST {"reference": "<intent id>", "success": true}` credited that intent's
  wallet — no signature, no callback token, no sign-in. It was also the one
  route into the wallet **not** behind the `walletTopupEnabled` flag, so the
  flag being off did not close it for intents that already existed.
- `mockConfirmPaymentMethod` (exported from `index.ts`, so deployed) minted a
  working saved instrument out of nothing, which `topupWithSavedMethod` would
  then charge successfully forever.

`MIN_TOPUP`/`MAX_TOPUP` are 100 and 100,000 PKR, and wallet balance pays for
real rides.

**Fix.** A new `mockGatewayAllowed()` in `providers.ts` returns true only under
the Firebase emulator (`FUNCTIONS_EMULATOR`, or `FIRESTORE_EMULATOR_HOST` for
the vitest harness). Neither can be true on a deployed function — pointing
`FIRESTORE_EMULATOR_HOST` at production would break every read and write on the
first request, so it cannot be set by accident and survive. It now gates the
webhook branch, `mockConfirmPaymentMethod`, and `MockProvider.chargeToken`
itself, so an instrument saved earlier cannot be charged either.

Covered by three tests in `payments/__tests__/paymentMethods.test.ts` that strip
the emulator signals and assert each path refuses.

---

## FIXED — High

### 2. Any signed-in user could read and write any pool ride's group chat

`firestore.rules` — `poolRides/{rideId}/chat/{msgId}`

The rule was `allow read: if isSignedIn()`, with a create rule that only checked
the sender was signing their own name. So any account could read, **and post
into**, the private conversation of a car full of strangers.

There was nothing to guess: `poolRides/{rideId}` is deliberately readable by
every signed-in user (it is a browsable offer), so listing the collection hands
over every ride id. The sibling `passengers` and `joinRequests` subcollections
were both correctly membership-gated — the chat was the one that was not, and it
is the one carrying the conversation.

**Fix.** Reads and writes now require membership of that car: the ride's own
`driverId`, or a `passengers/{uid}` seat doc (written only by the `joinPoolRide`
callable), or an admin. This matches how `trips/{tripId}/chat` was already
written.

Covered by `tests/firestore.rules.test.mjs` — verified to fail against the old
rule and pass against the new one.

---

## OPEN — High

### 3. App Check is not implemented

`docs/HARDENING.md` lists it under "To enable before launch" and
`apps/mobile/.env.example` describes access as enforced by "Firestore rules +
App Check". Only the first half is true: there is no `initializeAppCheck` call
anywhere in the mobile app or the admin console, and `@firebase/app-check`
appears only as a transitive dependency.

The Firebase Web API key is public by design and ships in every client, so
without App Check anything that can read the config can call the callables and
Firestore directly from a script. Auth, the rules, and the 36 rate-limit call
sites are currently the whole defence. They are a real defence — this is not an
open door — but it is one layer short of what the docs claim.

**Recommended.** Register Play Integrity (Android), App Attest (iOS) and
reCAPTCHA Enterprise (web), ship the client initialisation, watch the "verified
vs unverified" split in the console, and only then turn enforcement on. Until
then, correct the claim in `.env.example`.

### 4. Next.js 16.2.9 is inside a critical advisory range

`package.json` pins `next: 16.2.9`; the advisory range is
`9.3.4-canary.0 – 16.3.2`. Most of the chain does not apply to this deployment —
the RCE is Windows-hosted servers (App Hosting is Linux), the rewrite SSRF needs
an attacker-controlled destination host and every rewrite here is a static local
path, and there are no Server Actions. What does apply is the Image Optimization
API (`/_next/image`), which a Next server exposes regardless of whether the app
renders any `next/image` — and two of the advisories are RCE/DoS there.

**Recommended.** Upgrade to `next@16.3.3` or later (`npm audit` proposes
16.3.5), then run a production build and walk the console once. This is a minor
bump inside 16.x; it was deliberately **not** applied here because it cannot be
validated without a full build, and the running site was to be left working.

---

## OPEN — Medium

### 5. Any signed-in user can read any city-to-city trip chat

`firestore.rules` — `intercityChats/{tripId}/messages/{msgId}`

`allow read: if isSignedIn()`. Writes are safe (the `sendIntercityMessage`
callable verifies a confirmed booking), and the rule says why reads are not:
bookings are keyed by `bookingId`, so there is no per-uid document to gate
against. It is a knowingly-accepted trade-off rather than an oversight, but it
is still every intercity conversation readable by every account.

**Recommended, and why it was not done here.** Have `createIntercityBooking`
write `intercityChats/{tripId}/members/{uid}`, then gate reads on
`exists(...)` — the same shape as the pool-chat fix above. Unlike the pool case,
there is no existing per-uid document to key on, so tightening the rule before
backfilling members for existing confirmed bookings would take chat away from
people who legitimately have it. That backfill is an operational step, so this
is left as a two-part change to schedule rather than a rule to flip now.

### 6. The Special Rides module has no input validation and no rate limiting

`backend/functions/src/specialRides/`

`docs/HARDENING.md` claims "Input validation (zod) on every callable". 42 of 248
callables have no `parse`/`safeParse`, but 24 of those are genuinely
argument-free getters. The 18 that do read `request.data` unvalidated are
concentrated in two modules, and the whole of `specialRides` is one of them —
every callable in it destructures `request.data` raw, and none of them call
`rateLimit`.

Nothing there escalates privilege: each write is keyed to the caller's own uid,
`confirmSpecialRidesBooking` / `cancelSpecialRidesBooking` check host/renter
ownership, and `bookSpecialRidesCar` takes the price from the listing rather
than from the caller, so a booking price cannot be forged. What is exposed is
integrity and cost:

- `submitSpecialRidesApplication` / `updateSpecialRidesApplication` write
  arbitrary `carDetails`, `photos` and `documentUrls` objects straight to
  Firestore, and on approval the application is spread into
  `specialRidesListings`, which **every signed-in user can read**;
- `pickupDate` / `returnDate` are unchecked types, so a non-numeric pair yields
  `NaN` days and a `NaN` `totalPrice` on the booking document;
- with no rate limit, a signed-in account can create unbounded booking and
  application documents.

**Recommended.** Give the module the same treatment as the rest of the backend:
a zod schema per callable and a `rateLimit` on each write path.

### 7. Dependency vulnerabilities

Transitive, none introduced by this codebase's own code.

| Workspace | Worst | Notes |
| --- | --- | --- |
| `backend/functions` | 1 high, 12 moderate | `fast-xml-parser` entity expansion; `qs`/`body-parser` via `express`; `uuid` under `firebase-admin`. `npm audit fix --force` wants `firebase-admin@14` — a breaking major, do not run it blind. |
| root (web) | 1 critical, 3 high | the Next chain in §4, plus `sharp` (libvips/libheif) and `nanoid`. |
| `apps/mobile` | 11 high, 20 moderate | almost entirely `@expo/config-plugins` and friends — build-time tooling that does not ship inside the app. Lowest priority of the three. |

**Recommended.** Run the non-breaking `npm audit fix` in each workspace and
re-run the suites; handle `firebase-admin` and `next` as deliberate, tested
upgrades.

---

## OPEN — Low

### 8. Portal ids come from `Math.random()`

`backend/functions/src/franchise/portal.ts` — `mintPortalId()`

22 characters from a 55-character alphabet, built with `Math.random()`, which is
not cryptographically secure and is predictable from enough output.

This is low **only** because the design is right: the file states plainly that
the link is not a credential, and `requirePortalOwner()` re-derives ownership
from the signed-in uid on every single call, refusing suspended partners,
non-Pro tiers and expired plans — and returning an identical message whether the
link is wrong or belongs to somebody else, so it is not an oracle. The id is
obscurity, not authorisation.

**Recommended.** `crypto.randomBytes` is a two-line change and removes the
question entirely, which matters if the id is ever used for anything else.

### 9. Driver document uploads have no content-type restriction

`storage.rules` — `drivers/{driverId}/documents/{fileName}`

`allow write: if isOwner(driverId) && underSize(15)` — no `isImage()`, unlike
`cnic/`, `settlements/`, `partners/` and `businessAdPayments/`, which all cap
the type. Probably deliberate, since vehicle papers arrive as PDFs. The
consequence is that a verified driver can store up to 15 MB of arbitrary
content — HTML included — and serve it from a `firebasestorage.googleapis.com`
download URL. It is a different origin from `velocityrides.app`, so this is not
XSS against the app; it is a Google-domain URL that can host attacker content.

**Recommended.** Restrict to `image/*` plus `application/pdf` rather than
allowing everything.

### 10. Android has no verified App Links

No `assetlinks.json` under `public/.well-known/`, and the release manifest
registers only the custom `velocity://` scheme — no verified `https` intent
filter for `velocityrides.app`.

Two consequences. Share links open the browser rather than the app (the
`/link/[[...slug]]` page bounces to `velocity://`, so the flow works, but it is
a hop longer than it needs to be). And a custom scheme is claimable: another app
on the same device can register `velocity://` and receive whatever a link
carries, such as a pool invite code.

**Recommended.** Publish `assetlinks.json` with the Play App Signing SHA-256 and
add the verified `https` intent filter.

### 11. Firebase Web API key is unrestricted

Same key in `apps/mobile/src/config.ts`, `lib/config.ts` and `legacy-demo/app.js`.
This is **not** a leak — a Firebase Web API key is a project identifier and ships
in every client by design, and the repo says so correctly. But an unrestricted
key still allows Identity Toolkit calls from anywhere, which is the SMS-pumping
surface.

**Recommended.** Apply application restrictions in Google Cloud Console and keep
the SMS region allow-list to +92, as `docs/HARDENING.md` already says. This is
the same console task as the outstanding Maps key restriction.

---

## Checked and found sound

Recorded so the next audit does not re-derive them.

**Authorisation.** All 248 callables were enumerated and their guards read. Two
apparent gaps were false positives from the scan (`getFranchisePortal` and the
portal callables guard inside `requirePortalOwner`, which authenticates first
and compares the portal id second — the correct order). The one real gap,
Special Rides consulting a phantom `admins` collection, is covered under the
functional fixes below.

**Money.** Wallet credit runs through one idempotent transaction
(`payments/credit.ts`) that takes the amount from **our** intent and never from
the callback, so a forged amount cannot mint balance. The gateway webhook checks
a provider signature and, independently, a per-intent secret token stored where
rules deny all client access. Settled-amount mismatches are logged rather than
rejected, deliberately and correctly.

**Firestore rules.** Default-deny catch-all, 105 match blocks, role checks from
custom claims. The 17 collections readable by any signed-in user were each read
individually; all but the two chats named above are genuinely browsable data
(offers, listings, config, fare tables, community posts). `otpChallenges` is
explicitly `read, write: if false` with a note explaining that six digits do not
survive an offline attack.

**Storage rules.** Default-deny, auth everywhere, size caps, and KYC/payment
documents readable only by their owner and admins.

**Maps proxy.** The billable Google key never leaves the server. Every callable
requires auth, is rate limited, is zod-validated, and hits a fixed Google
endpoint — no user-controlled URL, so no SSRF.

**Admin console.** The `isAdmin` gate in `app/(app)/dashboard/layout.tsx` is
client-side, which is correct here: it hides UI, and the actual authority is the
custom-claim check in the Firestore rules and `requireAdmin` in the callables.

**iOS.** ATS is at its defaults with no arbitrary-loads exemption; the only
registered URL scheme is the Firebase reversed client id; all six usage strings
are present; `NSUserTrackingUsageDescription` is correctly **absent** while iOS
ads are compiled out, which is what keeps the binary submittable.

**Android.** Every exported component is a standard library one and each is
permission-guarded (`BIND_JOB_SERVICE`, `DUMP`, `c2dm.permission.SEND`, …); only
`MainActivity` is exported unguarded, as a launcher must be. Permissions are
three and all used. R8 minification is on for release builds.

**Secrets.** A pattern scan across every tracked file found no private keys, no
service-account JSON (correctly gitignored and untracked) and no provider
credentials — only the public Firebase Web key of §11.

**WhatsApp webhook.** HMAC verified with `timingSafeEqual`, rejecting unsigned
requests, wrong secrets and truncated digests, with tests for each.

---

## Fixed in the same pass — broken features, not vulnerabilities

Found while exercising the app; recorded here because two of them touch money
and one touches an approval queue.

1. **Driver commission settlement led nowhere.** `WalletScreen.tsx` sent a
   locked driver to `/driver`, which is not a route — the app only has
   `/driver/home`. This is the button a driver presses to get un-locked and earn
   again. Now covered by the route test above.
2. **Two push notifications did nothing when tapped.** The backend sends
   `screen: 'trip'` (scheduled ride found a driver) and `screen: 'intercityTrip'`
   (city-to-city booking confirmed); `routeForNotification` had never been told
   about either, so both returned null.
3. **The whole Special Rides admin surface was dead**, in four independent ways:
   Approve and Reject POSTed to `/api/admin/special-rides/...` (this project has
   no `app/api` directory at all — 404, "Failed to approve"); Suspend and
   Reactivate wrote to `specialRidesListings` from the browser, which the rules
   refuse for everyone including admins; the photo grid used `next/image` with
   no `images` config in `next.config.ts`, which throws on any external
   hostname; and the backend callables behind it gated on an `admins` collection
   that no code has ever written and the rules deny. All four fixed — the
   callables now use `requireAdmin` (the custom claim the console signs in with)
   and the console calls them through `lib/api.ts`.
4. **"Find my Customers" opened slowly**, as reported: the demo offer picture was
   fetched from `velocityrides.app` on every mount and is now bundled, and the
   price list is now served through the stale-while-revalidate cache with the
   offer fields no longer held behind it.
