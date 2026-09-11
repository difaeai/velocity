/**
 * Arm the reviewer demo login.
 *
 * An app-store reviewer signs in with a number registered in the Firebase
 * console under Authentication → Sign-in method → Phone → "Phone numbers for
 * testing", where Firebase accepts a fixed code and sends nothing at all. That
 * short-circuit lives entirely inside Firebase's own flow, so the WhatsApp OTP
 * path has to be told to leave those numbers alone — otherwise it sends a real
 * code to a fictional number and the reviewer waits for a message that cannot
 * arrive.
 *
 * This writes the list to config/whatsappOtp.demoNumbers (merged, so the other
 * OTP settings are left alone), and — if the account already exists — marks its
 * profile complete so the reviewer lands on the home screen instead of being
 * sent through onboarding.
 *
 * Run in Google Cloud Shell, already authenticated as the project owner (no
 * service-account key needed):
 *
 *   cd ~ && git clone https://github.com/difaeai/velocity.git
 *   npm install firebase-admin
 *   node velocity/scripts/set-otp-demo-numbers.mjs 03000000000
 *
 * Pass every demo number in one run: the list is replaced, not appended to.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const raw = process.argv.slice(2);
if (raw.length === 0) {
  console.error('Usage: node scripts/set-otp-demo-numbers.mjs <number> [number...]');
  console.error('Example: node scripts/set-otp-demo-numbers.mjs 03000000000');
  process.exit(1);
}

/** Same normalisation the backend applies, so what is stored is what it matches. */
function toWhatsAppNumber(input) {
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(2);
  else if (d.startsWith('0')) d = `92${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith('3')) d = `92${d}`;
  return /^923\d{9}$/.test(d) ? d : null;
}

const numbers = [];
for (const entry of raw) {
  const n = toWhatsAppNumber(entry);
  if (!n) {
    console.error(`✗ "${entry}" is not a Pakistani mobile number — aborting, nothing written.`);
    process.exit(1);
  }
  if (!numbers.includes(n)) numbers.push(n);
}

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'velocity-fe379' });
const db = getFirestore();
const auth = getAuth();

await db.doc('config/whatsappOtp').set({ demoNumbers: numbers }, { merge: true });
console.log(`✅ config/whatsappOtp.demoNumbers = [${numbers.join(', ')}]`);
console.log('   These numbers now skip WhatsApp and use Firebase phone auth.');

// The reviewer must land on the home screen, and app/index.tsx sends anyone
// whose profile is incomplete to onboarding instead. The account only exists
// once somebody has signed in as it at least once, so this is best-effort.
for (const n of numbers) {
  const e164 = `+${n}`;
  let user;
  try {
    user = await auth.getUserByPhoneNumber(e164);
  } catch {
    console.log(`ℹ ${e164} has never signed in yet — sign in once as this number and`);
    console.log('   complete onboarding, or re-run this script afterwards.');
    continue;
  }
  await db.doc(`users/${user.uid}`).set(
    {
      name: 'App Review',
      gender: 'unspecified',
      profileComplete: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`✅ ${e164} (uid ${user.uid}) — profile marked complete, lands on home.`);
}

process.exit(0);
