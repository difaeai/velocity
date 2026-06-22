# Security

This document maps every loophole in the original prototype to the control that
now closes it, and lists the hardening still planned.

## Loopholes in the original demo → fixes

| # | Loophole (legacy demo) | Fix in this stage |
|---|------------------------|-------------------|
| 1 | **Firestore in “test mode”** — the entire database was world-readable and world-writable. | `firestore.rules` is **default-deny**. Every path requires auth and an explicit allow. Verified by `tests/firestore.rules.test.mjs`. |
| 2 | **No authentication** — anyone could act as anyone. | Firebase Auth required for all access; identity flows from `request.auth`. |
| 3 | **Client decided money** — fares, the 10% commission and payouts were computed in the browser and written to Firestore. | All money math lives in `backend/functions/src/domain/fares.ts` and is applied only by `completeTrip` inside a transaction. `system/counters` and `wallets/*` are **server-write-only**. |
| 4 | **Client could self-approve as a driver / admin.** | Roles are **custom claims** only the backend sets (`setUserRole`, `approveDriver`). Rules trust the claim, not client data. Driver verification fields are server-only. |
| 5 | **Trip state was client-controlled.** | `trips/*` is server-write-only; transitions go through guarded callables that validate the actor and the state-machine edge. |
| 6 | **No field-level protection** — a write could smuggle privileged fields. | Where clients may write at all (own profile, driver presence), rules use `affectedKeys().hasOnly([...])` whitelists. Privilege fields (`role`, `verificationStatus`, `rating`, `balance`) are never in a whitelist. |
| 7 | **Sensitive documents would be world-readable.** | `storage.rules`: KYC/vehicle docs are readable only by the owner and admins; uploads are type- and size-capped. |
| 8 | **No input validation.** | Every callable validates its payload with **zod** before doing anything. |

## Security model

- **Authentication:** required everywhere (rules + callable guards).
- **Authorisation:** role from custom claims (`passenger` | `driver` | `admin`),
  set exclusively by the backend.
- **Server authority:** money, roles, verification, trip state and counters are
  written only by Cloud Functions (the Admin SDK bypasses rules; clients cannot
  touch these paths).
- **Least privilege:** clients can write only their own profile (safe fields)
  and their own driver presence — nothing else.
- **Auditability:** privileged actions append to `auditLogs`.

## Bootstrapping the first admin

There is intentionally no self-serve path to `admin`. Create the first one once,
out of band, after the user has signed in at least once:

```bash
# Using the Admin SDK / a one-off script (never expose this in the app):
admin.auth().setCustomUserClaims('<uid>', { role: 'admin' });
```

Thereafter admins manage roles via `setUserRole`.

## Verifying the rules

```bash
cd tests && npm install && npm test
```

The suite asserts: default-deny for anonymous users, server-only financial
counters, admin-only counter reads, safe self-profile edits, **blocked privilege
escalation**, blocked cross-user access, server-only trip writes,
participant-only trip reads, driver presence-vs-verification separation,
server-only wallets, and admin-only config writes. (11 checks, all passing.)

## Hardening still planned (later stages)

- **Firebase App Check** (Play Integrity / App Attest) so only genuine app
  builds can call the backend.
- **Phone-auth abuse controls**: reCAPTCHA/SMS region allow-list, rate limiting.
- **Per-IP / per-user rate limiting** on callables.
- **App Check + reCAPTCHA Enterprise** on the admin panel.
- **Secret management** via Cloud Functions secrets for payment-gateway keys
  (never committed; `.gitignore` already blocks service-account files and `.env`).
- **PII minimisation & retention policy** for location and KYC data.
- **Crash/error monitoring** and alerting on `safetyEvents`.

> Note on the Firebase web API key in `legacy-demo/`: a Firebase Web API key is
> **not a secret** (it identifies the project, it does not grant access). The
> real protection is the security rules + App Check above — which is exactly
> what this stage adds.
