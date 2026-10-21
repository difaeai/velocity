/**
 * One-off: give every passenger with a confirmed intercity booking read access
 * to their trip's group chat.
 *
 * The chat used to be readable by any signed-in user. It is now readable by the
 * uids in `intercityTrips/{tripId}.memberUids`, which createIntercityBooking
 * fills from the day the rule changed. Bookings made before that are not on the
 * list until this runs once. Safe to run again: arrayUnion adds nobody twice.
 *
 *   node scripts/backfill-intercity-members.mjs
 *
 * Uses the repo-root service account key, like the other scripts here.
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

const bookings = await db.collection('intercityBookings').where('status', '==', 'confirmed').get();
const byTrip = new Map();
for (const b of bookings.docs) {
  const { tripId, passengerId } = b.data();
  if (!tripId || !passengerId) continue;
  byTrip.set(tripId, [...(byTrip.get(tripId) ?? []), passengerId]);
}

for (const [tripId, uids] of byTrip) {
  // update, not set: a booking whose trip was deleted must not resurrect a stub.
  await db
    .doc(`intercityTrips/${tripId}`)
    .update({ memberUids: admin.firestore.FieldValue.arrayUnion(...uids) })
    .catch((e) => console.warn(`skipped ${tripId}: ${e.message}`));
}
console.log(`Added ${bookings.size} confirmed booking(s) across ${byTrip.size} trip(s).`);
