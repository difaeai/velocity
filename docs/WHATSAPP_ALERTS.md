# WhatsApp alerts for offline drivers

A driver with the app closed gets no push notification — there is nothing to
push to. On a budget Android phone the OS has usually killed Velocity within
minutes of them switching off. So the ride request sits in a feed nobody is
looking at while an approved driver, two streets away, has no idea it exists.

WhatsApp reaches that person. This document is how the feature is set up, and —
more importantly — the rules it runs under.

> The same business number also carries **sign-in codes**, which are a different
> feature with different rules — see [WHATSAPP_OTP.md](WHATSAPP_OTP.md). They
> share the token, the phone-number id and the webhook, and nothing else: an
> alert is business-initiated and governed by consent, a code is asked for and
> governed by cost. Neither can switch the other off.

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

## The ten rules the code enforces

| # | Rule | Where |
|---|------|-------|
| 1 | **Opt-in only.** A driver is never messaged until they switch alerts on themselves. `setWhatsAppAlerts` is the only code path in the repo that can set `optIn: true` — no admin tool, no migration, no script. | `whatsapp/index.ts` |
| 2 | **Templates only.** Business-initiated messages are pre-approved templates. Free-form text outside the 24-hour service window is both refused by the API and the fastest way to get flagged. | `whatsapp/client.ts` |
| 3 | **Instant STOP.** A driver replying STOP (English, Roman Urdu or Urdu) or tapping the template's *Stop alerts* button is opted out and blocked within the same second the webhook lands. | `whatsapp/index.ts` |
| 4 | **App must be closed, not merely offline.** A driver toggled Offline while sitting in the app is skipped. The ride is already one tap away on their screen, so the message buys nothing, costs a paid conversation, and reads as pestering. Requires both the foreground heartbeat *and* the offline-toggle stamp to be quiet for `appClosedAfterMinutes`. | `whatsapp/policy.ts` |
| 5 | **Scarcity.** Alerts only go out when fewer than `onlineDriverThreshold` approved drivers are already online nearby. If the ride will be taken anyway, the message is noise. | `whatsapp/policy.ts` |
| 6 | **Quiet hours.** Nothing between 22:00 and 07:00 PKT. An ignored 3am message is a block waiting to happen. | `whatsapp/policy.ts` |
| 7 | **Frequency caps.** Minimum 45 minutes between messages to one driver; at most 4 per driver per day; at most 10 drivers woken per ride; at most 400 messages platform-wide per day. | `whatsapp/policy.ts` |
| 8 | **Liveness.** Drivers not seen in the app for 21 days are skipped, and any number Meta reports as undeliverable is blocked permanently. Dead numbers generate undeliverables, and undeliverables are themselves a spam signal. | `whatsapp/alerts.ts` |
| 9 | **Circuit breaker.** The first time Meta returns a code meaning the *account* is in trouble — spam rate limit, policy block, template paused or disabled — every send on the platform stops and stays stopped until a human clears it in the admin console. | `whatsapp/alerts.ts` |
| 10 | **Strict number validation.** Only `92 3XX XXXXXXX` mobiles are ever attempted. Landlines and malformed numbers are dropped before they reach the API. | `whatsapp/client.ts` |

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
WHATSAPP_TEMPLATE_BUTTON_INDEX=0
WHATSAPP_VERIFY_TOKEN=any-long-random-string-you-choose
WHATSAPP_APP_SECRET=the App Secret from Meta app settings → Basic
```

`deploy-functions.yml` appends the block to the functions `.env` on deploy.
With the secret absent, `whatsAppConfig()` returns null and the feature stays
dark — rides are unaffected.

`WHATSAPP_TEMPLATE_BUTTON_INDEX` is optional and defaults to `0`, the layout
above. Meta indexes a template's buttons by their position in the template, so
if the approved template lists **Stop alerts** before **View ride**, the URL
button is at index `1` and a send against index `0` is rejected as
`(#100) Invalid parameter`. Set it to `none` if the URL button turned out to be
static — a button whose URL does **not** end in `{{1}}` accepts no parameter at
all, and sending one is the same error. Both are properties of what Meta
approved rather than of the code, which is why they are configuration.

`WHATSAPP_APP_SECRET` is load-bearing: without it the webhook rejects every
request, because a public endpoint that edits driver consent and cannot tell
Meta from anyone else is worse than one that does nothing.

> **The one that catches everyone: the language code.** Whatever WhatsApp
> Manager shows next to the template — `en` or `en_US` — must be exactly what
> `WHATSAPP_TEMPLATE_LANG` says. They are different templates as far as the API
> is concerned, and a mismatch comes back as error 132001, which is classified
> `halt` and switches the whole feature off before it has ever delivered a
> message. Verify with `adminSendWhatsAppTest` (below) before arming anything.

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

### 5. What the driver sees

**Driver drawer → 💬 WhatsApp ride alerts** (also reachable from Settings, and
offered once the first time a driver goes offline).

The screen does two jobs on purpose:

- **The number.** A driver's WhatsApp is very often *not* the number they drive
  on — a second SIM, a family handset, the number their own customers already
  have. They can correct it here, and the corrected number then outranks the
  profile number for every later opt-in, so a toggle from Settings can never
  silently redirect alerts back to a phone with no WhatsApp on it. Alerts sent
  to a number that is not on WhatsApp bounce, and bounces count against the
  sender — so letting drivers fix this is a rating measure, not a convenience.
- **The consent**, stated in full *before* the switch: a few a day at most,
  nothing between 10pm and 7am, only real rides, and STOP works any time.

The masked number comes back from `setWhatsAppAlerts` and is shown in the
confirmation, so a mistyped digit is caught immediately rather than by an alert
that never arrives.

### 6. Check the wiring before arming it

`adminSendWhatsAppTest({ phone: '03XX XXXXXXX' })` sends one real template
message to a number you type — your own handset — and reports exactly what Meta
said.

It deliberately does **not** trip the circuit breaker, touch any driver record,
or spend the daily budget. Setup has five things that all have to agree (token,
phone-number id, template name, language code, parameter count) and every way
they can disagree arrives as a `halt`, which is right for a live system and
awful for a first attempt. This is the wiring check that keeps those separate,
and it names the two mismatches that account for almost every failed first try.

A `messages` array back from Meta and a message on your phone means everything
is correct. Then, and only then:

### 7. Arm it

Nothing sends until someone deliberately turns it on. From the admin console
(or a direct call to `adminSetWhatsAppAlertSettings`):

```js
adminSetWhatsAppAlertSettings({ enabled: true })
```

Start with the defaults, with one exception. **An unverified Meta business is
capped at roughly 250 business-initiated conversations per 24 hours**, and the
default `dailyGlobalCap` is 400 — so until Business Verification clears, set it
below the tier limit or sends will start failing against Meta's ceiling rather
than ours:

```js
adminSetWhatsAppAlertSettings({ dailyGlobalCap: 200 })
```

Watch `adminGetWhatsAppStatus` and the quality rating in WhatsApp Manager for a
week before loosening anything.

### A note on where the values live

The Phone Number ID and WABA ID are identifiers, not credentials — but this
repository is public, so none of the six values belong in it. They live in the
`WHATSAPP_ENV` GitHub secret and nowhere else. The WABA ID is not among them:
no code path calls it. It is what you need for WhatsApp Manager URLs and for
querying template status by hand, so keep it with your notes rather than here.

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
| `appClosedAfterMinutes` | `5` | How quiet the app must be before it counts as closed |
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

## How "app closed" is decided

Offline is a toggle. Closed is a state. Confusing the two is the difference
between a message that helps and one that is billed for annoying somebody.

Two signals, and **both** must be quiet for `appClosedAfterMinutes`:

- **`drivers/{uid}.appActiveAt`** — the driver app's foreground heartbeat, from
  `src/hooks/appHeartbeat.ts`. It is written on entering the foreground and
  every two minutes after, from the driver *layout*, so it covers every driver
  screen rather than just Home. Backgrounding stops it; a killed app stops it by
  definition, which is precisely the signal that makes a driver eligible again.
- **`drivers/{uid}.lastSeenAt`** — stamped when the Offline toggle is flipped.
  This is what catches the exact problem case on an install that predates the
  heartbeat: somebody who went offline thirty seconds ago is still holding
  their phone.

A **missing** `appActiveAt` counts as *closed*, not as unknown. Reading it as
"the app might be open" would silence the feature for every install that has not
updated yet — the drivers it was built for — and `lastSeenAt` still covers the
case that actually costs money.

The heartbeat is self-reported, so it is only ever used to send **less**. A
driver who somehow faked it would suppress nothing but their own alerts. It is
allowed by name in `firestore.rules` alongside the other presence fields; the
write is rejected without that entry, which would silently disable the gate.

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
