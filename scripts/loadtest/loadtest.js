/**
 * Velocity load test — replays the real hot-path query sequences against the
 * Firestore emulator.
 *
 * Two things it measures, which are the two things that decide when the app
 * gets slow:
 *   1. READ AMPLIFICATION — how many documents one user action costs, and how
 *      that number grows with the size of the live population. This is the
 *      scaling law, and it carries over to production unchanged.
 *   2. LATENCY UNDER CONCURRENCY — p50/p95/p99 as simultaneous callers rise.
 *
 * The query shapes are copied from the backend verbatim (file:line noted at
 * each scenario) so the amplification measured here is the amplification prod
 * pays.
 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require(require('path').resolve(__dirname, '../../backend/functions/node_modules/firebase-admin'));
const geofire = require(require('path').resolve(__dirname, '../../backend/functions/node_modules/geofire-common'));
const ngeohash = require(require('path').resolve(__dirname, '../../backend/functions/node_modules/ngeohash'));

admin.initializeApp({ projectId: 'demo-velocity' });
const db = admin.firestore();

// Lahore-ish centre; all synthetic population is scattered around it.
const CENTRE = { lat: 31.5204, lng: 74.3587 };
const SPREAD = 0.045; // ~5 km box

const rnd = (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const jitter = (base) => base + (rnd() - 0.5) * 2 * SPREAD;

function pt() { return { lat: jitter(CENTRE.lat), lng: jitter(CENTRE.lng) }; }

async function clear() {
  for (const c of ['drivers', 'userPresence', 'trips', 'poolRideRequests', 'poolRides', 'users']) {
    let n = 0;
    while (true) {
      const snap = await db.collection(c).limit(400).get();
      if (snap.empty) break;
      const b = db.batch();
      snap.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
      n += snap.size;
      if (snap.size < 400) break;
    }
  }
}

async function seed({ drivers, presence, trips, pools }) {
  const commit = async (ops) => {
    for (let i = 0; i < ops.length; i += 450) {
      const b = db.batch();
      ops.slice(i, i + 450).forEach(([ref, data]) => b.set(ref, data));
      await b.commit();
    }
  };

  const ops = [];
  for (let i = 0; i < drivers; i++) {
    const p = pt();
    ops.push([db.collection('drivers').doc('drv' + i), {
      online: true, verificationStatus: 'approved', gender: i % 2 ? 'male' : 'female',
      lastLocation: { lat: p.lat, lng: p.lng }, displayName: 'D' + i,
      vehicleLabel: 'Car', vehicleType: i % 5 === 0 ? 'bike' : 'car',
      lastSeenAt: admin.firestore.Timestamp.now(),
    }]);
  }
  for (let i = 0; i < presence; i++) {
    const p = pt();
    ops.push([db.collection('userPresence').doc('u' + i), {
      geohash: ngeohash.encode(p.lat, p.lng, 5), lat: p.lat, lng: p.lng,
      updatedAt: admin.firestore.Timestamp.now(),
    }]);
  }
  for (let i = 0; i < trips; i++) {
    const p = pt();
    ops.push([db.collection('trips').doc('t' + i), {
      status: 'requested', passengerId: 'u' + i, pickupLat: p.lat, pickupLng: p.lng,
      pickupGeohash: ngeohash.encode(p.lat, p.lng, 6), pool: false,
      createdAt: admin.firestore.Timestamp.now(),
    }]);
  }
  for (let i = 0; i < pools; i++) {
    const p = pt();
    ops.push([db.collection('poolRideRequests').doc('p' + i), {
      status: i % 3 === 0 ? 'open' : 'active', pickupLat: p.lat, pickupLng: p.lng,
      pickupGeohash: geofire.geohashForLocation([p.lat, p.lng]),
      totalSlots: 4, filledSlots: 1, maleSeats: 1, femaleSeats: 0,
      passengers: ['seed' + i], genderPref: 'any',
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 36e5),
      createdAt: admin.firestore.Timestamp.now(),
    }]);
  }
  await commit(ops);
  await db.doc('config/rideSettings').set({ searchRadiusKm: 2 });
}

// ───────────────────────── hot paths, copied from backend ─────────────────────

/** getNearbyActivity — backend/functions/src/trips/nearbyActivity.ts:191-211 */
async function nearbyActivity(lat, lng, radiusKm = 6) {
  let reads = 0;
  const cells = neighbors(lat, lng, 5);
  const [d, pr, t, p] = await Promise.all([
    db.collection('drivers').where('online', '==', true).where('verificationStatus', '==', 'approved').get(),
    db.collection('userPresence').where('geohash', 'in', cells).limit(400).get(),
    db.collection('trips').where('status', '==', 'requested').limit(200).get(),
    db.collection('poolRideRequests').where('status', 'in', ['open', 'active', 'full']).limit(200).get(),
  ]);
  reads += d.size + pr.size + t.size + p.size;
  return reads;
}

/** broadcastTripToNearbyDrivers — backend/functions/src/trips/index.ts:466-472 */
async function broadcast() {
  let reads = 1; // config/rideSettings
  await db.doc('config/rideSettings').get();
  const d = await db.collection('drivers')
    .where('online', '==', true).where('verificationStatus', '==', 'approved').get();
  return reads + d.size;
}

