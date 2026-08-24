# Velocity — Admin Panel (Next.js)

The operations console for Velocity, gated to the `admin` role. Deployed via
**Firebase App Hosting** (see [`DEPLOY.md`](DEPLOY.md)).

## Stack
- Next.js 16 (App Router) · React 19 · TypeScript
- Firebase JS SDK (Auth, Firestore, Functions, Storage)
- No UI or charting dependency — inline styles and hand-rolled SVG charts

## Two sections

The console runs two businesses that have almost nothing to do with each other,
so the sidebar splits at the top level. The URL decides which section is open,
so a deep link lands with the right one showing.

### Manage app — running the platform

| Group | Pages |
|---|---|
| — | **Overview** — KPIs, trends and the queues that need a person today |
| People | Driver approvals · CNIC verification · Passengers · Disputes · Safety desk |
| Operations | Live ops map · Ride settings · Special Rides · Travel Partner |
| Money | Payouts · Commission · Settlements · Cancellation fees |
| Growth | Partner Program · Fleet submissions · Advertise |
| System | Feature flags · App version |

### Manage social — marketing it

| Group | Pages |
|---|---|
| — | **Overview** — what is wired up, which accounts are live, when the next post goes out |
| Channels | Connected accounts |
| Content | Content calendar · Approval queue · Automation |

Full write-up: [`SOCIAL.md`](SOCIAL.md).

## The overview page

One callable — `adminGetAnalytics` — returns a daily series plus a live
snapshot. Finished days are computed once and cached at
`analyticsDaily/{YYYY-MM-DD}`; only today is recomputed, so widening the range
from 7 to 90 days costs a handful of reads rather than a scan of every trip.

Charts live in [`components/charts.tsx`](../components/charts.tsx): a time
series, stacked daily columns, horizontal category bars, a status split and a
sparkline. They render at real pixel size (the container is measured rather than
a viewBox scaled to fit), every card offers a table view, and the two-series
palette is validated for colour-blind separation and 3:1 contrast on white.
Velocity's forest green is UI chrome, not a series colour — it is far too dark to
sit beside a second hue on a white card.

## Branding

Everything on the web renders the app icon, generated from one master file by
[`scripts/generate-brand-assets.mjs`](../scripts/generate-brand-assets.mjs):

```bash
node scripts/generate-brand-assets.mjs   # after any change to the app icon
```

It traces `apps/mobile/assets/icon.png` into an SVG path and writes
`components/BrandMark.tsx`, the two brand SVGs in `public/brand/`, and
`app/icon.png` / `app/apple-icon.png` / `app/favicon.ico`. Import
`VelocityMark` (bare, inherits `currentColor`) or `VelocityIcon` (on its dark
tile) — never draw a letter in a box.

Do **not** add an `icons` entry to the root layout's `metadata`: an explicit one
overrides Next's file convention, which is how the tab kept serving the stock
Next.js favicon.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (also type-checks)
```

Config defaults to the `velocity-fe379` project; override with
`NEXT_PUBLIC_FIREBASE_*`. Reads and writes are enforced by Firestore rules — the
signed-in user needs the `admin` custom claim.

## Structure

```
app/
├── layout.tsx                    # root layout, fonts, metadata
├── icon.png / apple-icon.png / favicon.ico   # generated from the app icon
├── page.tsx                      # the public marketing site
└── (app)/
    ├── login/page.tsx            # email sign-in + admin check
    ├── link/[[...slug]]/         # public deep-link interstitial
    └── dashboard/
        ├── layout.tsx            # admin guard + the two-section sidebar
        ├── page.tsx              # Manage app → overview (charts)
        ├── …                     # one folder per operational desk
        └── social/               # Manage social → overview, accounts,
                                  #   calendar, queue, automation
components/
├── BrandMark.tsx                 # GENERATED — the traced logo
├── charts.tsx                    # the SVG chart set
├── ui.tsx                        # Button, Card, StatCard, Badge
├── social/shared.tsx             # platform badges, status pills, readiness
└── site/                         # the marketing site's components
lib/                              # firebase init, auth context, typed callables
```
