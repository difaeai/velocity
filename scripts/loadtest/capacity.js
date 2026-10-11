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

console.log('\n\nSAME MODEL AFTER THE THREE FIXES');
console.log('(geohash-bound driver query -> ~25 drivers read instead of all D,');
console.log(' nearbyActivity cadence 30s -> 60s, capped scans trimmed 800 -> 250)\n');

function fixed(C) {
  const D = Math.round(DRIVER_SHARE * C);
  const passengers = C - D;
  const nearbyReadsCall = 25 + 250;            // geohash-bounded + trimmed caps
  const nearbyReadsSec = (C / 60) * nearbyReadsCall;
  const bookingsSec = (passengers * RIDES_PER_USER_HOUR) / 3600;
  const bcastReadsSec = bookingsSec * 25;
  const readsSec = nearbyReadsSec + bcastReadsSec;
  const writesSec = D / 30 + C / 180 + bookingsSec * 3;
  const secPerMonth = PEAK_HOURS_PER_DAY * 3600 * 30;
  const costMonth = readsSec * secPerMonth * READ_PRICE + writesSec * secPerMonth * WRITE_PRICE;
  return {
    concurrent: C, onlineDrivers: D, readsPerCall: nearbyReadsCall,
    readsPerSec: Math.round(readsSec), writesPerSec: Math.round(writesSec),
    readsPerDay: Math.round(readsSec * PEAK_HOURS_PER_DAY * 3600 / 1e6) + 'M',
    costPerMonth: '$' + Math.round(costMonth).toLocaleString(),
  };
}
const rows2 = [100, 250, 500, 1000, 2500, 5000, 10000].map(fixed);
console.log(head);
console.log('-'.repeat(head.length));
for (const r of rows2) console.log(cols.map((c) => String(r[c]).padEnd(15)).join(''));

const a = rows.find((r) => r.concurrent === 10000), b = rows2.find((r) => r.concurrent === 10000);
console.log('\nAt 10,000 concurrent: ' + a.readsPerSec.toLocaleString() + ' reads/s -> ' +
  b.readsPerSec.toLocaleString() + ' reads/s  (' +
  (a.readsPerSec / b.readsPerSec).toFixed(0) + 'x less work, ' + a.costPerMonth + ' -> ' + b.costPerMonth + ')');