/** getSuggestedRides pool scan — backend/functions/src/trips/suggestedRides.ts:261-269 */
async function suggestedRides(lat, lng, radiusKm = 5) {
  const bounds = geofire.geohashQueryBounds([lat, lng], radiusKm * 1000);
  const snaps = await Promise.all(bounds.map((b) =>
    db.collection('poolRideRequests')
      .where('status', 'in', ['open', 'active'])
      .where('pickupGeohash', '>=', b[0]).where('pickupGeohash', '<=', b[1]).get()));
  return snaps.reduce((n, s) => n + s.size, 0);
}

function neighbors(lat, lng, precision) {
  const c = ngeohash.encode(lat, lng, precision);
  return [c, ...ngeohash.neighbors(c)];
}

// ───────────────────────────── driver ─────────────────────────────

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
}

async function run(name, fn, { vus, iterations }) {
  const lat = [], readCounts = [];
  const t0 = Date.now();
  let done = 0, errors = 0;
  await Promise.all(Array.from({ length: vus }, async () => {
    while (done < iterations) {
      done++;
      const s = process.hrtime.bigint();
      try {
        const reads = await fn();
        readCounts.push(reads);
      } catch (e) { errors++; }
      lat.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
  }));
  const wall = (Date.now() - t0) / 1000;
  const avgReads = readCounts.length ? readCounts.reduce((a, b) => a + b, 0) / readCounts.length : 0;
  return {
    name, vus, iterations, errors,
    rps: +(iterations / wall).toFixed(1),
    p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1),
    readsPerCall: Math.round(avgReads),
  };
}

function table(rows, cols) {
  const head = cols.map((c) => c.padEnd(13)).join('');
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const r of rows) console.log(cols.map((c) => String(r[c] ?? '').padEnd(13)).join(''));
}

(async () => {
  const mode = process.argv[2] || 'all';
  console.log('Firestore emulator:', process.env.FIRESTORE_EMULATOR_HOST, '\n');

  if (mode === 'amplify' || mode === 'all') {
    console.log('==========================================================');
    console.log(' A. READ AMPLIFICATION vs live population');
    console.log('    (one getNearbyActivity call = one home screen, per 30s)');
    console.log('==========================================================');
    const rows = [];
    for (const n of [50, 200, 500, 1000, 2000]) {
      await clear();
      await seed({ drivers: n, presence: n * 3, trips: Math.round(n / 4), pools: Math.round(n / 5) });
      const r = await run('nearby@' + n, () => nearbyActivity(CENTRE.lat, CENTRE.lng), { vus: 4, iterations: 12 });
      const b = await run('broadcast@' + n, () => broadcast(), { vus: 4, iterations: 12 });
      rows.push({ onlineDrivers: n, nearbyReads: r.readsPerCall, nearbyP95: r.p95, bcastReads: b.readsPerCall, bcastP95: b.p95 });
    }
    table(rows, ['onlineDrivers', 'nearbyReads', 'nearbyP95', 'bcastReads', 'bcastP95']);
  }

  if (mode === 'concurrency' || mode === 'all') {
    console.log('\n==========================================================');
    console.log(' B. LATENCY vs CONCURRENCY  (500 online drivers seeded)');
    console.log('==========================================================');
    await clear();
    await seed({ drivers: 500, presence: 1500, trips: 120, pools: 100 });
    const rows = [];
    for (const vus of [1, 5, 10, 25, 50, 100]) {
      rows.push(await run('nearbyActivity', () => nearbyActivity(CENTRE.lat, CENTRE.lng), { vus, iterations: vus * 6 }));
    }
    table(rows, ['vus', 'rps', 'p50', 'p95', 'p99', 'readsPerCall', 'errors']);

    console.log('\n  getSuggestedRides (9 geohash-bound pool queries):');
    const rows2 = [];
    for (const vus of [1, 10, 50]) {
      rows2.push(await run('suggestedRides', () => suggestedRides(CENTRE.lat, CENTRE.lng), { vus, iterations: vus * 6 }));
    }
    table(rows2, ['vus', 'rps', 'p50', 'p95', 'p99', 'readsPerCall', 'errors']);
  }

  if (mode === 'hotdoc' || mode === 'all') {
    console.log('\n==========================================================');
    console.log(' C. HOT-DOCUMENT WRITE CONTENTION');
    console.log('    Firestore sustains ~1 write/sec on a single document.');
    console.log('==========================================================');
    const rows = [];
    for (const vus of [1, 10, 50]) {
      const ref = db.doc('trips/hotdoc');
      await ref.set({ n: 0 });
      rows.push(await run('same-doc write', async () => {
        await ref.update({ n: admin.firestore.FieldValue.increment(1), at: admin.firestore.Timestamp.now() });
        return 1;
      }, { vus, iterations: vus * 10 }));
    }
    table(rows, ['vus', 'rps', 'p50', 'p95', 'p99', 'errors']);
  }

  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
