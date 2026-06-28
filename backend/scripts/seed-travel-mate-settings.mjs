/**
 * One-shot seed: writes config/travelMateSettings to Firestore.
 *
 * Run once after deploying the Travel Mate functions:
 *
 *   cd backend
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "..\velocity-fe379-firebase-adminsdk-fbsvc-2efeecd69a.json"
 *   node scripts/seed-travel-mate-settings.mjs
 *
 * (On bash:  GOOGLE_APPLICATION_CREDENTIALS=../velocity-fe379-firebase-adminsdk-fbsvc-2efeecd69a.json node ...)
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const saPath = resolve(__dirname, '../../velocity-fe379-firebase-adminsdk-fbsvc-2efeecd69a.json');

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
}

const db = getFirestore();

const settings = {
  freeMonthlySwipes: 4,         // Likes per month for free users
  maxGroupSize: 4,               // Max commuters in a shared booking (Phase 2)
  discoveryRadiusKm: 3,          // Destination proximity for feed candidates
  enforceMutualGender: true,     // Mutual gender-preference filtering in the feed
  updatedAt: new Date().toISOString(),
};

await db.doc('config/travelMateSettings').set(settings, { merge: true });
console.log('✅ config/travelMateSettings seeded:', settings);
