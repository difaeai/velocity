/**
 * Velocity capacity model.
 *
 * Inputs are MEASURED (emulator load test) or READ FROM CODE, not guessed:
 *   nearbyActivity reads/call = onlineDrivers + 800      [measured: A-sweep]
 *     800 = presence cap 400 + trips cap 200 + pools cap 200
 *   broadcast      reads/call = onlineDrivers + 1        [measured: A-sweep]
 *   nearbyActivity cadence    = 1 / 30 s per open home screen
 *                               [apps/mobile/src/hooks/nearbyActivity.ts:57]
 *   presence write cadence    = 1 / 180 s per user
 *                               [apps/mobile/src/hooks/presence.ts:31]
 *   driver location write     = 1 / 30 s per online driver
 *                               [apps/mobile/app/driver/home.tsx:332]
 *
 * Price: $0.03 / 100k document reads, $0.09 / 100k writes (us-central1,
 * Standard edition). nam5 multi-region is higher, so these are a FLOOR.
 */
const READ_PRICE = 0.03 / 100000;
const WRITE_PRICE = 0.09 / 100000;

const DRIVER_SHARE = 0.12;   // share of concurrent users who are online drivers
const RIDES_PER_USER_HOUR = 0.2;
const CAPPED = 800;          // presence+trips+pools caps in getNearbyActivity
const PEAK_HOURS_PER_DAY = 6; // hours/day at this concurrency

function model(C) {
  const D = Math.round(DRIVER_SHARE * C);
  const passengers = C - D;

  const nearbyCallsSec = C / 30;
  const nearbyReadsCall = D + CAPPED;
  const nearbyReadsSec = nearbyCallsSec * nearbyReadsCall;

  const bookingsSec = (passengers * RIDES_PER_USER_HOUR) / 3600;
  const bcastReadsSec = bookingsSec * (D + 1);

  const readsSec = nearbyReadsSec + bcastReadsSec;
  const writesSec = D / 30 + C / 180 + bookingsSec * 3;

  // Cost if this concurrency holds for PEAK_HOURS_PER_DAY every day.
  const secPerMonth = PEAK_HOURS_PER_DAY * 3600 * 30;
  const costMonth = readsSec * secPerMonth * READ_PRICE + writesSec * secPerMonth * WRITE_PRICE;

  return {
    concurrent: C,
    onlineDrivers: D,
    readsPerCall: nearbyReadsCall,
    readsPerSec: Math.round(readsSec),
    writesPerSec: Math.round(writesSec),
    readsPerDay: Math.round(readsSec * PEAK_HOURS_PER_DAY * 3600 / 1e6) + 'M',
    costPerMonth: '$' + Math.round(costMonth).toLocaleString(),
  };
}

const cols = ['concurrent', 'onlineDrivers', 'readsPerCall', 'readsPerSec', 'writesPerSec', 'readsPerDay', 'costPerMonth'];
const rows = [100, 250, 500, 1000, 2500, 5000, 10000].map(model);

console.log('CAPACITY MODEL — current code, nothing changed');
console.log('assumes ' + (DRIVER_SHARE * 100) + '% of concurrent users are online drivers, ' +
  PEAK_HOURS_PER_DAY + 'h/day at peak\n');
const head = cols.map((c) => c.padEnd(15)).join('');
console.log(head);
console.log('-'.repeat(head.length));
for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(15)).join(''));

/**
 * AS SHIPPED in 38b2ed5. Two changes, and only two:
 *   - the driver lookup is geohash-bounded (lib/nearbyDrivers.ts), so the
 *     `onlineDrivers` term becomes "drivers within the radius" — set by local
 *     density, not by national fleet size
 *   - the idle poll went 30s -> 60s, halving the call rate
 *
 * The capped scans were deliberately NOT trimmed. They are already bounded and
 * do not grow with the user base: `userPresence` is queried by geohash cell,
 * and open `trips`/`poolRideRequests` are short-lived, so their caps are
 * ceilings that are rarely reached rather than costs that are always paid.
 * Trimming them would buy reads at the price of a less accurate "people
 * nearby" count, which is a product call, not a performance one.
 *
 * So two rows per concurrency: the worst case where every cap binds at once,
 * and the realistic case. The realistic presence figure is the cell-block
 * population, which saturates its own 400 cap in a dense city and is why the
 * two rows converge as concurrency rises.
 */
const BOUNDED_DRIVERS = 25;   // drivers inside a 2-6 km radius, typical city
const CAPS_WORST = 400 + 200 + 200;

function shipped(C, realistic) {
  const D = Math.round(DRIVER_SHARE * C);
  const passengers = C - D;
  // Realistic: presence fills its cell block (capped at 400), and open requests
  // are however many are actually live nationally -- roughly bookings/sec x the
  // ~60s a request stays open, not the 200 ceiling.
  const bookingsSec = (passengers * RIDES_PER_USER_HOUR) / 3600;
  const liveRequests = Math.min(200, Math.round(bookingsSec * 60));
  const caps = realistic
    ? Math.min(400, Math.round(C * 0.4)) + liveRequests + Math.min(200, liveRequests * 2)
    : CAPS_WORST;

  const nearbyReadsCall = BOUNDED_DRIVERS + caps;
  const nearbyReadsSec = (C / 60) * nearbyReadsCall;
  const bcastReadsSec = bookingsSec * BOUNDED_DRIVERS;
  const readsSec = nearbyReadsSec + bcastReadsSec;
  // The sweeper adds one full scan of online drivers per minute, nationally.
  const sweepReadsSec = D / 60;
  const writesSec = D / 30 + C / 180 + bookingsSec * 3 + D / 60;
  const secPerMonth = PEAK_HOURS_PER_DAY * 3600 * 30;
  const total = readsSec + sweepReadsSec;
  const costMonth = total * secPerMonth * READ_PRICE + writesSec * secPerMonth * WRITE_PRICE;
  return {
    concurrent: C, onlineDrivers: D, readsPerCall: nearbyReadsCall,
    readsPerSec: Math.round(total), writesPerSec: Math.round(writesSec),
    readsPerDay: Math.round(total * PEAK_HOURS_PER_DAY * 3600 / 1e6) + 'M',
    costPerMonth: '$' + Math.round(costMonth).toLocaleString(),
  };
}

for (const [label, realistic] of [['worst case — every cap binds', false], ['realistic', true]]) {
  console.log('\n\nAS SHIPPED (38b2ed5): geohash-bounded drivers + 60s poll — ' + label + '\n');
  const r = [100, 250, 500, 1000, 2500, 5000, 10000].map((C) => shipped(C, realistic));
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const x of r) console.log(cols.map((c) => String(x[c]).padEnd(15)).join(''));
}

const a = rows.find((r) => r.concurrent === 10000);
const w = shipped(10000, false), g = shipped(10000, true);
console.log('\nAt 10,000 concurrent, reads/sec: ' + a.readsPerSec.toLocaleString() + ' before -> ' +
  w.readsPerSec.toLocaleString() + ' worst case (' + (a.readsPerSec / w.readsPerSec).toFixed(1) + 'x) -> ' +
  g.readsPerSec.toLocaleString() + ' realistic (' + (a.readsPerSec / g.readsPerSec).toFixed(1) + 'x)');
console.log('Cost/month: ' + a.costPerMonth + ' -> ' + w.costPerMonth + ' -> ' + g.costPerMonth);
console.log('\nThe remaining lever is the presence cap (400 reads/call in a dense cell).');
console.log('Cutting it trades the accuracy of the "people nearby" count for reads;');
console.log('the structural fix at this scale is precomputed per-cell counts, not a smaller cap.');
