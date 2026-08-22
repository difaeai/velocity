# Velocity — Complete Feature Documentation

Every feature in the platform, what it does, who it is for, and the rules the
backend actually enforces. Written from the shipped code (`backend/functions/src`,
`apps/mobile`, the Next.js admin console at the repo root), not from a plan.

Companion documents: [ARCHITECTURE](ARCHITECTURE.md) · [PAYMENTS](PAYMENTS.md) ·
[SECURITY](SECURITY.md) · [HARDENING](HARDENING.md) · [ADMIN](ADMIN.md) ·
[DEPLOY](DEPLOY.md)

---

## Table of contents

1. [What Velocity is](#1-what-velocity-is)
2. [Accounts, identity and roles](#2-accounts-identity-and-roles)
3. [City rides — the core product](#3-city-rides--the-core-product)
4. [Ride pooling](#4-ride-pooling)
5. [En-route pickups and driver routes](#5-en-route-pickups-and-driver-routes)
6. [The driver experience](#6-the-driver-experience)
7. [City to City (intercity seats)](#7-city-to-city-intercity-seats)
8. [Couriers](#8-couriers)
9. [Business — Business delivery and “Find your Customers”](#9-business--business-delivery-and-find-your-customers)
10. [Earn with Velocity — the Partner Program](#10-earn-with-velocity--the-partner-program)
    - [10.11 The Pro fleet portal (web)](#1011-the-pro-fleet-portal-web)
11. [Special Rides — rent your car out](#11-special-rides--rent-your-car-out)
12. [Franchises](#12-franchises)
13. [Travel Partner](#13-travel-partner)
14. [Money — wallet, commission, settlement, payouts](#14-money--wallet-commission-settlement-payouts)
15. [Ads and monetisation](#15-ads-and-monetisation)
16. [Notifications](#16-notifications)
17. [Safety](#17-safety)
18. [Voice booking](#18-voice-booking)
19. [Admin console](#19-admin-console)
20. [Security model](#20-security-model)
21. [Configuration reference](#21-configuration-reference)
22. [Data model reference](#22-data-model-reference)
23. [Callable function index](#23-callable-function-index)

---

## 1. What Velocity is

Velocity is a ride-hailing and ride-pooling platform built for Pakistan, plus a
set of adjacent businesses that run on the same user base: intercity seats,
courier and freight delivery, car rentals, proximity advertising for shops, a
referral/fleet program, and a commuter-social network called Travel Partner.

**Three deployable pieces:**

| Piece | Tech | Role |
|---|---|---|
| Mobile app | React Native / Expo (SDK 56), one binary | Both the passenger and the driver experience. Which one you see is decided at runtime by your `role` custom claim. |
| Admin console | Next.js 16 / React 19, Firebase App Hosting | Approvals, finance, safety, moderation, pricing, feature flags. Gated on the `admin` claim. |
| Backend | Firebase Cloud Functions v2, Node 22, TypeScript | The only writer of money, roles, verification and trip state. Region pinned to `asia-south1` (Mumbai) — nearest GCP region to Pakistan. `maxInstances: 20`. |

Data lives in Cloud Firestore behind default-deny rules; documents and KYC
images live in Cloud Storage (private), avatars public-read.

**Launch posture.** The wallet top-up economy, saved payment instruments and paid
Travel Partner subscriptions are fully built but **switched off** at launch via
`config/featureFlags`, so growth comes first and monetisation follows without a
redeploy. Rides are effectively cash-first today. See
[§14](#14-money--wallet-commission-settlement-payouts) and [§21](#21-configuration-reference).

---

## 2. Accounts, identity and roles

### 2.1 Sign-in

Phone number + OTP is the primary route. Verification is **native**: React
Native Firebase performs the phone verification with Play Integrity attestation,
then `exchangePhoneSession` bridges that into a custom token the JS SDK signs in
with. This replaced the old WebView reCAPTCHA flow, which hit SMS throttling
(`error-code: -39`).

Client-side helpers: `src/auth/phoneSignIn.ts`, `src/auth/otpGuard.ts`,
`src/lib/otpThrottle.ts` (local cooldown so users don't burn SMS quota),
`src/lib/phoneAuthErrors.ts` (human-readable error mapping).

### 2.2 Provisioning

`onUserCreate` (Auth trigger) runs on every new account and, in one batch:

- sets the custom claim `role: 'passenger'`,
- writes `users/{uid}` (display name, phone, email, photo, `gender:'unspecified'`),
- writes `wallets/{uid}` with `balance: 0`, `currency: 'PKR'`.

`onUserDelete` removes the profile document.

### 2.3 Roles

Roles are Firebase Auth **custom claims** — only the backend can write them, and
both the security rules and the callable guards read the same claim, so a client
can never escalate itself.

```
passenger  → default for every new account
driver     → granted by admin approval after onboarding (approveDriver)
admin      → granted by another admin (setUserRole); bootstrap the first manually
```

One person is often both: every driver starts life as a passenger, and the
driver experience is simply revealed once the claim flips. `claimDriverRole`
exists for a user whose driver record is approved but whose claim needs
re-syncing.

### 2.4 Profile, settings, preferences

`app/passenger/profile.tsx`, `settings.tsx`. Editable profile fields are
whitelisted in the rules; anything money- or trust-related (`role`,
`cnicVerification`, wallet fields, ratings) is server-only. `uploadUserPhoto`
handles avatars.

Two preference fields drive real behaviour elsewhere:

- `gender` — feeds the pool gender rules ([§4.3](#43-gender-rules-in-pools)).
- `mixedRideOk` — opt-in to mixed-gender pooling.

### 2.5 CNIC verification (the identity gate)

Ordinary rides need no ID. **Couriers do** — goods change hands between
strangers.

- `submitCnicVerification` — CNIC number in `12345-1234567-1` form, full name,
  front and back photos. URLs must live in our own Storage bucket.
- Status lands on `users/{uid}.cnicVerification` (one document read from any
  screen) and is mirrored into `cnicVerifications/{uid}` so the admin queue does
  not have to scan every user.
- `adminReviewCnicVerification` → `verified` or `rejected` (with reason;
  rejected users may resubmit). Only `verified` opens the courier flow, enforced
  server-side by `requireCnicVerified`.
- Admin page: **CNIC verification**.

### 2.6 Bans and disputes

- `banPassenger` (admin) — blocks an abusive rider.
- `createDispute` — a participant raises a dispute on a trip.
- `resolveDispute` (admin) — closes it, with the outcome recorded.
- Admin pages: **Passengers**, **Disputes**.
- Every privileged action writes an immutable `auditLogs` entry (actor, target,
  reason, timestamp).

Admins can also fully CRUD accounts from the console:
`adminCreatePassenger`, `adminUpdatePassenger`, `adminDeletePassenger`,
`adminCreateDriver`, `updateDriver`, `deleteDriver`.

---

## 3. City rides — the core product

### 3.1 The home screen

`app/passenger/home.tsx`. A live map with a draggable bottom sheet.

- **Live map activity** — anonymised supply and demand around you: blurred car
  positions and rider dots, served by `getNearbyActivity` (never raw
  coordinates). Presence is written to `userPresence/{uid}` while the home
  screen is open; that collection is **not client-readable** and TTLs itself via
  `expireAt`.
- **“Where to?”** — the single entry into a city ride. Pool discovery used to be
  a second door; it now lives *inside* this flow, right after the destination is
  set.
- **“Bol kar book karein”** — the voice route into the same flow. Hidden on
  handsets with no speech recogniser (typically no-GMS devices).
- **Services tiles** — only the things that are *not* a plain city ride:
  **City to City** and **Couriers**.
- **Travel Partner** card and **Earn with Velocity** card.
- **News ticker** promoting the Earn program.
- **Notifications** bell → `app/passenger/notifications.tsx`.
- **Update gate** — `UpdateGate` / `src/lib/appUpdate.ts` prompts when a newer
  build is published (see [§21.4](#214-appversion)).
- **Side drawer**: Wallet · Business · Special Rides · My routes · Nearby
  sharing rides · Travel Partner · Earn with Velocity · Matches & Groups ·
  Safety · Payment methods · Profile · Settings · Support chat.

### 3.2 Booking — three stages

`app/passenger/booking.tsx` (the largest screen in the app) runs
`route → mode → details`:

1. **Route.** Pickup (GPS or typed) and destination via Places autocomplete.
   All Places/Directions traffic is proxied through the backend
   (`placesAutocomplete`, `placeDetails`, `geocodeAddress`, `getDirections`) so
   the Google **server** key is never in the app. Recent destinations and saved
   places are offered; history is a modal (`app/passenger/activity.tsx`,
   `saved-places.tsx`).
2. **Mode.** Solo or Pool, with the pool saving ladder shown up front
   (60% / 40% / 35%, see [§4](#4-ride-pooling)), plus any **public pools already
   going your way** on this exact route.
3. **Details.** Vehicle category carousel, seat count, gender, payment method
   (cash / wallet), promo code, your offered fare, and — for pools — public vs
   private visibility and the invite link.

Fares are previewed **on the device** with the same engine the server uses
(`src/lib/fareEngine.ts` is a copy of `backend/.../fare/fareEngine.ts`), so
there is no network round-trip just to see a price, and the client preview can
never disagree with server validation.

### 3.3 Ride types and fares

Recommended base fares, `domain/fares.ts` (PKR):

| Ride type | Base | Engine category |
|---|---|---|
| bike | 150 | `moto` |
| auto | 250 | `rickshaw` |
| mini | 400 | `mini` |
| ac | 550 | `ac_car` |
| comfort | 750 | `luxury` |
| xl | 1100 | `luxury` |

A passenger **offers** a fare; it must sit between **0.7×** and **3.0×** the
base (`MIN_BID_FACTOR` / `MAX_BID_FACTOR`), and `createTrip` re-derives those
bounds server-side from the actual route.

The **fare engine** (`fare/fareEngine.ts`) is the real pricing model, configured
per city in `fareConfig/{cityId}`:

- per category: `base` (includes `includedKm` + `includedMin`), `perKm`,
  `perMin`, `minFare`, `bidFloorPerKm` (driver protection), `freeWaitMin`,
  `waitPerMin`;
- `surge` with a hard `maxMultiplier` so it can never get abusive;
- `pooling` — per-rider factors, `maxDetourMin`, `detourDiscountPerMin`;
- `commission` — rate + flat fee.

The shipped default config is anchored to mid-2026 Islamabad/Rawalpindi market
rates, positioned ~10% below the incumbent AC tier. All money is integer PKR,
rounded once at the end (`round5`).

Callables: `getFareEstimate`, `submitBid`, `getPoolingQuote`, `seedFareConfig`
(admin). Admin page: **Ride settings** / mobile `admin/fare-config.tsx`.

### 3.4 Trip lifecycle

Clients never write trip documents. Every transition is a callable that checks
the actor *and* that the `from → to` edge is legal.

```
requested ──acceptBid──▶ matched ──▶ arriving ──▶ arrived ──▶ in_progress ──▶ completed
    │                       │           │            │
    │                       └────── cancelTrip ──────┘        completeTrip → settlement
    └── cancelTrip (free — nobody has committed yet)
```

- `createTrip` — validates the fare against route-derived bounds; rejects if you
  already have an active trip, if unpaid cancellation debt is over the limit, or
  (for wallet payment) if you cannot afford the offer. Applies a `promoCodes`
  discount if the code is active and under its usage limit. Pool trips get a
  short **share code** minted here.
- `placeBid` — approved, online drivers only; blocked if the driver is
  commission-locked or over the outstanding-debt limit.
- `raiseTripFare` — the passenger sweetens a request nobody is taking.
- `acceptBid` — locks the fare and assigns the driver. For wallet trips it
  **holds the full fare** (`ride_hold`).
- `updateTripStatus` — driver-only: `matched→arriving→arrived→in_progress`.
- `cancelTrip` — see fees below. Impossible from `in_progress` onward.
- `completeTrip` — driver-only, and the **only** place a settlement exists:
  gross, commission, driver payout, passenger share, wallet movements, platform
  ledger, counters, and the partner-commission credit, all in one transaction.

New requests are pushed to nearby drivers (`broadcastTripToNearbyDrivers`) and
appear in the driver's open-requests feed. Drivers can report a fake or abusive
request (`reportOpenRequest`).

### 3.5 Cancellation fees

`domain/cancellation.ts`. Cancelling a `requested` trip is free — you are only
withdrawing an offer. Once a driver has accepted (`matched` / `arriving` /
`arrived`), whoever walks away owes Velocity a share of the **locked fare**:

| Canceller | Default rate |
|---|---|
| Passenger | **5%** |
| Driver | **8%** (they cost a ride *and* a driver already en route) |

- The fee is charged inside the same transaction that cancels the trip.
- It comes out of the canceller's **wallet balance first** (a cancelling
  passenger's released hold counts toward that); the shortfall becomes
  `wallets/{uid}.outstanding` — a debt. Balance is never driven negative.
- Small debts don't get in the way. At **300 PKR** (`outstandingLimit`) the
  account is blocked: `createTrip` rejects the passenger, `placeBid` rejects the
  driver.
- Clearing it: transfer to Velocity's account and upload a screenshot
  (`submitCancellationFeeSettlement`) — same AI + admin review path as driver
  commission ([§14.4](#144-manual-settlement-bank-transfer--ai-checked-screenshot)).
- Rates and the limit are admin-set (`config/cancellationSettings`), and the app
  streams them live so the fee it warns about is always the fee that will be
  charged. Admin page: **Cancellation fees**.

### 3.6 Ratings

`submitRating` — after a completed trip, both sides rate each other (1–5 stars,
optional comment ≤300 chars). Double submission is blocked per trip and per
direction. Rolling averages are maintained in a transaction: a driver's on
`drivers/{uid}`, a passenger's on `users/{uid}` — the open-requests feed copies
the passenger's rating so drivers can see who is hailing them. UI: `RatingModal`.

### 3.7 Scheduled (frequent) rides

“Book it for me every weekday at 08:30.” Saved from the booking screen.

- `upsertScheduledRide` / `deleteScheduledRide`; max **5** schedules per user.
- `runScheduledRides` is a cron every 5 minutes; a schedule is due when its
  `HH:MM` falls in a 10-minute window (wider than the cron interval, so a
  delayed tick can't silently skip a day). Day keys are Asia/Karachi.
- It creates the trip exactly as if the passenger had tapped “Find driver” —
  same fare validation, same open-requests feed, same nearby-driver broadcast.
- The passenger is pushed either way: **booked**, or **skipped** (already on a
  trip / fare no longer valid).
- Screen: `app/passenger/scheduled-rides.tsx`. Writes go only through the
  callables; clients have read-only access.

### 3.8 Daily routes and pool alerts

`app/passenger/daily-routes.tsx` → `users/{uid}/dailyRoutes/{routeId}`
(owner-managed, rules-guarded): a label, pickup area, drop-off area,
`radiusKm` (default 3), a time, and a notify flag.

When **anyone** opens a public pool that starts within the radius of a saved
pickup, ends within the radius of that route's drop-off, and opens within ±60
minutes of the saved time, the rider is pushed a “join this pool” alert
(`notifyDailyRouteMatches`, a collection-group scan run with the Admin SDK).
Tapping it opens the pool-join screen. **Nobody is ever auto-booked into someone
else's ride.**

### 3.9 Support

`app/passenger/support-chat.tsx` — in-app support thread.

---

## 4. Ride pooling

⚠️ **There are two distinct pooling subsystems.** They look similar in the UI and
are frequently confused:

| | **Booking-flow pools** (`trips` with `pool: true`) | **Pool ride requests** (`poolRideRequests`) |
|---|---|---|
| Who starts it | A passenger booking a normal trip and choosing “Pool” | A passenger “leader” posting a shared-ride offer |
| Model | Ordinary trip; riders join via link or nearby discovery | inDrive-style negotiation: leader proposes a per-seat fare, drivers respond, leader accepts |
| Code | `trips/index.ts`, `trips/poolShare.ts` | `poolRideRequests/index.ts` |
| Gender rules | Tally of male/female riders shown | **Full gender-composition engine lives here** |
| Driver-posted pools | — | `poolRides/*` (driver posts a ride, passengers join, batching) |

### 4.1 Per-seat pricing (booking-flow pools)

`domain/fares.ts` — `poolPerSeatFare()`, mirrored by `POOL_TIERS` on the booking
screen:

| Riders in the car | Each pays |
|---|---|
| 1 (solo) | 100% |
| 2 | **60%** |
| 3 | **40%** |
| 4 | **35%** |

Everyone saves versus riding alone, and the driver's gross **rises** with each
extra rider (per-seat × riders). `MAX_POOL_RIDERS = 4`.

Important: a pool request is created **offering the full solo fare**. The
discount only materialises as riders actually join — otherwise a pool would look
like an unrealistically low bid to every driver and nobody would take it. Fare
bounds are therefore identical for solo and pool.

### 4.2 Share links, public and private pools

`trips/poolShare.ts`. Every booking-flow pool gets a short code, stored on the
trip and mirrored in `poolShareCodes/{code}`; an https link opens the in-app
join screen (`app/passenger/pool-join/[code].tsx`).

- `getPoolTripByCode` — resolves a code into a join-screen snapshot: route, host,
  seats left, current fare, male/female tally.
- `joinPoolTrip` — joins and **recomputes everyone's per-seat fare**; riders can
  hop on until the car actually departs (`requested` / `matched` / `arriving` /
  `arrived`).
- `setPoolVisibility` — host flips **public ↔ private**. Public pools appear in
  nearby discovery for every rider; private ones never do — **possession of the
  link is the credential**.
- `getNearbyPublicPoolTrips` — public pools near you. Surfaced both inside the
  booking flow (“pools on your route”) and on the home screen (“Pools near you,
  5 km”) → `app/passenger/pool-request/nearby.tsx`.
- Links are shareable to WhatsApp etc. via `src/share/links.ts`; the web
  `/link` interstitial carries them for people without the app installed.

### 4.3 Gender rules in pools

`lib/genderAccess.ts` — `computeGenderAccess()` derives which genders may still
join, from the current composition and the driver/leader's hard preference.
Built around Pakistani cultural norms:

| Current composition | Who may still join |
|---|---|
| empty | all |
| 1M | all (a woman must have `mixedRideOk`) |
| 2M or 3M | male only — never shown to women |
| 1F | all (a man must have `mixedRideOk`) |
| 2F | female only |
| 3F | all (a man may take the front seat next to the driver) |
| 1M + 1F, space left | all |
| 2M+1F or 1M+2F | **none** — seating is too cramped to be comfortable |
| full | none |

A driver/leader preference of `male_only` / `female_only` is a **hard cap** and
overrides composition entirely. `canJoinPool()` re-checks the joiner's gender and
`mixedRideOk` at join time and returns a human-readable reason when it blocks.

A leader requesting `male_only` / `female_only` must themselves match that
preference. Misrepresentation is reportable:
`reportPoolGenderMisrepresentation`.

### 4.4 Pool ride requests (leader-initiated negotiation)

`poolRideRequests/index.ts`, screens under `app/passenger/pool-request/*` and
`app/driver/pool-requests.tsx`.

- `createPoolRideRequest` — pickup + destination areas, **proposed fare per seat**
  (50–10,000 PKR), 2–4 slots, gender preference. Geohashed for proximity search.
  **Expires in 30 minutes** if no driver responds.
- `driverRespondToRequest` — a driver accepts or counter-offers. Blocked if
  commission-locked.
- `leaderRespondToOffer` — the leader accepts or declines a driver's offer.
- `joinPoolRideRequest` — other passengers take the remaining seats, subject to
  the gender rules and the drop-zone radius.
- `cancelPoolRideRequest`, `getNearbyPoolRequests`, `getNearbyActiveRides`.

**Drop zone.** Joiners must be dropped within a fixed radius of the leader's
destination — the driver's per-ride value, else `config/poolSettings.dropRadiusM`,
else **1 km** (`lib/poolRadius.ts`). It is fixed at creation so the rule everyone
agreed to cannot shift mid-ride.

### 4.5 Driver-posted pool rides

`poolRides/index.ts`, `app/driver/pool-ride-offer.tsx`,
`app/driver/pool-pickup/[id].tsx`.

- `joinPoolRide` — passenger joins a driver's posted ride (gender rules apply).
- `driverAcceptPoolBatch` — the driver accepts a batch of join requests at once.
- `startPoolBoarding` — reads all confirmed passengers, sorts them
  **nearest-first from the driver's current GPS**, stores the order on the ride,
  flips status to `boarding`.
- `poolArrivePassenger`, `poolPassengerBoarded` — per-passenger progress.
- `completePoolRide` — settles; the driver must be **inside the drop zone**
  (+250 m GPS slack) to complete, so everyone is dropped before the car leaves.
- `cancelPoolJoinRequest`, `driverBlockPoolPassenger`.

---

## 5. En-route pickups and driver routes

`trips/enRoute.ts` (~1,100 lines) plus `lib/corridor.ts`, `lib/enRouteMatch.ts`,
`lib/enRouteFare.ts`. Driver screen: `app/driver/en-route.tsx`.

Two features, one engine — *the driver has a corridor; who is standing on it?*

1. **Riders on your way.** A driver already carrying a pool picks up someone
   waiting along the route, without detouring anywhere the car wasn't going.
2. **Heading home.** A driver on no trip at all declares a destination
   (`setDriverRoute` → `driverRoutes/{uid}`, closed with `endDriverRoute`). Pool
   requests lying along that route appear in their feed. Earning on a drive they
   were making anyway.

**En-route candidates are always pool requests, never solo ones.** Someone who
booked a pool accepted riding with strangers; someone who booked solo did not,
and no discount makes that an acceptable surprise.

**What the people already in the car see: everything.** The moment a rider is
added, every seated passenger's trip document gains them — name, gender, where
they board, where they alight — and each is pushed a notification saying who
joined and what it did to their own fare, with a call-the-driver button on the
same screen (`PoolRidersCard`, `getPoolRiders`).

### 5.1 The leg-split fare

A flat per-seat percentage is simply wrong when riders board and alight at
different points: sharing 2 km of a 20 km trip is not sharing the same thing as
riding the whole way. So `lib/enRouteFare.ts` cuts the route into **legs** at
every boarding and alighting point and splits each leg's distance equally among
whoever is actually aboard for it:

```
billableKm(i) = Σ over legs i is aboard ( legKm / ridersAboard(leg) )   ← shared road
              + detourKm(i)                                            ← theirs alone
```

That billable distance goes through **the same `calculateFare`, the same city
config and the same rounding** as the solo quote, so base fares, included km,
category minimums and Rs.5 rounding all behave identically to everywhere else.

The detour term is the road driven *off* the shared route to reach one rider's
door and back. Nobody else travels a metre further for it, so nobody else pays.

Four properties, each enforced and pinned by tests:

1. **Nobody overpays** — `fare(i) ≤` that rider's own solo fare, always. This is
   load-bearing, not cosmetic: the polyline is supplied by the driver's client
   (the backend has no Maps key), while `soloFare` is computed server-side from
   haversine.
2. **The driver never loses** — each extra rider adds a whole base fare while the
   distance charge is only redistributed. (A flat tier fails this badly: a 0.5 km
   hop joining a 30 km trip would drop the long rider to 60%.)
3. **Sharing only ever helps** — a rider's fare is non-increasing in the number
   of people sharing their legs.
4. **The advertised tier is honoured** — destination-pool riders still pay no
   more than the 60/40/35% the booking screen promised.

### 5.2 The corridor gates

`lib/corridor.ts` builds the corridor from the route polyline (validated —
`validateRoutePolyline` rejects shapes that don't correspond to a real route) and
projects candidate riders onto it. `checkCorridorFit` enforces the on-route
tolerance (~1 km), the drop allowance (~4 km) and the fare gate. Every card the
driver sees has **already** passed those checks server-side, so accepting can
never fail for a reason the card didn't show. En-route rides are cash-only.

Callables: `setDriverRoute`, `endDriverRoute`, `getEnRouteMatches`,
`acceptEnRouteRider`, `getPoolRiders`.

---

## 6. The driver experience

### 6.1 Becoming a driver

`app/passenger/become-driver/*` — a stepped flow: checklist → login → basic info
→ CNIC → licence → vehicle → vehicle details → plate → vehicle photo → vehicle
certificate → account → submitted.

`submitDriverOnboarding` collects full name, CNIC (`NNNNN-NNNNNNN-N`), vehicle
type, label and plate, plus licence, CNIC (both sides), vehicle document, driver
photo and vehicle photos (up to 6 extra), with optional DOB and document expiry
dates. It sets `drivers/{uid}.verificationStatus = 'pending'` and **does not**
grant the driver role.

`approveDriver` (admin) grants the `driver` claim; `rejectDriver` rejects or
suspends and revokes it. Admin page: **Driver approvals**. Document expiry dates
are tracked so an expired licence can be caught.

### 6.2 Driver home

`app/driver/home.tsx` — go online/offline (presence written to `drivers/{uid}`:
`online`, `lastLocation`, `heading`, `lastSeenAt` — the only fields a driver may
write), the live open-requests feed, active trip card, pool rides, commission
lock banner, outstanding-fees banner, push registration, and a voice button
(`DriverVoiceButton`).

Tabs (`DriverTabBar`) and a drawer (`DriverDrawer`) reach:

| Screen | What it does |
|---|---|
| `all-requests` | Every open request, not just the nearest |
| `request-detail/[tripId]` | Full request + route map, bid or accept |
| `demand` | **Demand heatmap** of open requests + today's anonymised commuter demand |
| `commute-demand` | Rounded times and area names only — never a passenger's exact origin |
| `en-route` | Riders on your way / heading home ([§5](#5-en-route-pickups-and-driver-routes)) |
| `pool-requests`, `pool-ride-offer`, `pool-pickup/[id]` | Pooling |
| `earnings` | Ledger and totals |
| `wallet` | Balance, commission due, settlement, payouts |
| `payment-methods` | Connected instruments (flag-gated) |

### 6.3 Commission cycle and the lock

`domain/commission.ts`. Every completed ride adds its gross to the driver's
`cycleGrossFare`; **cash** rides also add to `cycleCashFare`.

- Default rate **10%**, default lock threshold **5,000 PKR** of cycle gross
  (`config/commissionSettings`, admin page **Commission**).
- What's owed is `rate × cycleCashFare` **only** — commission on wallet rides was
  already deducted at completion, so a mixed cycle never pays twice and an
  all-online cycle clears itself without ever locking.
- When the threshold is reached and something is still owed, the driver is
  **locked**: `placeBid`, `driverRespondToRequest` and `driverAcceptPoolBatch`
  all reject them, and the app parks on the wallet screen with incoming rides
  blurred (`CommissionLock`).
- Clearing it: `payCommission` (from wallet — wired for when top-ups return) or
  the manual bank-transfer path below, which is what launch actually uses.

### 6.4 Payouts

`requestPayout(amount, method, account)` reserves the balance and queues a
`payouts` doc carrying the driver's Easypaisa/JazzCash number or bank IBAN; an
admin disburses it and calls `markPayoutPaid`. Admin page: **Payouts**.

---

## 7. City to City (intercity seats)

`intercity/index.ts`, `app/passenger/city-to-city.tsx`,
`intercity-activity.tsx`, `intercity-trip/[id].tsx`.

Velocity (or an operator) publishes scheduled intercity trips; passengers book
seats on them.

- **Trip**: from/to city, departure time, estimated arrival, vehicle type
  (`standard_ac`, `business_ac`, `non_ac`, `coaster`, `suv`, `hiace`), operator
  name, total seats (≤60), fare per seat, pickup and drop-off points, driver
  name/phone, plate, notes. Status:
  `scheduled → boarding → in_progress → completed` (or `cancelled`).
- `createIntercityBooking` — 1–6 seats, cash or wallet.
- `cancelIntercityBooking`.
- `sendIntercityMessage` — a per-trip chat thread (≤1,000 chars) between
  passengers and the operator.
- Admin: `adminCreateIntercityTrip`, `adminUpdateIntercityTrip`,
  `adminCancelIntercityTrip` (notifies every booked passenger),
  `seedIntercityTrips`. Mobile admin screen: `app/admin/intercity-trips.tsx`.

---

## 8. Couriers

`couriers/index.ts`, `app/passenger/couriers.tsx`,
`courier-order/[id].tsx`.

Same-city parcel delivery, **gated on CNIC verification** ([§2.5](#25-cnic-verification-the-identity-gate))
— the client gates it, and the server decides.

- `createCourierOrder` — pickup and drop-off addresses, package type
  (`document` / `parcel` / `box`), offered fare 50–5,000 PKR, recipient name and
  phone, optional instructions.
- Status: `pending → accepted → picked_up → delivered` (or `cancelled`).
- `cancelCourierOrder`; `adminUpdateCourierStatus` (with driver name/phone and a
  note). Admin screen: `app/admin/courier-orders.tsx`.

---

## 9. Business — Business delivery and “Find your Customers”

The drawer's **Business** entry lands on a hub (`app/passenger/business.tsx`)
with two doors: *move your goods*, or *bring customers to your door*.

### 9.1 Business delivery (freight)

`freight/index.ts`, `app/passenger/business-delivery.tsx`,
`freight-order/[id].tsx`.

Bulk and priority deliveries, quoted by a human.

- `createFreightRequest` — business name, contact person and phone, pickup,
  drop-off, priority (`standard` / `express` / `same-day`), load type
  (`documents` / `goods` / `perishable` / `fragile`), notes, and an estimated
  quote.
- Flow: `pending → quoted → confirmed → picked_up → in_transit → delivered`
  (or `cancelled`). `acceptFreightQuote` is how the business accepts the final
  price; `adminUpdateFreightStatus` sets status, `finalQuote` and an admin note.
  `cancelFreightRequest` withdraws it. Admin screen:
  `app/admin/freight-orders.tsx`.

### 9.2 “Find your Customers” — how an SME markets its product

**The whole feature in one line:** a shop pays for the right to push one offer to
Velocity users who come within a few kilometres of its door, and gets to see
exactly how many people received it and how many opened it.

Code: `backend/functions/src/businessAds/*`. Screens:
`app/passenger/business-ads/{index,subscribe,compose,analytics}.tsx` and the
offer viewer `app/passenger/offer/[adId].tsx`. Admin page: **Advertise**.

#### 9.2.1 The price list

Two bands, because that is what the product sells: a short radius that costs less
and carries one ad, and a wider radius that costs more and carries three. Live in
`config/businessAdSettings` so an admin can reprice without shipping a build.

| Band | Radius | Monthly fee | Live ads at once |
|---|---|---|---|
| `near` | up to **3 km** | **5,500 PKR** | 1 |
| `wide` | up to **5 km** | **7,000 PKR** | 3 |

- Bands are **inclusive of their ceiling**: 3.0 km is the cheap band, 3.1 km is
  the wide one.
- Radius is chosen in **0.5 km steps** and clamped to the widest band sold.
- Plans are bought in whole-month blocks: **3, 6 or 12 months**, paid up front.
  Total = monthly fee × months.

#### 9.2.2 Buying a campaign

`submitBusinessAdApplication` (rate-limited to 5/hour). The shop submits:

- desired **radius** and **plan length**;
- the shop's **own coordinates** (centre of every radius check) + address + city;
- a contact phone;
- the **creative**: title (3–80 chars), business name, offer details (5–600
  chars), and an offer picture;
- a **screenshot of the transfer**, the rail used (`bank` / `easypaisa` /
  `jazzcash`) and an optional reference;
- acceptance of the advertising terms.

Both images must live in Velocity's own Storage bucket — never a URL the client
made up.

The backend **re-derives the quote** (band, monthly fee, ad slots, total) from
live settings and snapshots it onto the application. An admin reviewing a receipt
next week therefore compares it against the price the applicant actually saw, not
against a rate that has since changed.

The creative deliberately arrives **twice**: with the application, so the
reviewer can see what would be pushed to thousands of phones before saying yes;
and again after approval (prefilled) as the live ad. The draft is never itself an
ad.

An advertiser with a still-running plan **renews from the advertise home**, not by
filing a second application — two live applications for one shop would give the
reviewer no way to tell which one the payment belongs to.

#### 9.2.3 Review and approval

`adminReviewBusinessAdApplication` — `approve` / `reject` / `resubmit`. A
non-approval **requires a reason** so the advertiser knows what to fix.

- The screenshot is checked **by a person, not by code** — the backend cannot
  tell a real receipt from an edited one, and pretending otherwise would be
  theatre.
- An admin may **approve down to a smaller radius or shorter plan** (e.g. the
  transfer that landed only covers the cheaper band). Approving down is kinder
  than rejecting and making them start over.
- Approval mints `businessAdvertisers/{uid}` — the document every publishing and
  notification path keys off — carrying centre, radius, band, ad slots, fees and
  an expiry.
- **The clock starts at approval, not at payment**, so nobody loses days to the
  review queue. A renewal extends from whichever is later: the old expiry (paid
  days are never burned) or now.
- Lifetime counters (`totalNotified`, `totalReach`, `totalClicks`) are **never
  reset by a renewal** — that history is the only evidence the advertiser has
  that the last plan was worth buying.
- The advertiser is pushed the verdict.

#### 9.2.4 Publishing offers

`createBusinessAd`, `updateBusinessAd`, `setBusinessAdStatus`.

- **Geography is not the ad's to choose.** Centre and radius are copied off the
  advertiser document — what they paid for. Otherwise the price list would be
  decorative: buy 3 km, publish a 5 km ad.
- **Slots.** The band decides how many ads may be live at once. Only `active` ads
  consume a slot, so an advertiser can keep several creatives on file and rotate
  which one runs. The count is done in a transaction against the ads collection,
  not from a counter — a counter that drifts hands out free slots.
- Only the **creative** is editable afterwards; geography and stats stay
  server-owned.
- `removed` is a soft delete — the stats outlive the ad.
- Going from paused back to `active` re-checks the slot gate and refreshes the
  ad's copy of the plan expiry and geography (so an ad paused across a renewal
  isn't skipped as expired).

#### 9.2.5 Delivery — how the offer reaches a person

`checkNearbyBusinessAds`. **There is no background geofence**, deliberately:
real geofences mean asking every rider for background location, declaring it to
Play, and justifying the battery cost — a large ask for an advertising feature.
Instead the app calls this while it is open, throttled to significant movement,
and the server decides whether that position has earned a notification. What the
advertiser gets is *people who use Velocity near their shop*, which is the honest
version of what was sold.

Per call:

1. Sweep geohash cells against the **widest band sold** (which ads are in range
   isn't known until distances are computed).
2. Keep only ads whose plan has not lapsed and whose own radius contains the
   caller.
3. Sort **closest first** — if the day's budget covers one push, it should be the
   shop the person is standing next to.
4. Spend the notification budget (below), write the impression record **before**
   pushing (a push we sent but failed to record could be sent again a minute
   later), then push.

The picture rides **inside** the push, so pulling the shade down shows a
big-picture card — business name, offer line, photo — with the app closed.

Everything in range is returned whether or not it was pushed, so the app can show
a quiet “offers near you” list without spending a notification.

#### 9.2.6 The notification budget — protecting users, not revenue

Two independent limits, both server-enforced:

| Limit | Default | Why |
|---|---|---|
| Per ad, per person | one push every **12 h** (`notifyCooldownHours`) | Walking past the same shop four times in a day is one notification, not four. |
| Per person, **all** advertisers | **6 per day** (`maxNotifPerUserPerDay`) | Someone on a dense market street must not open the app to eleven offers. |

The cooldown is a **clock, not a re-entry trigger**: someone who lives inside the
radius and never leaves hears from the advertiser once per window — the offer is
aimed at the neighbourhood, not only at people walking in from outside.

Budget claims run in a transaction keyed on the Asia/Karachi day
(`businessAdNotifyBudget/{uid}_{day}`, TTL-expiring), so two location fixes
arriving together cannot both spend the last slot. Blowing the budget is not an
error — the ads come back silently un-notified.

The nearby call itself is rate-limited to 40/hour as a backstop against a client
that doesn't throttle itself.

#### 9.2.7 Measurement

- `notified` — pushes sent.
- `reach` — **distinct people**, incremented only the first time an ad ever
  reaches a given user. The gap between `notified` and `reach` is exactly the
  repeat-exposure number an advertiser wants, and it comes free from the
  impression document the cooldown already needs.
- `clicks` — `recordBusinessAdClick`, fired by the offer screen the notification
  opens. Repeat opens count (advertisers care about total opens), but they are
  recorded against one uid, so an admin can spot a number that is too good to be
  true.
- Daily rollups at `businessAds/{adId}/daily/{YYYY-MM-DD}` (Pakistan time) power
  the advertiser's **7-day chart**, zero-filled — so `getBusinessAdDashboard`
  never scans the impressions collection, which grows with users × ads.
- `getBusinessAdDashboard` returns stage (`none` / `pending` / `rejected` /
  `resubmit` / active), the application snapshot, the advertiser record, all live
  ads with per-ad stats, the 7-day series, and totals including **CTR**.

#### 9.2.8 Admin controls

- `adminSetBusinessAdStatus` — take any ad down (or put it back), with a reason.
  Publishing is deliberately not gated on a second review, so this is the lever
  for the offer that should never have gone out.
- `adminSuspendAdvertiser` — suspend or reinstate a whole advertiser account
  (pushes the advertiser either way).
- `adminUpdateBusinessAdSettings` — bands, currency, cooldown, daily ceiling and
  the receiving accounts.
- `expireBusinessAdPlans` — scheduled sweep that marks lapsed plans `expired`.
- Every action lands in `auditLogs`.

#### 9.2.9 The SME's journey, end to end

1. Drawer → **Business** → **Find your Customers**.
2. Read the pitch; pick a radius on the map around the shop (up to 5 km) and see
   the price for that band.
3. Choose 3, 6 or 12 months. Pay into the bank / Easypaisa / JazzCash account
   shown, upload the screenshot.
4. Write the offer — headline, business name, details, photo — and submit.
5. Wait for review; a push announces the verdict.
6. On approval: publish the offer (prefilled from the draft). One live offer on
   the near band, three on the wide band.
7. Anyone using Velocity inside the radius receives it as a photo notification,
   at most once every 12 hours, within the platform-wide 6-a-day ceiling.
8. Watch **sent / people reached / opened / CTR** and the 7-day chart. Pause,
   edit, rotate creatives, or renew.

---

## 10. Earn with Velocity — the Partner Program

**This is how an individual builds their own transport business on Velocity.**
Not by owning cars: by recruiting and running a *fleet* of drivers and riders and
earning a share of Velocity's revenue from everything they do.

Code: `backend/functions/src/partners/*`. Screens: `app/passenger/earn/*`
(landing, apply, dashboard, fleet, member/[uid], referral, revenue, analytics,
wallet, withdraw, join/[code]). Admin page: **Partner Program**.

### 10.1 The one rule that must not be misunderstood

A partner earns a slice of the **platform commission** on rides run by people
they recruited. **Never a slice of the fare.**

> On a 1,000 PKR ride with a 10% platform commission (= 100 PKR), a 2% Pro
> driver-fleet rate pays the partner **2 PKR** — 2% of 100, *not* 2% of 1,000.

This distinction is the economic safety of the whole program: the fare belongs to
the driver, the commission is Velocity's revenue, and the partner cut is Velocity
choosing to share its own revenue with whoever brought that driver or passenger
in. `partnerCut()` is only ever handed `settlement.commission`.

The landing screen states this — plus the fact that **installs pay nothing, only
completed rides do** — *before* anyone applies, because a partner who signs up
believing otherwise becomes a support ticket and a one-star review.

### 10.2 Tiers

`config/partnerSettings` (admin-editable):

| | Driver fleet rate | Passenger fleet rate | Cost |
|---|---|---|---|
| **Free** | 0.5% of commission | 0.5% of commission | nothing |
| **Pro** | **2%** of commission | **1.3%** of commission | **4,500 PKR / month**, bought as 3, 6 or 12 months |

Other settings: `minWithdrawal` **500 PKR**, `holdHours` **72**, the receiving
accounts (each with its account title — wallets are often registered under
different names, and an applicant who sees a name they don't recognise will
rightly refuse to send money to it).

The tier is **stamped on the partner document at approval and read at
settlement**, so upgrading changes what the *next* ride pays and never
retroactively re-prices settled rides.

### 10.3 Applying

`submitPartnerApplication`. Nobody self-serves into being a fleet owner.

- **Free** needs an identity document and a verified mobile.
- **Pro** additionally needs **proof the fee was paid** (screenshot + rail +
  optional reference) and the plan length — because Pro earns roughly four times
  what free earns, and the fee is the only thing between “a partner” and “anyone
  who wants the higher rate”. A human checks that screenshot.
- Accepted IDs: **CNIC, university card, driving licence, passport, other** — a
  CNIC is preferred but students apply with a university card. The strict
  13-digit format and the both-sides requirement apply *only* when the document
  actually is a CNIC.
- **Phone verification is enforced by the backend, not the client.** The
  submitted number must already be on the caller's Firebase Auth record, and a
  number only lands there when Firebase itself verified an OTP for it. Skipping
  the OTP screen and posting the form is rejected.
- Documents must be in Velocity's own Storage bucket.
- Screens show the stage full-bleed: **pending** (a progress timeline, until an
  admin decides), **rejected** (the admin's reason + reapply), **approved**
  (straight to the dashboard). Burying status at the bottom of the sales page
  made people think their application had vanished.

`adminReviewPartnerApplication` — approve / reject / resubmit, and an admin may
**approve a Pro applicant down to free** (e.g. the payment never landed) rather
than bouncing them out of the program.

### 10.4 One code, two fleets

`partners/fleets.ts`. Approval mints **one five-digit code** and creates
**both** fleets immediately.

- Which fleet a recruit lands in is decided by **who the recruit is**, not by
  what they typed: a driver redeeming `48213` joins the driver fleet, a passenger
  redeeming the same `48213` joins the passenger fleet. So a partner can never
  hand somebody “the wrong code”, and “use my code, 48213” works on a poster, on
  a phone call and in a WhatsApp forward.
- Codes are minted with a uniqueness check and retries — 90,000 codes collide in
  practice once there are a few thousand partners, and a duplicate would
  silently merge two partners' recruits, which is unrecoverable once rides
  settle.
- Both fleets exist from minute one: an approved partner who must press “create
  fleet” before their code works is a partner whose first ten recruits bounced.
- `previewPartnerFleet` — what a recruit sees before redeeming (who invited them,
  their level and tier). No partner PII beyond a display name.
- Recruits redeem from passenger settings or the driver drawer
  (`claimPartnerReferral`), or land on `earn/join/[code]` /
  `app/referral-code.tsx` from a shared link.

### 10.5 Referral integrity

`partners/referrals.ts` — the load-bearing point of the program. A referral edge
is **permanent** (only `adminReassignReferral` can move or delete it), so every
cheap way to manufacture one is refused *before* the write, inside a transaction:

| Guard | Rule |
|---|---|
| **Self-referral** | A fleet owner cannot redeem their own code. |
| **Duplicate accounts** | Same CNIC / phone / device signing up again. |
| **Retro-crediting** | A code binds only to an account with **no completed rides**. Someone who has been riding for a month was not recruited by anybody — paying for them would be paying for a customer Velocity already had. Deliberately *not* an account-age window: a driver may sign up today, wait a week for licence approval, and only then hear about the code. They have driven nobody, so they may still bind. |
| **Device farming** | At most **3** accounts per handset (`deviceId`). |

One person can legitimately sit in **both** of a partner's fleets: every driver
starts as a passenger, so redeeming on day one binds the passenger edge, and
redeeming again after driver approval binds the driver edge.

### 10.6 Levels

`partners/types.ts` — derived from lifetime stats every time those stats move,
never set by an admin, so a badge can't drift from reality.

| Level | Active members | Completed rides | Lifetime earnings | Active months | Max scam rate |
|---|---|---|---|---|---|
| Bronze | 0 | 0 | 0 | 0 | — |
| Silver | 10 | 250 | 5,000 | 2 | 8% |
| Gold | 40 | 1,200 | 25,000 | 3 | 5% |
| Platinum | 100 | 4,000 | 75,000 | 4 | 3% |
| Diamond | 200 | 10,000 | 200,000 | 6 | 2% |

*Active member* = completed at least one ride in the last 30 days. *Active
months* = distinct months with at least one completed ride (the consistency
signal). **Every** threshold must be met — volume alone never buys a level, and a
partner running a scammy network is capped however big they are.
`nextLevelTarget()` drives the progress UI; `recomputePartnerLevels` is the
admin/scheduled recompute.

### 10.7 Earning on a ride

`partners/commission.ts`, called from `completeTrip`, split in two halves because
Firestore requires all reads before any write:

- `preparePartnerCredit()` — outside the transaction: load the referral edges,
  resolve the rates for each edge's tier, run the fraud engine. **Never throws** —
  a failure here must not stop a driver completing a ride they actually did.
- `applyPartnerCredit(tx)` — inside the transaction, write-only. A ride cannot
  complete without its commission, and a commission cannot exist without its
  ride.

Details:

- A **suspended** partner keeps their history and stops earning — the edge is
  dropped rather than crediting an account not allowed to be paid.
- **Pool rides** carry riders beyond the primary passenger, each possibly
  recruited by a different partner. Each co-rider edge is priced on the
  commission attributable to **their** fare (clamped to the gross), not the whole
  ride's.
- The payout waterfall pays the **franchise first**, then each fleet in priority
  order, and stops when the commission is exhausted — **Velocity's own net is
  never allowed to go negative**.
- Money is credited to **`pending`**, not to the withdrawable balance.

### 10.8 Fraud

`partners/fraud.ts` runs before a single rupee is credited. A ride that trips any
rule earns **zero** but still appears in the partner's history, marked — hiding
it would make the partner think the ride vanished.

| Signal | What it catches |
|---|---|
| `collusion` | Driver and passenger both belong to the same partner — staged rides between two accounts they control |
| `ride_loop` | The same driver/passenger pair going round and round (staging, automated) |
| `device_abuse` | Driver and passenger are literally one handset |
| `gps_manipulation` | Pickup/drop-off no vehicle could cover in the elapsed time (mocked location), or a “ride” that starts and ends on the same spot |
| `self_referral`, `duplicate_account` | Manufactured recruits ([§10.5](#105-referral-integrity)) |

A pool lets a fleet owner take *any* seat rather than the primary one and farm
the driver-side cut on a staged ride — same fraud, same verdict: **the whole ride
pays zero.**

Thresholds are deliberately conservative: a false positive costs an honest
partner real money and a support ticket. Signals are written to
`partner_fraud_logs` (immutable; logging can never fail the ride it describes)
for the admin fraud monitor. `adminMarkRideStatus` lets an admin mark a ride
`completed` / `cancelled` / `scam` / `fraud` — and `scam`/`fraud` force the cut
to zero **retroactively**, clawing the money back if it was already credited.

### 10.9 Wallet, maturation, withdrawal

`partners/wallet.ts`. Four numbers that must always agree:

```
pending    earned, still inside the fraud-hold window, NOT withdrawable
balance    matured, withdrawable, not yet requested
withdrawn  actually paid out
lifetime   everything ever earned (decreases only on a clawback)
```

Money moves `pending → balance → withdrawn`, one direction, and every move
happens in the transaction that also moves the row causing it. A rupee is in
exactly one bucket at any moment, so nothing can be withdrawn twice and a
clawback can never take money already legitimately paid out.

- `maturePartnerEarnings` — a cron **every 30 minutes** moves rows whose
  `maturesAt` has passed (default hold **72 h**) from `pending` into `balance`.
  Rows are grouped per partner so one wallet write covers all of them, and each
  row is **re-read inside the transaction** — maturing a row a clawback just
  reversed would resurrect money that had been taken back.
- `requestPartnerWithdrawal` — minimum **500 PKR**, method `easypaisa` /
  `jazzcash` / `bank` (bank requires a bank name). The balance is **debited
  immediately** so two requests cannot both be funded by the same rupees while an
  admin takes a day. The error message names the `pending` figure explicitly,
  because a partner staring at a big pending number and a “not enough balance”
  error will otherwise assume a bug.
- `adminReviewWithdrawal` — `pending → approved → paid`, or `rejected` (refunds
  the balance).
- `adminSuspendPartner`, `adminUpdatePartner`, `adminDeletePartner`.

### 10.10 What the partner sees

`getPartnerDashboard`, `getPartnerFleetMembers`, `getPartnerMemberRides`,
`getMyReferral` — level and progress to the next rung, both fleets with member
counts and completed rides, per-member ride history, revenue and analytics
screens, the wallet with pending/available split, and the referral screen with
the code and share links.

The landing page headlines an **“earn up to 730,000 PKR/month”** ceiling
(`MONTHLY_CEILING`) with the fine print attached, animated up from zero.

---

### 10.11 The Pro fleet portal (web)

`backend/functions/src/franchise/*`, web route `app/(portal)/f/[portalId]`, admin
page **Fleet submissions**.

**Pro buys a web dashboard of the partner's own.** Free partners do not get one.

- **The link.** Approving a Pro application mints a 22-character `portalId` on
  `partners/{uid}` and the partner's private address becomes
  `https://<web-host>/f/<portalId>`. It is sent to them in the approval push, and
  an admin can copy or reissue it from the Partner Program page
  (`adminRotatePartnerPortal`). Upgrading a free partner to Pro from that same
  screen mints one too.
- **The link is not a credential.** It is unguessable so it does not turn up in
  scans or referrer logs, but `requirePortalOwner` re-derives ownership from the
  *signed-in uid* on every call: partner doc exists, tier is `pro`, status is
  `active`, Pro has not expired, and `portalId` matches. A stranger who opens the
  link sees the sign-in screen and nothing else, and a rotated link stops working
  on the next request rather than whenever a tab is next reloaded.
- **Sign-in is phone + OTP** against the same Firebase account the partner uses
  in the app. Firebase keys phone users by number within a project, so web OTP
  resolves to the same uid `partners/{uid}` is filed under — no account linking,
  no second password. The web host must be in Firebase Auth's **authorised
  domains** or `signInWithPhoneNumber` refuses.

**Filing a driver.** `franchiseSubmitDriver` writes `driver_submissions/{id}` and
creates *nothing else*: no auth account, no `drivers/{uid}`, no fleet edge. A
partner able to mint driver accounts could mint a fleet of accounts they control
and farm commission on staged rides between them — the door stays shut rather
than relying on the fraud engine to catch it afterwards. Rate-limited to 40/hour.
Refused if the phone or CNIC is the partner's own (self-referral), or if the
number or plate is already filed by anyone.

**Approving.** `adminReviewDriverSubmission` is the final approval the flow waits
on. On approve it resolves the driver's auth account **by phone number**
(creating it if new, because that is how drivers actually sign in), grants the
`driver` role, writes `drivers/{uid}` as `approved`, and binds
`driver_referrals/{uid}` to the partner's **driver fleet** so the ordinary Pro
rate pays through the existing commission path — [§10.7](#107-earning-on-a-ride).
No new money path exists here; the portal is a recruitment surface, not a second
earning scheme, and the franchise 5% of [§12](#12-franchises) is **not** applied.

The retro-crediting rule of [§10.5](#105-referral-integrity) is preserved: a
driver who has already completed rides is approved as a driver but **not**
credited to the fleet, and both the admin and the partner are told which happened
rather than left wondering why a counter did not move.

`driver_submissions` is **admin-read, server-write only**. The owning partner
reads their own through `franchiseListDrivers`, never by querying the collection,
so one partner can never widen the filter and enumerate a rival's drivers.

---

## 11. Special Rides — rent your car out

`backend/functions/src/specialRides/*`, screens
`app/passenger/special-rides/{index,compose,details,my-cars,booking-confirmation}.tsx`.
Admin page: **Special Rides**. Shipped in v1.3.0 (5 Aug 2026).

Daily vehicle rental inside Velocity, with or without a driver — the second route
by which an individual runs a vehicle business on the platform.

### 11.1 Listing your car (host)

`submitSpecialRidesApplication` requires:

- **Car details** — make, model, year, plate, colour, seats, transmission
  (manual/automatic), mileage, features;
- **Location** — address + city (geohashed);
- **Price per day** — **500–10,000 PKR**;
- **at least one photo**;
- **insurance proof** and **vehicle registration** documents;
- owner name and phone, optional renter instructions.

Status `pending` → `adminReviewSpecialRidesApplication` approves (optionally
capping the daily rate via `maxDailyRate`), rejects with a reason, or asks for
resubmission. Approval creates the live listing with a **1-year availability
window**. `updateSpecialRidesApplication` and `deleteSpecialRidesListing` let a
host maintain it; `adminSuspendHost` stops a bad actor taking new bookings.

Host dashboard (`getSpecialRidesDashboard`) has five stages: `none`, `pending`,
`rejected`, `active`, `suspended`. **“My posted cars” only appears once
approved.**

### 11.2 Renting a car (guest)

- `getSpecialRidesListings` — browse approved cars with full details.
- `getSpecialRidesListingDetails` — one car + owner contact.
- `bookSpecialRidesCar` — pick pickup and return dates; days are computed by
  ceiling. `totalPrice = days × pricePerDay`, plus an optional **professional
  driver at 1,000 PKR/day**. Full breakdown shown before confirming.
- `confirmSpecialRidesBooking` — the **host** confirms the request.
- `cancelSpecialRidesBooking`.
- Booking status: `pending → confirmed → completed` (or `cancelled`).
- Payment and handover are arranged directly between host and guest.

Listings also carry `totalBookings`, `totalRating`, `avgRating`.

---

## 12. Franchises

`franchises/index.ts`, admin page **Franchises**, component
`components/FranchisesPanel.tsx`.

Franchisees are **businesses** that recruit and manage drivers under Velocity —
the corporate counterpart to the individual Partner Program.

- `adminCreateFranchise` — name, owner, email, phone, city, and a
  `commissionRate` defaulting to **5%**.
- `adminAssignFranchise` — attach or detach a driver, keeping `totalDrivers`
  correct on both sides of a move.
- The franchise earns its rate on rides by its drivers, **taken from Velocity's
  platform commission, not from the driver's payout**, and it is paid **first**
  in the settlement waterfall ([§10.7](#107-earning-on-a-ride)).
- Franchise documents track `cycleRevenue` and `totalRevenue`.

---

## 13. Travel Partner

`backend/functions/src/travelMate/*`, screens
`app/passenger/travel-mate/*`. Admin page: **Travel Partner**.

> Naming note: the product is called **Travel Partner** in every user-facing
> string. Code identifiers, routes and Firestore collections are still
> `travelMate*` from the original name — that is intentional and must not be
> renamed.

**What it is:** find people who make the same commute as you, agree to travel
together, split fares, form groups, and take part in a city-based social feed.

### 13.1 The identity wall

Travel Partner is a **separate identity** from your ride account. This is a
hard architectural rule, not a convention:

- `upsertTravelMateProfile` writes **only** `travelMateProfiles/{uid}`. It never
  writes `users/{uid}`.
- The **only** time it reads `users/{uid}` is when you explicitly ask to reuse
  your ride photo (`copyRidePhoto: true`) — a one-time, read-only copy that
  produces a **physically independent** file under `travelMate/{uid}/`, never a
  live link. Changing or deleting your ride photo later can never affect your
  Travel Partner avatar, or vice versa.
- `ratingAvg` / `ratingCount` are server-managed and unsettable by the client.
- Geohashes are computed server-side, so the feed's geo queries are trustworthy.
- Every social function touches only `travelMate*` collections (plus a read-only
  FCM token lookup). None of them can read trips or driver data.

### 13.2 Your profile

`app/passenger/travel-mate/setup.tsx`, `profile.tsx`, `travel-locations.tsx`.

Display name, gender, **gender preference** (`male` / `female` / `any`), bio
(≤200 chars), photo, home location, destination (office / university / other,
with name and coordinates), and a schedule: **days of the week**, departure time
and return time (`HH:MM`), plus an `active` flag.

### 13.3 Discovery — the swipe deck

`getTravelMateFeed` (`app/passenger/travel-mate/discover.tsx`). Because the rules
forbid clients from reading other people's profiles, **all** candidate data comes
through this callable, which applies every match rule server-side:

- `active === true`, not you, not already swiped, not already in your deck;
- **mutual** gender compatibility — you must accept them *and* they must accept
  you;
- **route overlap** — their destination within your discovery radius (geohash
  proximity);
- at least one **overlapping commute day**;
- ranked by closest departure time to yours.

Only minimal public card fields come back — **never a home address, never any
ride-identity data**. UI: `TravelMateCard`.

### 13.4 Swipes, matches and the like quota

`travelMateSwipe` is the single source of truth for the paywall:

- a right-swipe (**like**) consumes quota; a left-swipe (**pass**) is free;
- all quota maths runs inside **one** Firestore transaction, so it cannot be
  raced or bypassed;
- period resets are lazy, keyed on Asia/Karachi day and month strings — no cron
  dependency;
- on a **mutual** like, a match document with a deterministic id is created and
  both users are pushed;
- the response carries the next reset instant so the client can show a countdown.

At launch `travelMateFree` is **true**, so likes are effectively unlimited for
everyone.

### 13.5 Chat, and the message-request rule

`sendTravelMateMessage`, plus `matches.tsx`, `chats.tsx`,
`chat/[matchId].tsx`, `message-requests.tsx`.

- Instagram-style: someone you have **not** matched with gets **one** opening
  message and then waits. `acceptTravelMateMessageRequest` opens the thread for
  both sides; `declineTravelMateMessageRequest` wipes it and the sender cannot
  retry.
- Messages carry text and/or **one attachment**: photo, shared GPS location,
  phone contact, or an arbitrary file (≤50 MB). Attachment URLs must point at our
  own Storage bucket (`travelMateChat/{uid}/…`), so a message cannot smuggle an
  external link. See `src/chat/attachments.ts`, `ChatModal`, `EmojiPicker`.
- `reactToTravelMateMessage` — emoji reactions.
- `unmatchTravelMate`, `reportTravelMateUser` (optionally auto-unmatching).

### 13.6 Groups and fare split

`createTravelMateGroup`, `joinTravelMateGroup`, `settleTravelMateSplit`,
`previewTravelMateGroup`, `sendTravelMateGroupMessage`; screens
`group/[groupId]`, `group-chat/[groupId]`, `group-invite/[groupId]`.

- A matched user starts a **2–4 person** commute group (`maxGroupSize` from
  `config/travelMateSettings`), with a name, destination and shared schedule.
- Joining is by invite link or code.
- After the group rides together on **one normal trip**, `settleTravelMateSplit`
  divides the fare equally via wallet transfers **between the passengers**. The
  driver is paid the full fare as usual and **sees nothing different — zero
  driver-side change.**
- `openTravelMateDirectChat` opens a private DM with a group member.

### 13.7 Shareable ride links

`shareTravelMateRide`, `getSharedTravelMateRide`, `bookSharedTravelMateRide`;
screen `shared-ride/[shareId]`.

A passenger turns one of their trips into a shareable ride, optionally tied to a
group (in which case a ride card is posted into the group chat so every member
sees it). Resolving a link returns a route snapshot plus whether the viewer is
**eligible** to book — a travel partner of the sharer, or a fellow group member.
Regular users with no Travel Partner profile and non-partners are rejected with a
reason the app can act on. Only `travelMate*` collections are written; the sharer's
own trip is read once to snapshot the route.

### 13.8 The community feed

`travelMate/community.ts`, `adminCommunity.ts`; screens `feed.tsx`,
`feed-search.tsx`, `feed-profile/[uid]`, `post/[postId]`, `communities.tsx`,
`community/[communityId]`, `blocked-users.tsx`.

- `createTravelMatePost` — text plus an optional image or short video, to the
  general feed or into a city community.
- `deleteTravelMatePost` — author or admin; removes media, likes and comments.
- `likeTravelMatePost` — toggle; the counter is maintained server-side in a
  transaction.
- `commentTravelMatePost` / `deleteTravelMateComment` — comment author or post
  author may delete; the post author is pushed on new comments.
- `createTravelMateCommunity` — **a city is required**, so everyone always sees
  which city a group belongs to. `joinTravelMateCommunity` /
  `leaveTravelMateCommunity`.
- `openTravelMateFeedChat` — a private 1:1 chat with another community member,
  reusing the match chat infrastructure so the existing chat screen and
  `sendTravelMateMessage` work unchanged.
- `blockTravelMateUser` — closes any open chat, removes follow edges **both
  ways**, and the blocker never sees them again (feed, search and discover all
  filter on the block list). `unblockTravelMateUser` from the Blocked users
  screen.
- Follows power the feed and profile screens.

Tabs (`TravelMateTabBar`): **Home · Feed · Matches · Chats · Profile**.

### 13.9 Moderation and admin

- `adminSuspendTravelMateProfile` — suspend an abusive profile.
- `adminUpdateTravelMatePost` — edit or take down a post.
- `adminUpsertTravelMateCommunity` / `adminDeleteTravelMateCommunity` — curate
  city communities.
- Reports land in a queue on the **Travel Partner** admin page.

### 13.10 Subscriptions (built, switched off)

`travelMatePlans/{planId}` — name, billing period (`weekly` / `yearly`), price
in PKR, `dailyLikeAllowance`, active flag. Admin CRUD:
`adminCreateTravelMatePlan`, `adminUpdateTravelMatePlan`,
`adminDeleteTravelMatePlan` (**soft delete only**, so existing subscription
documents referencing a plan stay readable).

- `requestTravelMateSubscription` creates a **pending** request. It grants
  nothing. Manual rails require a payment screenshot.
- `approveTravelMateSubscription` is what actually grants the allowance
  (`travelMateQuota/{uid}`), debits the wallet if the method was wallet (never
  escrow — a rejected request costs nothing), writes a
  `travelmate_subscription` entry to `platformLedger` and bumps
  `system/counters.travelMateRevenue`. `rejectTravelMateSubscription` closes it.
- `expireTravelMateSubscriptions` — scheduled expiry sweep.
- While `travelMateSubscriptionsEnabled` is **false**, requests are declined with
  “Travel Partner is free for everyone right now”, and plans show *Coming Soon*.
- An active subscription **removes ads app-wide** ([§15](#15-ads-and-monetisation)).

---

## 14. Money — wallet, commission, settlement, payouts

Full detail in [PAYMENTS.md](PAYMENTS.md); the essentials:

### 14.1 Wallet

`wallets/{uid}` (balance, currency, `outstanding`) plus an immutable
`transactions` ledger. **Never client-writable.** Screens:
`app/passenger/wallet.tsx`, `app/driver/wallet.tsx`, `WalletScreen`,
`TopUpSheet`, `OutstandingFees`.

### 14.2 Top-ups and gateways

`createTopupIntent` → `paymentIntents` doc → gateway checkout → verified
`paymentWebhook` → **idempotent** wallet credit. Provider chosen by
`PAYMENTS_PROVIDER`:

- **`mock`** — dev/CI, no real money; the only provider implementing
  `TokenizingProvider`, so the whole saved-methods flow is testable end to end.
- **`payfast`** — the recommended single-contract aggregator (cards, JazzCash,
  Easypaisa, HBL Konnect, bank transfer; accepts individuals and unregistered
  businesses). ⚠️ **The adapter is a scaffold, not a verified integration** —
  three things must be checked against the merchant integration pack before the
  first live rupee: the access-token endpoint path, the `SIGNATURE` formula and
  the production base URL. `PAYFAST_BASE_URL` has no live default, so it fails
  closed.
- **`jazzcash`, `easypaisa`** — fully implemented direct adapters (Page
  Redirection v1.1 with HMAC-SHA256 secure-hash verification; Easypay hosted
  checkout). Going live for these is **configuration only**; no webhook needs
  registering, since the signed checkout form already carries the per-intent
  callback URL.

A provider appears in the app's top-up picker automatically once its credentials
are non-empty (`getPaymentOptions`).

### 14.3 Saved payment methods (connected accounts)

inDrive-style: authorise Velocity once at the gateway, then top up with one tap.
`createPaymentMethodSetup` → hosted `paymentMethodSetupPage` → gateway →
`paymentMethodCallback` stores a reusable token → `topupWithSavedMethod` charges
it server-to-server through **the same idempotent credit path** the webhook uses.

Token security: display data in `paymentMethods/{id}` (owner-readable); the
chargeable token in `paymentMethodSecrets/{id}`, which the rules **deny to every
client, owner and admin alike** — server-only via the Admin SDK. A `tokenDead`
result marks the method `revoked` so the user is prompted to reconnect rather
than retrying a dead instrument forever. Also `getPaymentMethods`,
`setDefaultPaymentMethod`, `deletePaymentMethod`.

Gated behind its **own** flag (`savedPaymentMethodsEnabled`), separate from
top-ups, because tokenisation is a distinct merchant permission every Pakistani
gateway grants on top of plain checkout.

### 14.4 Manual settlement (bank transfer + AI-checked screenshot)

The launch path, since top-ups are off. A locked driver transfers what they owe to
Velocity's account (`config/settlementAccounts`) and uploads a screenshot.

`submitCommissionSettlement` sends it to a Claude vision model
(`lib/paymentProofAI.ts`, `ANTHROPIC_API_KEY` secret) which checks the receipt is
genuine, **≥ the amount due**, and sent to a **Velocity** account. Policy is
**safe auto-unlock**:

- clearly genuine + correct amount + correct recipient → settles automatically
  (resets the cycle, ledgers `platformLedger` source `manual_bank`, bumps
  `manualCommissionCollected`, unlocks the driver);
- obvious fake → rejected, driver re-uploads;
- **anything uncertain — and everything, if no AI key is set** — becomes a
  `commissionSettlements` doc with status `pending_review` for
  `adminReviewCommissionSettlement` (admin page **Settlements**).

AI-approve and admin-approve share the same money transaction
(`applyManualSettlement`).

The identical flow clears **cancellation-fee debt**
(`submitCancellationFeeSettlement`, `kind: 'cancellation_fee'`, same review
queue, `applyCancellationFeeSettlement`) — and it clears only `amountDue`, so a
fee charged *after* the transfer was sent survives rather than being silently
forgiven.

### 14.5 The platform's books

- `platformLedger/{id}` — append-only, one entry per realised revenue event
  (`ride_commission` wallet/cash, `cancellation_fee`,
  `cancellation_fee_settled`, `travelmate_subscription`). Admin-read only,
  written exclusively inside the money transactions.
- `system/counters` — running totals: `walletCommissionCollected`,
  `cashCommissionCollected`, `manualCommissionCollected`,
  `cancellationFeesCharged/Collected/Outstanding`, `travelMateRevenue`, plus trip
  totals. Powers the admin **Overview**.
- `adminSetSettlementAccounts` maintains the receiving accounts the app shows.

---

## 15. Ads and monetisation

`src/ads/*` — AdMob via `react-native-google-mobile-ads`. **Two units total**
(one banner, one interstitial), reused across placements:

| Type | Placement |
|---|---|
| Banner | Travel Partner — above the tab bar on all 5 tabs |
| Banner | Earn — pinned bottom (excluding apply/withdraw) |
| Banner | “Where to?” — below the destination results |
| Interstitial | Entering the Travel Partner swipe deck |
| Interstitial | After a free-tier partner application submits |

- **Paying users see none of them.** `useAdsEnabled` clears ads **app-wide** if
  *either* an active Travel Partner subscription *or* the **Pro** partner tier is
  held — someone paying for Pro who still saw banners in the booking sheet would
  read it as the payment not working, and that becomes a refund request. The
  listeners are a module-level singleton keyed by uid, because up to three
  banners can be mounted at once and each extra `onSnapshot` costs real money on
  a low-end handset.
- Unit IDs come from `EXPO_PUBLIC_ADMOB_*` and are **validated** against
  `ca-app-pub-################/##########`; anything missing or malformed falls
  back to Google's official **TestIds**. That's the safety property: requesting a
  real unit from a debug build is invalid traffic, and repeated invalid traffic
  gets an AdMob account limited. You must opt in to real revenue deliberately.
- The `.web` stubs render nothing, keeping the native SDK out of the web bundle.

### 15.1 What the Play listing exposes, and why

Written up because it was investigated once, on the assumption that switching ads
off would take the developer's home address off the listing. **It would not** —
ads control the “Contains ads” badge, and nothing else here. Ads stay ON; the
address is a Play Console / payments-profile matter with no lever in this repo.

Google's documented default for a **personal** account is that only the
*country* is published — the verification page lists the field as “Legal address
(**country** shown on Google Play)” for personal accounts, versus “Legal address
(shown on Google Play)” for organization accounts. The listing currently shows a
full street address, so something is overriding that default. There are exactly
two documented overrides:

- **Merchant account.** Google's wording: *“merchant accounts (developer accounts
  with apps that monetize via **paid apps or in-app purchases**) must show their
  full address on Google Play”*, taken from the linked **Google payments
  profile**, not from anything editable in Play Console. Note what is *absent*
  from that definition: ads. Velocity has no paid app and no IAP — rides are a
  physical service paid in cash or by manual upload, which is why Play Billing
  does not apply (it covers *digital* goods).
- **EU/EEA distribution.** Under the DSA a developer who has declared **trader**
  status has name, address, phone and email published on every listing available
  in the EU, regardless of monetisation. This is the likelier cause here, and it
  matches the shape of what the listing shows.

The open question is which of the two applies — check the trader declaration and
EU/EEA country availability first, then whether a merchant/payments profile is
attached. To change the address rather than hide it, edit the **payments
profile**; an organization account does not hide it either, it only substitutes a
business address for a home one.

**Velocity stays free, with no in-app purchases.** Rides are a physical service
paid in cash or by manual payment upload, so Play Billing does not apply — it
covers *digital* goods. That also keeps the app clear of the merchant-account
rule above. See §14 for the money flow.

> **Careful, if ads are ever switched off:** §9.2 “Find your Customers” is *also*
> advertising for Play's purposes — a business paying to push an offer to nearby
> users is a third-party ad, even though no ad network is involved. An
> **Ads → No** declaration would only be truthful with both AdMob **and**
> business-ad delivery off. Today both run, and **Ads → Yes** is correct.

**Revenue lines overall:** ride commission (10% default) · cash-cycle commission
settlement · cancellation fees · business-ad plans · partner Pro fees ·
Travel Partner subscriptions (off) · AdMob · intercity seats · courier/freight ·
Special Rides.

---

## 16. Notifications

`lib/fcm.ts` server-side, `src/lib/notifications.ts` client-side.

- `registerFcmToken` stores tokens at `users/{uid}/fcmTokens/{tokenTail}`.
- **Expo push tokens are delivered through the FCM Admin SDK** — this is the
  transport that was once silently dead; check it first if pushes break.
- `notifyUser` / `sendToUser` / `sendToUsers` / `broadcastNotification`, with
  categories (`system`, `promo`, …) and data payloads carrying a `screen` for
  deep-linking. Business-ad pushes carry `imageUrl` for big-picture cards.
- `adminSendPushNotification` — admin broadcast (admin page and mobile
  `admin/send-notification.tsx`).
- In-app inbox: `app/passenger/notifications.tsx`.

Notification-bearing events include: bid received, bid accepted, driver arriving,
ride completed, pool joined / rider added en route, pool match on a saved daily
route, scheduled ride booked or skipped, commission lock and settlement verdicts,
CNIC / driver / partner / advertiser / rental application verdicts, withdrawal
decisions, Travel Partner matches, messages, comments and group activity, and
business offers nearby.

---

## 17. Safety

- `raiseSafetyEvent` — a trip participant raises **SOS** or a **route-deviation**
  alert (optional location and note), rate-limited to 10/minute. The event id is
  stamped on the trip as `activeSafetyEventId`.
- `safetyEvents/{id}` is readable only by the reporter and admins.
- `resolveSafetyEvent` (admin) closes it. The admin **Safety desk** subscribes to
  open events live; the **Live ops map** shows the field.
- Other safety-relevant surfaces: driver and vehicle documents verified before
  approval, ratings both ways, `reportOpenRequest` for fake requests,
  `driverBlockPoolPassenger`, `reportPoolGenderMisrepresentation`, the pool gender
  rules, Travel Partner reporting/blocking, and full visibility of every co-rider
  added mid-trip.

---

## 18. Voice booking

`app/passenger/voice.tsx` + `src/voice/*`
(`parser`, `lexicon`, `gazetteer`, `normalize`, `phrases`, `commands`, `speech`).

Speak a trip instead of typing it. **Zero cost, fully on-device: no server call,
no API key, no model, no per-booking cost** — it works with the network down
until the booking itself is placed.

- One conversation loop: listen → understand → ask for whatever is missing →
  read the result back → hand off.
- It **stops short of booking**: once the slots are filled it pushes to the normal
  booking screen with them prefilled, so the map, the real fare from the fare
  engine, and the final confirm are the ones every other passenger sees. Voice
  solves understanding; it does not get its own money path.
- The parser claims tokens in order of confidence: **known places first**
  (they can legitimately contain digits — “F 7” — so they must claim before the
  number scan reads them as seat counts), then keywords (ride type, pool/solo,
  seats, sentence markers), and whatever is left, minus filler, goes to
  autocomplete as typed text.
- **Negation** — “AC nahi chahiye” contains “ac”; a match is discarded if a
  negation word sits within 3 tokens either side.
- **Self-correction** — “mini… nahi nahi AC wali” is normal speech, so the **last**
  surviving match wins, not the first.
- It **never guesses**: a missing slot is reported and asked for out loud, which
  is cheaper and far more predictable than a model that occasionally invents a
  value.
- Accessibility drives the layout: very large type, one control at a time, and
  every spoken line is also printed — so a user who cannot read gets the whole
  flow by ear, and a user who cannot hear gets it by eye. There is deliberately
  **no language selector**; Urdu/Roman-Urdu/English are handled by the same
  lexicon (`src/i18n/ur.ts` covers Urdu strings).
- Driver side: `DriverVoiceButton`.

---

## 19. Admin console

Next.js app at the repo root (`app/`, `components/`, `lib/`), deployed to
Firebase App Hosting at
`velocity--velocity-fe379.us-east4.hosted.app`. Email sign-in, **admin-claim
gated** — non-admins are rejected. `/link` serves the share-link interstitial.

| Page | What it does |
|---|---|
| **Overview** | Live platform counters — revenue, commissions, payouts, trips |
| **Driver approvals** | Verify / reject / suspend pending drivers; view documents |
| **CNIC verification** | The courier identity queue |
| **Passengers** | Search, edit, ban, create, delete rider accounts |
| **Disputes** | Open disputes and resolutions |
| **Partner Program** | Applications, tiers, fleets, levels, fraud logs, withdrawals, suspensions, rates and Pro pricing |
| **Advertise** | Business-ad applications, live ads, moderation, advertiser suspension, price bands and notification budget |
| **Special Rides** | Rental applications, active listings, hosts, suspensions |
| **Ride settings** | Fare configuration per city, ride types, pool settings |
| **Payouts** | Driver cash-out queue; mark paid |
| **Live ops map** | Real-time supply and demand |
| **Travel Partner** | Plans, subscription approvals, profile suspensions, community/post moderation |
| **Safety desk** | Open SOS / route-deviation events; resolve |
| **Commission** | Rate and lock threshold |
| **Cancellation fees** | Passenger/driver rates and the outstanding limit |
| **Settlements** | Manual bank-transfer proofs awaiting review (commission **and** cancellation-fee kinds) |
| **Feature flags** | Flip the launch-posture flags live |
| **App version** | Publish the current version for the in-app update prompt |
| **Franchises** | Create franchises, assign drivers |
| **Create driver** | Provision a driver directly |

There is also a small in-app admin surface (`app/admin/*` in the mobile app):
dashboard, riders, customers, fare config, courier orders, freight orders,
intercity trips, send notification.

> ⚠️ **After every Play rollout, publish the new version in admin → App version
> *including the build number*, or nobody gets prompted to update.**
> `Constants.versionCode` is dead in expo-constants 56; the build number now
> comes from `expo-application`.

---

## 20. Security model

See [SECURITY.md](SECURITY.md) and [HARDENING.md](HARDENING.md). The shape of it:

- **Default-deny Firestore rules** (~43 KB of them) plus Storage rules. Clients
  read what they own; almost nothing money- or trust-related is client-writable.
- **Roles as custom claims**, writable only by the backend, read identically by
  the rules and the callable guards (`lib/guards.ts`: `requireAuth`,
  `requireRole`, `requireAdmin`, `invalid`).
- **Every callable input is Zod-validated**, with tight bounds on strings,
  numbers and enums.
- **Every client-supplied quantity that matters is re-derived server-side** —
  fares, radii, ad slots, plan prices, expiries, notification counts, pool
  fares, commission.
- **Uploaded URLs must belong to our own Storage bucket**, checked on every path
  that accepts one.
- **Rate limits** on abusable callables (`lib/ratelimit.ts`) — e.g. `createTrip`
  5/min, business-ad apply 5/hour, nearby-ads 40/hour, SOS 10/min.
- **Secrets split from display data** — `paymentIntentSecrets`,
  `paymentMethodSecrets`, `paymentMethodSetupSecrets` are denied to every client,
  including admins.
- **Maps keys never ship in the client** — Places/Directions/Geocoding go through
  the backend proxy with the server key. (Remaining task: restrict the Maps key
  in the Google Cloud console.)
- **`auditLogs`** records every privileged action, immutably.
- **Two Actions secrets** hold backend config: a `PAYMENTS_GATEWAY_ENV` block and
  `GOOGLE_MAPS_SERVER_KEY`.
- Tests: security-rules suite under `tests/` (Firestore emulator) and unit tests
  throughout `backend/functions/src/**/__tests__` (fares, corridor, en-route
  match and fare, pool batching, drop radius, commission, credit flows,
  cancellation fees, payment methods, scheduled rides, commute, daily-route
  match, geo, session exchange, pool requests). Backend tests must run against
  the **`demo-velocity`** project id — a wrong project id makes `clearFirestore`
  target the wrong database and produces fake rate-limit failures.

---

## 21. Configuration reference

### 21.1 Feature flags — `config/featureFlags`

| Flag | Default | Effect when off |
|---|---|---|
| `walletTopupEnabled` | `false` | Top-ups show *Coming Soon*; `createTopupIntent` / `getPaymentOptions` decline; booking is cash-only |
| `savedPaymentMethodsEnabled` | `false` | Connecting, charging and removing an instrument all decline |
| `travelMateSubscriptionsEnabled` | `false` | Paid plans show *Coming Soon*; subscription requests decline |
| `travelMateFree` | `true` | Likes unlimited for everyone (very high free allowance) |

Admin-editable from **Feature flags** and read live by the app — flipping one
re-enables a feature app-wide with no deploy.

### 21.2 Pricing and rules config documents

| Document | Contents |
|---|---|
| `fareConfig/{cityId}` | Full fare engine config per city |
| `config/commissionSettings` | `rate` (0.10), `threshold` (5000) |
| `config/cancellationSettings` | `passengerFeeRate` (0.05), `driverFeeRate` (0.08), `outstandingLimit` (300) |
| `config/poolSettings` | `dropRadiusM` (default 1000) |
| `config/partnerSettings` | Free/Pro rates, `proMonthlyFee` (4500), `minWithdrawal` (500), `holdHours` (72), receiving accounts |
| `config/businessAdSettings` | Bands, currency, `planMonths`, `notifyCooldownHours` (12), `maxNotifPerUserPerDay` (6), receiving accounts |
| `config/travelMateSettings` | `maxGroupSize` (4), discovery radius |
| `config/settlementAccounts` | Velocity's Easypaisa / JazzCash / bank details |
| `config/appVersion` | Update-prompt configuration |
| `travelMatePlans/{planId}` | Subscription plans |
| `promoCodes/{CODE}` | `active`, `discountFlat`, `usageCount`, `usageLimit` |

Every one of these is admin-maintained, so prices and rules change **without a
new build**.

### 21.3 Environment / secrets

- `PAYMENTS_PROVIDER`, plus the provider credential keys listed in
  `backend/functions/.env.example` (shipped in CI via the
  `PAYMENTS_GATEWAY_ENV` Actions secret, written to
  `backend/functions/.env.velocity-fe379` before deploy).
- `GOOGLE_MAPS_SERVER_KEY` — the Maps proxy key.
- `ANTHROPIC_API_KEY` — the payment-proof vision check. Without it, **every**
  proof goes to human review (fail-safe).
- `EXPO_PUBLIC_ADMOB_BANNER_ID`, `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID` — real ad
  units; unset ⇒ test ads.

### 21.4 `config/appVersion`

`enabled`, `latestVersion`, `latestBuild`, `minSupportedVersion`,
`releaseNotes`, `storeUrl`. `src/lib/appUpdateRules.ts` is the pure decision:
a build **below the published minimum** makes the prompt **mandatory** (no
Cancel button) — reserved for releases that genuinely cannot interoperate, never
for nagging.

---

## 22. Data model reference

| Path | Writer | Notes |
|---|---|---|
| `users/{uid}` | backend + owner (whitelisted fields) | Profile, role mirror, `activeTripId`, `cnicVerification`, `gender`, `mixedRideOk` |
| `users/{uid}/fcmTokens/{tail}` | backend | Push tokens |
| `users/{uid}/dailyRoutes/{id}` | owner | Saved commutes for pool alerts |
| `drivers/{uid}` | backend + owner (presence only) | Verification, vehicle, rating, franchise, commission cycle |
| `userPresence/{uid}` | owner | Coarse position; **not client-readable**; TTL |
| `driverRoutes/{uid}` | backend | Declared “heading home” corridor |
| `trips/{id}` (+ `/bids`) | **backend only** | The trip state machine; pool fields; share code |
| `poolShareCodes/{code}` | backend | Invite-code → trip |
| `poolRides/{id}` (+ `/passengers`) | backend | Driver-posted pools |
| `poolRideRequests/{id}` | backend | Leader-initiated pool negotiation |
| `scheduledRides/{id}` | backend | Recurring auto-booked rides |
| `commuteSchedules/{uid}` | backend | Daily commute registration for driver demand |
| `courierOrders/{id}`, `freightRequests/{id}` | backend | Delivery |
| `intercityTrips/{id}` (+ bookings, messages) | backend | City-to-City |
| `specialRidesApplications/{uid}`, `specialRidesListings/{uid}`, `specialRidesBookings/{id}` | backend | Rentals |
| `wallets/{uid}` (+ `/transactions`) | **backend only** | Balance, `outstanding`, immutable ledger |
| `paymentIntents`, `paymentIntentSecrets` | backend | Top-ups; secrets client-denied |
| `paymentMethods`, `paymentMethodSecrets`, `paymentMethodSetups`, `paymentMethodSetupSecrets` | backend | Connected instruments; tokens denied to all clients |
| `payouts/{id}` | backend | Driver cash-outs |
| `commissionSettlements/{id}` | backend | Manual proof queue (commission + cancellation-fee kinds) |
| `platformLedger/{id}` | backend | Append-only platform revenue |
| `system/counters` | backend | Dashboard totals |
| `partners/{uid}`, `partner_applications/{uid}`, `partner_fleets/{id}`, `driver_referrals/{uid}`, `passenger_referrals/{uid}`, `partner_transactions/{id}`, `partner_wallets/{uid}`, `withdraw_requests/{id}`, `partner_fraud_logs/{id}` | backend | Partner Program |
| `businessAdApplications/{uid}`, `businessAdvertisers/{uid}`, `businessAds/{id}` (+ `/daily/{day}`), `businessAdImpressions/{adId}_{uid}`, `businessAdNotifyBudget/{uid}_{day}` | backend | Find your Customers |
| `travelMateProfiles/{uid}`, `travelMateMatches/{pair}`, `travelMateGroups/{id}`, `travelMatePosts`, `travelMateCommunities`, `travelMateSubscriptions`, `travelMatePlans`, `travelMateQuota/{uid}` | backend | Travel Partner (identity-walled) |
| `franchises/{id}` | backend | Franchise partners |
| `safetyEvents/{id}` | backend | SOS / deviation; reporter + admin |
| `auditLogs/{id}` | backend | Privileged-action trail |
| `config/*`, `fareConfig/*`, `promoCodes/*` | admin | Public app config |

---

## 23. Callable function index

Grouped as exported from `backend/functions/src/index.ts`.

**Auth** `exchangePhoneSession`

**Users & roles** `onUserCreate` · `onUserDelete` · `setUserRole` ·
`banPassenger` · `createDispute` · `resolveDispute` · `registerFcmToken` ·
`adminCreatePassenger` · `adminUpdatePassenger` · `adminDeletePassenger` ·
`uploadUserPhoto` · `adminSendPushNotification`

**CNIC** `submitCnicVerification` · `adminReviewCnicVerification`

**Drivers** `submitDriverOnboarding` · `approveDriver` · `rejectDriver` ·
`adminCreateDriver` · `updateDriver` · `deleteDriver` · `payCommission` ·
`claimDriverRole` · `submitCommissionSettlement` ·
`adminReviewCommissionSettlement`

**Franchises** `adminCreateFranchise` · `adminAssignFranchise`

**Trips** `createTrip` · `placeBid` · `raiseTripFare` · `acceptBid` ·
`updateTripStatus` · `cancelTrip` · `completeTrip` · `reportOpenRequest` ·
`getNearbyActivity`

**En-route** `setDriverRoute` · `endDriverRoute` · `getEnRouteMatches` ·
`acceptEnRouteRider` · `getPoolRiders`

**Pool share** `getPoolTripByCode` · `joinPoolTrip` · `setPoolVisibility` ·
`getNearbyPublicPoolTrips`

**Pool rides** `startPoolBoarding` · `poolArrivePassenger` ·
`poolPassengerBoarded` · `completePoolRide` · `joinPoolRide` ·
`driverAcceptPoolBatch` · `cancelPoolJoinRequest` · `driverBlockPoolPassenger` ·
`reportPoolGenderMisrepresentation`

**Pool requests** `createPoolRideRequest` · `driverRespondToRequest` ·
`leaderRespondToOffer` · `joinPoolRideRequest` · `cancelPoolRideRequest` ·
`getNearbyPoolRequests` · `getNearbyActiveRides`

**Commute & schedules** `upsertCommuteSchedule` · `deleteCommuteSchedule` ·
`getCommuteDemand` · `upsertScheduledRide` · `deleteScheduledRide` ·
`runScheduledRides`

**Fares** `getFareEstimate` · `submitBid` · `getPoolingQuote` · `seedFareConfig`

**Ratings & safety** `submitRating` · `raiseSafetyEvent` · `resolveSafetyEvent`

**Payments** `getPaymentOptions` · `createTopupIntent` · `paymentCheckout` ·
`paymentWebhook` · `mockConfirmTopup` · `requestPayout` · `markPayoutPaid` ·
`adminSetSettlementAccounts` · `submitCancellationFeeSettlement` ·
`getPaymentMethods` · `createPaymentMethodSetup` · `paymentMethodSetupPage` ·
`paymentMethodCallback` · `mockConfirmPaymentMethod` · `setDefaultPaymentMethod` ·
`deletePaymentMethod` · `topupWithSavedMethod`

**Maps** `placesAutocomplete` · `placeDetails` · `geocodeAddress` ·
`getDirections`

**Intercity** `createIntercityBooking` · `cancelIntercityBooking` ·
`sendIntercityMessage` · `adminCreateIntercityTrip` · `adminUpdateIntercityTrip` ·
`adminCancelIntercityTrip` · `seedIntercityTrips`

**Couriers & freight** `createCourierOrder` · `cancelCourierOrder` ·
`adminUpdateCourierStatus` · `createFreightRequest` · `cancelFreightRequest` ·
`acceptFreightQuote` · `adminUpdateFreightStatus`

**Business ads** `getBusinessAdPlans` · `submitBusinessAdApplication` ·
`adminReviewBusinessAdApplication` · `createBusinessAd` · `updateBusinessAd` ·
`setBusinessAdStatus` · `adminSetBusinessAdStatus` · `adminSuspendAdvertiser` ·
`adminUpdateBusinessAdSettings` · `checkNearbyBusinessAds` ·
`recordBusinessAdClick` · `getBusinessAdDashboard` · `expireBusinessAdPlans`

**Partner Program** `submitPartnerApplication` ·
`adminReviewPartnerApplication` · `getPartnerTiers` · `previewPartnerFleet` ·
`claimPartnerReferral` · `adminReassignReferral` · `getMyReferral` ·
`maturePartnerEarnings` · `adminMarkRideStatus` · `requestPartnerWithdrawal` ·
`adminReviewWithdrawal` · `adminSuspendPartner` · `adminUpdatePartner` ·
`adminDeletePartner` · `getPartnerDashboard` · `getPartnerFleetMembers` ·
`getPartnerMemberRides` · `recomputePartnerLevels`

**Special Rides** `submitSpecialRidesApplication` ·
`adminReviewSpecialRidesApplication` · `getSpecialRidesDashboard` ·
`adminSuspendHost` · `getSpecialRidesListings` ·
`getSpecialRidesListingDetails` · `updateSpecialRidesApplication` ·
`deleteSpecialRidesListing` · `bookSpecialRidesCar` ·
`confirmSpecialRidesBooking` · `cancelSpecialRidesBooking`

**Travel Partner** `getTravelMateFeed` · `upsertTravelMateProfile` ·
`travelMateSwipe` · `requestTravelMateSubscription` ·
`approveTravelMateSubscription` · `rejectTravelMateSubscription` ·
`adminCreateTravelMatePlan` · `adminUpdateTravelMatePlan` ·
`adminDeleteTravelMatePlan` · `expireTravelMateSubscriptions` ·
`sendTravelMateMessage` · `reactToTravelMateMessage` · `unmatchTravelMate` ·
`reportTravelMateUser` · `acceptTravelMateMessageRequest` ·
`declineTravelMateMessageRequest` · `adminSuspendTravelMateProfile` ·
`createTravelMateGroup` · `joinTravelMateGroup` · `settleTravelMateSplit` ·
`shareTravelMateRide` · `getSharedTravelMateRide` · `bookSharedTravelMateRide` ·
`sendTravelMateGroupMessage` · `openTravelMateDirectChat` ·
`previewTravelMateGroup` · `createTravelMatePost` · `deleteTravelMatePost` ·
`likeTravelMatePost` · `commentTravelMatePost` · `deleteTravelMateComment` ·
`createTravelMateCommunity` · `joinTravelMateCommunity` ·
`leaveTravelMateCommunity` · `openTravelMateFeedChat` · `blockTravelMateUser` ·
`unblockTravelMateUser` · `adminUpdateTravelMatePost` ·
`adminUpsertTravelMateCommunity` · `adminDeleteTravelMateCommunity`

---

*Generated from the code on 10 August 2026. Numbers quoted as defaults
(fares, rates, fees, radii, thresholds) are the shipped defaults — all of them
are admin-configurable at runtime, so treat the config documents in
[§21](#21-configuration-reference) as the source of truth for what is live.*
