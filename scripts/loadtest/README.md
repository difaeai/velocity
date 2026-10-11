# Load testing and index coverage

Four scripts that answer two questions nobody can answer by reading the code:
**is every query indexed**, and **how many users until this gets slow**.

They need no deploy and cost nothing to run. `verify-indexes-against-prod.js` is
the one exception — it reads the live database (read-only, one document per
query shape).

## Is every query indexed?

```bash
node scripts/loadtest/check-indexes.js
```

Parses every `.where(...)` / `orderBy(...)` chain in `backend/functions/src`,
`apps/mobile`, `app`, `lib` and `components`, works out which ones need a
composite index, and checks each against `firestore.indexes.json`. Writes
`all-queries.json` (every shape it found) and `missing.json`.

Treat its "missing" list as **suspects, not findings**. Firestore serves several
shapes without a composite index — most importantly a conjunction of equality
filters, which it answers by merging single-field indexes. The static checker
cannot know that, so it over-reports. To get the real answer, ask the database:

```bash
VELOCITY_SA_KEY=./path-to-service-account.json \
  node --dns-result-order=ipv4first scripts/loadtest/verify-indexes-against-prod.js
```

This replays each shape from `all-queries.json` against production with
`limit(1)` and reports only the ones that actually come back
`FAILED_PRECONDITION: The query requires an index`, with the console URL to
create each. That distinction matters: run on 2026-10-11 it cut 19 suspected
gaps down to **1 real one**, which would otherwise have meant 18 pointless
indexes.

Note that the **Firestore emulator does not enforce index requirements at all**,
so this check cannot be done locally. It is production or nothing.

## How many users until it gets slow?

Start the emulator. `firebase emulators:start` tries to download its UI bundle
and fails on some machines, so run the jar straight:

```bash
java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar \
  --host=127.0.0.1 --port=8080
```

Then:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/loadtest/loadtest.js [amplify|concurrency|hotdoc|all]
```

It seeds a synthetic city and replays the real hot-path query sequences —
`getNearbyActivity`, `broadcastTripToNearbyDrivers`, `getSuggestedRides` — each
copied from the backend with its source line noted, so what it measures is what
production pays.

- **`amplify`** sweeps the online-driver population and reports documents read
  per call. This is the number that carries over to production unchanged, and
  the one worth watching.
- **`concurrency`** reports p50/p95/p99 as callers pile up.
- **`hotdoc`** hammers one document.

### What these numbers do and don't mean

- **Reads per call are real.** They are a property of the query, not of the
  machine, and they are what you are billed for.
- **The throughput ceiling is not real.** The emulator is one Java process on
  one laptop, so the rps plateau it hits is the laptop's, not Firestore's.
  Production scales horizontally. Use the latency curve for the *shape*
  (throughput falls as reads per call rise), never as a capacity figure.
- **`hotdoc` cannot be trusted at all.** The emulator does not enforce
  per-document write contention — it will happily do hundreds of writes per
  second to a single document, which production will not. Find hot documents by
  reading the code, not by running this.

## What would it cost?

```bash
node scripts/loadtest/capacity.js
```

Turns the measured amplification into reads/sec and a monthly bill across
concurrent-user counts, before and after the geohash bounding in
`backend/functions/src/lib/nearbyDrivers.ts`. Every input is either measured by
`loadtest.js` or read out of the code, and each one is cited in the file's
header — if a cadence changes, change it there too or the model quietly lies.

Prices are the us-central1 Standard-edition rates. `nam5` multi-region costs
more, so read the output as a floor.

One distinction the model is built around, because it changes the answer by an
order of magnitude: **10,000 registered users is not 10,000 concurrent users.**
Peak concurrency is a single-digit percentage of registrations. Decide which one
you mean before quoting any row of that table.
