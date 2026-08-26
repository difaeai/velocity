# WhatsApp alerts for offline drivers

A driver with the app closed gets no push notification — there is nothing to
push to. On a budget Android phone the OS has usually killed Velocity within
minutes of them switching off. So the ride request sits in a feed nobody is
looking at while an approved driver, two streets away, has no idea it exists.

WhatsApp reaches that person. This document is how the feature is set up, and —
more importantly — the rules it runs under.

---

## The thing to understand first

**A WhatsApp business number is not a phone line you can spam and apologise for
later.** Meta scores every sender on a *quality rating* built from how the
people receiving its messages react. Blocks and "Report" taps push it down.
Enough of them and the number is throttled to a lower messaging tier, then
flagged, then restricted — and a restricted number can be taken out of service.
There is no support queue worth relying on to get it back.

The number is the business's identity on WhatsApp. Losing it is not a bug, it is
losing the channel.

Every rule below exists for that reason. None of them are style preferences.

---

## The nine rules the code enforces

| # | Rule | Where |
|---|------|-------|
| 1 | **Opt-in only.** A driver is never messaged until they switch alerts on themselves. `setWhatsAppAlerts` is the only code path in the repo that can set `optIn: true` — no admin tool, no migration, no script. | `whatsapp/index.ts` |
| 2 | **Templates only.** Business-initiated messages are pre-approved templates. Free-form text outside the 24-hour service window is both refused by the API and the fastest way to get flagged. | `whatsapp/client.ts` |
| 3 | **Instant STOP.** A driver replying STOP (English, Roman Urdu or Urdu) or tapping the template's *Stop alerts* button is opted out and blocked within the same second the webhook lands. | `whatsapp/index.ts` |
| 4 | **Scarcity.** Alerts only go out when fewer than `onlineDriverThreshold` approved drivers are already online nearby. If the ride will be taken anyway, the message is noise. | `whatsapp/policy.ts` |
| 5 | **Quiet hours.** Nothing between 22:00 and 07:00 PKT. An ignored 3am message is a block waiting to happen. | `whatsapp/policy.ts` |
| 6 | **Frequency caps.** Minimum 45 minutes between messages to one driver; at most 4 per driver per day; at most 10 drivers woken per ride; at most 400 messages platform-wide per day. | `whatsapp/policy.ts` |
| 7 | **Liveness.** Drivers not seen in the app for 21 days are skipped, and any number Meta reports as undeliverable is blocked permanently. Dead numbers generate undeliverables, and undeliverables are themselves a spam signal. | `whatsapp/alerts.ts` |
| 8 | **Circuit breaker.** The first time Meta returns a code meaning the *account* is in trouble — spam rate limit, policy block, template paused or disabled — every send on the platform stops and stays stopped until a human clears it in the admin console. | `whatsapp/alerts.ts` |
| 9 | **Strict number validation.** Only `92 3XX XXXXXXX` mobiles are ever attempted. Landlines and malformed numbers are dropped before they reach the API. | `whatsapp/client.ts` |

The breaker never resets itself. That asymmetry is deliberate: a day of not
sending costs some drivers some rides, while not stopping costs the number.

---

## One-time setup

### 1. Meta account

