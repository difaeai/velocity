/**
 * Grant the `admin` role to a user — used to bootstrap the FIRST admin.
 *
 * There is no built-in admin account: admin access is an `admin` custom claim
 * that only the backend can set. Run this once in Google Cloud Shell (already
 * authenticated as the project owner — no service-account key needed):
 *
 *   cd ~ && git clone https://github.com/difaeai/velocity.git
 *   npm install firebase-admin
 *   node velocity/scripts/grant-admin.mjs you@example.com
 *
 * Then sign out and back in to the admin panel. After the first admin exists,
 * manage all other admins from inside the panel (no Cloud Shell needed).
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/grant-admin.mjs <email>');
  process.exit(1);
}

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'velocity-fe379' });

const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { role: 'admin' });
console.log(`✅ Granted admin to ${email} — uid ${user.uid}`);
process.exit(0);
