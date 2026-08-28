/**
 * Sends the "Find your Customers" demo notification to one account's phone,
 * without needing a build of the app that has the button in it.
 *
 *   node scripts/send-demo-ad-push.mjs +923001234567        # send now
 *   node scripts/send-demo-ad-push.mjs +923001234567 10     # send in 10 seconds
 *   node scripts/send-demo-ad-push.mjs uid:AbC123…          # by uid instead
 *
 * WHY IT SIGNS IN AS THE USER
 * ---------------------------
 * It would be two lines shorter to push straight through the Admin SDK, and it
 * would prove nothing: the point of running this is to check that the DEPLOYED
 * callable works — its auth guard, its rate limit, its image URL and the tray
 * card the phone actually draws. So it mints a custom token for the account,
 * exchanges it for an ID token exactly as the app's SDK would, and calls the
 * function over https like a signed-in client.
 *
 * Minting that token creates an extra session for the account. It does not sign
 * anybody out of anything, and the phone's own session is untouched.
 *
 * Needs the repo service account JSON at the root (already there) — so run it
 * from a machine you trust, and remember it can only ever notify the ONE account
 * you name on the command line.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// firebase-admin lives in the functions workspace, the key lives at the repo
// root — two different anchors, so resolve them separately. Reusing the one
// `require` for both looked for the key inside backend/ and threw
// MODULE_NOT_FOUND before the script did anything.
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
const FN = `https://${REGION}-${PROJECT}.cloudfunctions.net/sendBusinessAdDemoNotification`;

const [who, delayArg] = process.argv.slice(2);
if (!who) {
  console.error('Usage: node scripts/send-demo-ad-push.mjs <+92phone|uid:UID|email> [delaySeconds]');
  process.exit(1);
}
const delaySeconds = Number(delayArg ?? 0);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

/** One targeted lookup — never a listUsers() sweep over everybody. */
async function resolveUser() {
  if (who.startsWith('uid:')) return admin.auth().getUser(who.slice(4));
  if (who.startsWith('+')) return admin.auth().getUserByPhoneNumber(who);
  if (who.includes('@')) return admin.auth().getUserByEmail(who);
  return admin.auth().getUser(who);
}

const user = await resolveUser();
const tokens = await admin.firestore().collection(`users/${user.uid}/fcmTokens`).get();
console.log(`account : ${user.uid}`);
console.log(`devices : ${tokens.size} registered push token(s)`);
if (tokens.empty) {
  console.log('\nNothing will arrive: this account has no push token registered, which');
  console.log('means the app was never opened on a phone with notifications allowed.');
}

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

if (delaySeconds > 0) {
  console.log(`\nCalling the function — it holds the push for ${delaySeconds}s. Close Velocity now.`);
}

const res = await fetch(FN, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signInJson.idToken}`,
  },
  body: JSON.stringify({ data: delaySeconds > 0 ? { delaySeconds } : {} }),
});
const body = await res.json();

if (!res.ok) {
  console.error(`\nFunction returned ${res.status}:`, JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log('\nSent.');
console.log(JSON.stringify(body.result ?? body, null, 2));
console.log('\nPull the notification shade down. It stays there until swiped away.');
process.exit(0);
