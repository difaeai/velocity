# Sign-in codes over WhatsApp

Velocity sends its login OTP as a WhatsApp message and falls back to Firebase
SMS. This document is why, how to set it up, and what it is safe to assume.

---

## Why

Firebase bills every verification SMS it sends, per message, by destination
country. Pakistan is not one of its cheap ones — a single login is several US
cents, and it is charged again on every resend.

Meta bills an approved **AUTHENTICATION** template to a Pakistani number at
roughly **USD 0.0115** per message (Meta's own published Pakistan rate as of the
April 2026 card; verify on the live rate card before budgeting). That is on the
order of a fifth of what the same code costs as an SMS, on a business number
Velocity is already running for offline-driver alerts.

Same six digits, same phone, a fraction of the bill.

**The exact saving depends on Firebase's Pakistan tier**, which Google publishes
per-country and changes; read it off the project's own billing rather than from
this page. The direction is not in doubt — WhatsApp is several times cheaper —
but the multiple is.

---

## The thing to understand first

**WhatsApp is the cheap path, not the only path.**

An offline-driver alert that cannot be sent is a ride nobody hears about. A
sign-in code that cannot be sent is a customer locked out of the app. Those are
not the same kind of failure, and the code does not treat them the same way.

So `startWhatsAppOtp` never fails a login. Every refusal — no approved template,
admin kill switch, daily budget spent, Meta pausing the template, a number that
is not on WhatsApp at all — comes back as `{ sent: false, via: 'sms' }`, and the
app falls through to the native Play-Integrity-attested Firebase flow that was
there before and is still wired up.

With nothing configured, the feature is inert and every login goes by SMS exactly
as it used to. That is the safe default, and it is what ships until the template
below exists.

---

## What changed, and what deliberately did not

| | Before | Now |
|---|---|---|
| Who proves the number | Firebase (native SDK + Play Integrity) | **Velocity's backend**, against a code it generated |
| Where the code arrives | SMS | WhatsApp, else SMS |
| How a session is minted | `exchangePhoneSession` → custom token | `verifyWhatsAppOtp` → custom token (SMS path unchanged) |
| uid, claims, Firestore rules | — | **unchanged** |

That third row is the one to read twice. Firebase's flow had a property this one
does not: Google verified the number and the backend merely believed the result.
Now **the endpoint is the verification** — `verifyWhatsAppOtp` mints a session
for whoever presents a matching code. Every control between a stranger and
somebody else's account is in `backend/functions/src/auth/whatsappOtp.ts`:

| Control | Value | Why it is load-bearing |
|---|---|---|
| Code source | `crypto.randomInt` | `Math.random` is reconstructable from a few observed draws |
| Storage | HMAC-SHA256, never the code | A leaked snapshot must not be a list of live codes |
| Comparison | `timingSafeEqual` | A code must not be walkable digit by digit off the clock |
| Wrong guesses | **5, then the challenge is dead** | One-in-a-million only means anything because guessing stops |
| Lifetime | 5 minutes, single use | A shoulder-surfed code is worthless by the time it is typed |
| Sends per number | 5/hour | Each one costs money, and the endpoint is unauthenticated |
| Platform budget | 3,000/day, transactional | A burst of logins must not all read the same count |

**Existing accounts are untouched.** `getUserByPhoneNumber` resolves the same
E.164 number to the same uid, so a passenger who signed up through Firebase's SMS
flow comes back with the same trips, wallet, claims and role. Nothing is
migrated because nothing needs to be — only the way the number was proved has
changed.

---

## One-time setup

The token, the phone-number id and the webhook are already done if
[WHATSAPP_ALERTS.md](WHATSAPP_ALERTS.md) has been followed. This feature adds one
template and two environment variables.

### 1. The template

WhatsApp Manager → Message templates → Create.

- **Category:** **Authentication** — not Utility, not Marketing. Meta enforces
  this: an OTP sent on a Utility template is a policy violation, and the
  authentication category is what buys the copy-code button and the
  anti-forwarding treatment.
- **Name:** `velocity_login_code` (anything, as long as it matches the env var)
- **Language:** English (`en`)

Authentication templates do not have a body you write. Meta supplies it —
`{{1}} is your verification code` — and you choose the add-ons:

| Option | Set it to | Why |
|---|---|---|
| Security disclaimer | **on** ("do not share this code") | Free, and it is the single most effective anti-social-engineering line available |
| Expiry warning | **on, 5 minutes** | Must match `CODE_TTL_SEC`, or the message promises something the server does not honour |
| Button | **Copy code** | Works on every platform and needs nothing registered |

As it arrives:

> **045912** is your verification code. For your security, do not share this code.
> This code expires in 5 minutes.
> **[ Copy code ]**

#### About the one-tap button