1. Create a **Meta Business account**, then a **WhatsApp Business Account (WABA)**
   at [business.facebook.com](https://business.facebook.com).
2. Add a phone number that is **not** already registered on the WhatsApp or
   WhatsApp Business app. Registering an in-use number wipes its chat history.
3. In **Meta for Developers** → your app → WhatsApp → API Setup, note the
   **Phone number ID** (a long numeric id — *not* the phone number itself).
4. Create a **System User** with the `whatsapp_business_messaging` and
   `whatsapp_business_management` permissions and generate a **permanent access
   token**. The temporary 24-hour token from the setup page is for curl tests
   only; a deployment using it silently stops working the next day.

### 2. The message template

Create the template in **WhatsApp Manager → Message templates**.

- **Name:** `offline_driver_ride_alert`
- **Category:** **Utility** — *not* Marketing. This is an alert about a service
  the recipient has signed up to provide, and Utility templates are both cheaper
  and held to a different per-user frequency limit.
- **Language:** English (`en`)

**Body** (four variables, in this order):

```
Hi {{1}}, a {{2}} ride for PKR {{3}} is waiting near {{4}}.
Open Velocity to see it and place your fare.
```

**Buttons:**

| Type | Label | Value |
|------|-------|-------|
| Visit website (dynamic) | `View ride` | `https://velocityrides.app/link/driver/request-detail/{{1}}` |
| Quick reply | `Stop alerts` | — |

The URL variable is the trip id; `driverDeepLink()` in `whatsapp/alerts.ts`
builds the same URL, and `/link/...` bounces the driver into the installed app
via the `velocity://` scheme (or to the Play Store if it is not installed).

The **Stop alerts** quick reply is not optional. It gives an annoyed driver a
one-tap exit that costs us one recipient, instead of the Block button, which
costs the number a piece of its rating.

Sample as it arrives:

> Hi Imran, a Moto ride for PKR 240 is waiting near F-10 Markaz.
> Open Velocity to see it and place your fare.
> **[ View ride ]  [ Stop alerts ]**

### 3. Backend secrets

Add **one** GitHub Actions secret named `WHATSAPP_ENV`, holding a block of
`KEY=value` lines (the same shape as `PAYMENTS_GATEWAY_ENV`, kept separate so
the token can be rotated without reconstructing credentials nobody can read back
out of GitHub):

```
WHATSAPP_TOKEN=EAAG...the permanent System User token
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_TEMPLATE_NAME=offline_driver_ride_alert
WHATSAPP_TEMPLATE_LANG=en
WHATSAPP_VERIFY_TOKEN=any-long-random-string-you-choose
WHATSAPP_APP_SECRET=the App Secret from Meta app settings → Basic
```

`deploy-functions.yml` appends the block to the functions `.env` on deploy.
With the secret absent, `whatsAppConfig()` returns null and the feature stays
dark — rides are unaffected.

`WHATSAPP_APP_SECRET` is load-bearing: without it the webhook rejects every
request, because a public endpoint that edits driver consent and cannot tell
Meta from anyone else is worse than one that does nothing.

### 4. Webhook

After the first deploy, the webhook lives at:

```
https://asia-south1-velocity-fe379.cloudfunctions.net/whatsappWebhook
```

In **Meta for Developers → WhatsApp → Configuration → Webhook**:

1. Callback URL: the URL above.
2. Verify token: whatever you set as `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe to the **`messages`** field. That single field carries both
   inbound replies (opt-outs) and delivery statuses (failures).

Meta disables a webhook that keeps returning non-2xx, and a disabled webhook
means opt-outs stop arriving — the worst possible thing to break. The handler
therefore answers `200` even when its own processing throws.

### 5. Arm it

Nothing sends until someone deliberately turns it on. From the admin console
(or a direct call to `adminSetWhatsAppAlertSettings`):

```js
adminSetWhatsAppAlertSettings({ enabled: true })
```

Start with the defaults. Watch `adminGetWhatsAppStatus` and the quality rating
in WhatsApp Manager for a week before loosening anything.

---

## Tuning

`config/whatsappAlerts` — every value is clamped on read, so a bad edit cannot
become a bad send:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Master switch |
| `radiusKm` | `5` | How far from the pickup a driver may be |
| `minGapMinutes` | `45` | Minimum gap between messages to one driver |
| `maxPerDriverPerDay` | `4` | Per-driver daily ceiling |
| `maxRecipientsPerTrip` | `10` | How many drivers one ride may wake |
| `dailyGlobalCap` | `400` | Platform-wide daily budget |
| `quietStartHour` / `quietEndHour` | `22` / `7` | Silent window, PKT |
| `onlineDriverThreshold` | `3` | Only alert when fewer than this are online nearby |
| `staleDriverDays` | `21` | Skip drivers not seen in this long |
| `minFare` | `0` | Do not wake anyone for less than this |

`config/whatsappHealth.circuitOpen` is the breaker. Clear it with
`adminSetWhatsAppAlertSettings({ clearCircuitBreaker: true })` — and only after
checking the quality rating in WhatsApp Manager, because the breaker tripped for
a reason.

---

## Watching it

`adminGetWhatsAppStatus` returns today's counters from `whatsappUsage/{day}`:

- `reserved` — slots taken out of the daily budget
- `sent` — messages Meta accepted
- `failed` / `dropped` — refusals, and numbers permanently blocked
- `optOuts` — drivers who replied STOP
- `optOutRate` — **the number to actually watch**

A rising opt-out rate is the earliest visible proxy for the quality rating, and
it shows up days before the rating itself moves. If it climbs, the answer is
always the same: send less. Raise `minGapMinutes`, lower `maxPerDriverPerDay`,
raise `onlineDriverThreshold`. Never explain it away.

---

## Cost

Meta bills per business-initiated conversation. Utility templates in Pakistan
are roughly USD 0.005–0.01 each, so the 400/day default cap is on the order of
USD 2–4 per day at full spend — and full spend only happens if the platform
genuinely has 400 rides a day nobody online can serve.

Utility templates sent inside an open service window (a driver replied in the
last 24 hours) are free.

---

## What is deliberately NOT built

- **No passenger messaging.** Passengers have the app open when they book.
- **No marketing templates.** Nothing promotional ever goes out on this number.
  Utility only, tied to a live ride request.
- **No admin "message all drivers" button.** It would be an unsolicited campaign
  by definition, and it is the single most effective way to lose the number.
- **No opt-in from the admin side.** Consent has one origin: the driver's own
  switch, or their own reply on WhatsApp.
