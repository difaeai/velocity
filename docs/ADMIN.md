# Velocity — Admin Panel (Next.js)

The operations console for Velocity, gated to the `admin` role. Deployed via
**Firebase App Hosting** (see [`../../docs/DEPLOY.md`](../../docs/DEPLOY.md)).

## Stack
- Next.js 16 (App Router) · React 19 · TypeScript
- Firebase JS SDK (Auth, Firestore, Functions)

## Features
- Email sign-in, **admin-claim gated** (non-admins are rejected)
- **Overview** — live platform counters (revenue, commissions, payouts, trips)
- **Driver approvals** — verify/reject pending drivers (calls the backend callables)
- **Safety desk** — open SOS / route-deviation events, resolve them

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (also type-checks)
```

Config defaults to the `velocity-fe379` project; override with `NEXT_PUBLIC_FIREBASE_*`.
Reads/writes are enforced by Firestore rules — the signed-in user needs the
`admin` custom claim.

## Structure
```
app/
├── layout.tsx              # root layout + providers
├── page.tsx                # routes to /login or /dashboard
├── login/page.tsx          # email sign-in + admin check
└── dashboard/
    ├── layout.tsx          # admin guard + nav
    ├── page.tsx            # overview (counters)
    ├── drivers/page.tsx    # driver approvals
    └── safety/page.tsx     # safety desk
lib/        firebase init, auth context, typed admin API
components/  Providers + shared UI
```
