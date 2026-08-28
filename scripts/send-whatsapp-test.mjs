/**
 * Fires the deployed `adminSendWhatsAppTest` callable from a terminal.
 *
 *   node scripts/send-whatsapp-test.mjs 03356675551 you@example.com
 *   node scripts/send-whatsapp-test.mjs +923356675551 uid:AbC123…
 *
 * WHY IT SIGNS IN AS AN ADMIN
 * ---------------------------
 * The callable is behind `requireAdmin`, so an unauthenticated curl can only
 * ever get a 401 back — the guard is doing its job. Rather than reach around
 * it, this mints a custom token for an admin account, exchanges it for an ID
 * token exactly as the web SDK would, and calls the function over https like a
 * signed-in console would. That keeps the auth guard, the per-uid rate limit
 * and the deployed config all in the path being tested.
 *
 * The account you name must already hold the `admin` claim — bootstrap the
 * first one with scripts/grant-admin.mjs. Minting the token creates an extra
 * session for that account and signs nobody out.
 *
 * It sends ONE REAL WhatsApp template message to the number you type, so type
 * your own handset. It does not trip the circuit breaker, touch any driver
 * record, or spend the daily budget (see docs/WHATSAPP_ALERTS.md).
 *
 * Needs the repo service account JSON at the root (already there) — so run it
 * from a machine you trust.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// firebase-admin lives in the functions workspace, the key lives at the repo
// root — two different anchors, so resolve them separately rather than letting
// one relative path stand in for both.
const require = createRequire(new URL('../backend/functions/', import.meta.url));
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(
  readFileSync(
    new URL('../velocity-fe379-firebase-adminsdk-fbsvc-2efeecd69a.json', import.meta.url),
    'utf8',
  ),
);

const WEB_API_KEY =
  process.env.FIREBASE_WEB_API_KEY ?? 'AIzaSyCymN-ML5eHNVrI7fGbLD9QSAzeWyJZyII';
const REGION = 'asia-south1';
const PROJECT = 'velocity-fe379';
const FN = `https://${REGION}-${PROJECT}.cloudfunctions.net/adminSendWhatsAppTest`;

const [phone, whoArg] = process.argv.slice(2);
const who = whoArg ?? process.env.VELOCITY_ADMIN;
if (!phone || !who) {
  console.error('Usage: node scripts/send-whatsapp-test.mjs <03XXXXXXXXX> <adminEmail|uid:UID|+92phone>');
  console.error('       (the admin can also come from $env:VELOCITY_ADMIN)');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

/** One targeted lookup — never a listUsers() sweep over everybody. */
async function resolveAdmin() {
  if (who.startsWith('uid:')) return admin.auth().getUser(who.slice(4));
  if (who.startsWith('+')) return admin.auth().getUserByPhoneNumber(who);
  if (who.includes('@')) return admin.auth().getUserByEmail(who);
  return admin.auth().getUser(who);
}

const user = await resolveAdmin();
if (user.customClaims?.role !== 'admin') {
  console.error(`${who} is not an admin (role: ${user.customClaims?.role ?? 'none'}).`);
  console.error('The callable would answer permission-denied. Grant it first:');
  console.error('  node scripts/grant-admin.mjs <email>   # run in Google Cloud Shell');
  process.exit(1);
}
console.log(`calling as : ${user.uid} (admin)`);
console.log(`sending to : ${phone}`);

const customToken = await admin.auth().createCustomToken(user.uid);
const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  },
);
const signInJson = await signIn.json();
if (!signIn.ok) {
  console.error('Could not exchange the custom token:', signInJson);
  process.exit(1);
}

const res = await fetch(FN, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signInJson.idToken}`,
  },
  body: JSON.stringify({ data: { phone } }),
});
const body = await res.json();

if (!res.ok) {
  console.error(`\nFunction returned ${res.status}:`, JSON.stringify(body, null, 2));
  process.exit(1);
}

const result = body.result ?? body;
console.log(`\n${JSON.stringify(result, null, 2)}`);

// The whole point of this callable is that a failure names itself, so say out
// loud which of the five settings the answer is pointing at.
if (result.ok) {
  console.log('\nSent. If it does not arrive, the number is not on WhatsApp.');
} else if (result.stage === 'config') {
  console.log('\nThe backend has no WhatsApp credentials — the WHATSAPP_ENV secret is not set.');
} else if (result.stage === 'number') {
  console.log('\nThe number was rejected before anything was sent.');
} else {
  console.log('\nMeta rejected the send — the template name, language or parameter count disagree.');
}
process.exit(result.ok ? 0 : 2);
