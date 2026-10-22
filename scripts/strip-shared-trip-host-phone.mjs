/**
 * One-off: take the host's phone number off shared trip docs that already have
 * a co-rider.
 *
 * Every pool member can read the trip doc, so since PR #71 acceptBid,
 * seatRiderOnPool and acceptEnRouteRider delete `passengerPhone` the moment a
 * second rider is aboard; the driver gets every number from getPoolRiders and
 * the SOS desk falls back to users/{uid}.phoneNumber. Trips written before that
 * still carry it. Nothing is lost: the field was a copy of the user doc's.
 *
 *   node scripts/strip-shared-trip-host-phone.mjs           # count only
 *   node scripts/strip-shared-trip-host-phone.mjs --apply   # delete the field
 *
 * Safe to run again. Uses the repo-root service account key, like the other
 * scripts here.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(new URL('../backend/functions/', import.meta.url));
const admin = require('firebase-admin');

const root = new URL('../', import.meta.url);
const keyFile = readdirSync(root).find((f) => /^velocity-fe379-firebase-adminsdk-.*\.json$/.test(f));
if (!keyFile) throw new Error('No service account key at the repo root.');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(new URL(keyFile, root), 'utf8'))),
});
const db = admin.firestore();
const apply = process.argv.includes('--apply');

const shared = await db.collection('trips').where('pool', '==', true).select('poolMembers', 'passengerPhone').get();
const exposed = shared.docs.filter(
  (d) => (d.get('poolMembers') ?? []).length > 1 && d.get('passengerPhone') != null,
);
console.log(`${shared.size} shared trip(s), ${exposed.length} with a co-rider still showing the host's phone.`);

if (apply && exposed.length > 0) {
  const writer = db.bulkWriter();
  // update, not set: a trip deleted since the read must not come back as a stub.
  for (const d of exposed) {
    writer
      .update(d.ref, { passengerPhone: admin.firestore.FieldValue.delete() })
      .catch((e) => console.warn(`skipped ${d.id}: ${e.message}`));
  }
  await writer.close();
  console.log(`Removed the host's phone from ${exposed.length} trip(s).`);
} else if (exposed.length > 0) {
  console.log('Dry run. Re-run with --apply to remove it.');
}