Meta also offers a **one-tap autofill** button, which is nicer on Android — the
code never has to be copied. It is not the default here because it must be
registered *on the template* with the app's package name and the SHA-256 of the
**Play App Signing** certificate, and registered against the wrong key it
degrades into a button that does nothing, which is worse than Copy code.

If you set it up, switch `WHATSAPP_OTP_BUTTON` to `one_tap`. The two send
payloads are genuinely different — copy-code buttons take a `coupon_code`
parameter, one-tap buttons take plain text — and sending the wrong one is
`(#100) Invalid parameter`, the same trap documented for the alert template.
That shape is pinned by `src/whatsapp/__tests__/otpTemplate.test.ts`.

### 2. Backend secrets

Add these lines to the **existing `WHATSAPP_ENV`** GitHub Actions secret (the
same block the alert credentials live in — `deploy-functions.yml` appends the
whole block, so no workflow change is needed):

```
WHATSAPP_OTP_TEMPLATE_NAME=velocity_login_code
WHATSAPP_OTP_TEMPLATE_LANG=en
WHATSAPP_OTP_BUTTON=copy_code
```

`WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are shared with the alerts and
must already be there. **`WHATSAPP_OTP_TEMPLATE_NAME` is the switch**: without
it, `whatsAppOtpConfig()` returns null and every login goes by SMS.

> **The one that catches everyone, again: the language code.** `en` and `en_US`
> are different templates as far as the API is concerned, and a mismatch is error
> 132001 — which suppresses WhatsApp OTP for half an hour and quietly bills every
> login in that window to Firebase. Check the code shown in WhatsApp Manager.

Optional hardening:

```
OTP_PEPPER=any-long-random-string
```

Codes are stored as an HMAC keyed with this. Six digits fall to a brute force in
milliseconds without a key, so with the pepper a leaked database snapshot is not
a list of live codes; without it the hash is domain separation and nothing more.
It is optional on purpose — a login must not be able to break on a missing
secret — but there is no reason not to set it. Rotating it invalidates codes
issued in the previous five minutes and nothing else.

### 3. Firestore TTL

Add a TTL policy on collection `otpChallenges`, field `expireAt` (see
[HARDENING.md](HARDENING.md)). Housekeeping only — a challenge is dead five
minutes in regardless — but without it every login ever served accumulates.

### 4. Check the wiring

There is no separate test callable for this: use a real phone. Sign in with your
own number and watch `adminGetWhatsAppStatus` — `otp.configured` says whether the
backend can see a template, `today.otpSent` should tick up, and
`otp.suppressedUntil` names the half-hour stand-down if Meta refused.

A login that silently arrives as an SMS means WhatsApp declined; the function log
line `WhatsApp: send failed` carries Meta's code and is the only place the reason
exists.

---

## Levers

`adminSetWhatsAppOtpSettings` writes `config/whatsappOtp`. Every value is clamped
on read, so a bad edit cannot become a bad send.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Kill switch. Off → every login goes back to SMS immediately |
| `dailyCap` | `3000` | Platform-wide codes per PKT day; spent → SMS |
| `maxSendsPerNumberPerHour` | `5` | Per-number ceiling. **Refuses rather than falling back** |
| `clearSuppression` | — | Lifts an automatic stand-down early |

`enabled` defaults **on**, unlike the alert settings which default off. The
difference is consent: alerts message people who have not asked and must be armed
deliberately, while a code only ever goes to somebody who just tapped Continue.

`maxSendsPerNumberPerHour` is the one refusal that does *not* fall back to SMS.
Handing a dearer channel to a number that has already had five codes in an hour
would reward exactly the behaviour the limit exists to stop.

### Suppression is not the alerts circuit breaker

When Meta returns an account-level refusal, WhatsApp OTP steps aside for **30
minutes** and then tries again by itself. The alerts breaker, by contrast, never
resets itself and has to be cleared by a human.

They are opposites on purpose. Sending alerts into a quality problem makes the
problem worse, so stopping is free. Here every minute switched off is a minute of
logins billed at Firebase's rate and nobody is being annoyed by a code they asked
for, so the cost of staying off is real and the cost of retrying is not. The two
features share a phone number and nothing else, and **neither can switch the
other off**.

---

## What is deliberately NOT built

- **No WhatsApp-only mode.** The SMS path stays wired up and is not behind a
  flag. Removing it would mean anybody whose SIM is not on WhatsApp cannot use
  Velocity at all, and would hand Meta an outage switch over the entire funnel.
- **No per-IP rate limiting.** Pakistani mobile carriers CGNAT heavily; a limit
  tight enough to stop a script would lock out a working-class neighbourhood
  sharing one egress address. The per-number limit and the daily cap are the
  spend controls.
- **No admin "resend a code to this user" tool.** It would be an endpoint that
  mails a live credential to a number an admin types, which is the shape of every
  account-takeover-by-support-desk story there is.
- **No code in a push notification, log line or error message.** The code exists
  in exactly two places: Meta's wire, and an HMAC in Firestore.
