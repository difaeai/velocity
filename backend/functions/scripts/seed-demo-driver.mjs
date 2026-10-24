#!/usr/bin/env node
/**
 * Dress the reviewer demo account as an obviously fake driver.
 *
 * The demo number (+923000000000, code 123456 — a Firebase console test number,
 * see backend/functions/src/auth/whatsappOtp.ts DEFAULT_DEMO_NUMBERS) is what
 * app-store reviewers and our own testers sign in with. It was onboarded by hand
 * with real-looking papers, so a tester was looking at what could pass for a real
 * person's CNIC, licence and car. This replaces every picture and every identity
 * field with placeholders stamped TEST ACCOUNT, so nobody can mistake the account
 * for a person — and so a real driver's CNIC can never collide with it in the
 * duplicate check.
 *
 * Writes NEW Storage objects and repoints the documents at them. The old objects
 * are left where they are (listed at the end) — delete them by hand once nobody
 * needs them. The account stays approved; its papers never expire (2035), so the
 * nightly expiry sweep leaves it alone.
 *
 * Usage (from backend/functions):
 *   node scripts/seed-demo-driver.mjs --dry-run --out ./demo-preview   # render only
 *   npx -y node@22 scripts/seed-demo-driver.mjs                        # write to prod
 *   npx -y node@22 scripts/seed-demo-driver.mjs --phone +923000000000
 *
 * Node 22, not 24: on Node 24 the Storage client's token fetch dies with
 * "Premature close" before anything is written (seen 2026-10-24).
 *
 * Credentials: the repo service-account JSON, or GOOGLE_APPLICATION_CREDENTIALS.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVICE_ACCOUNT = 'velocity-fe379-firebase-adminsdk-fbsvc-2efeecd69a.json';
const BUCKET = 'velocity-fe379.firebasestorage.app';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes('--dry-run');
const phone = arg('phone') ?? '+923000000000';

/** The identity on every placeholder. All of it is unmistakably not a person. */
const DEMO = {
  name: 'Test Driver',
  // All zeros: no NADRA number has this shape, and the verification engine
  // already reads it as a specimen (domain/localVision.ts hasBlankedFields).
  cnic: '00000-0000000-0',
  licenceNo: 'TEST-000000',
  plate: 'TEST-001',
  make: 'Suzuki Alto',
  color: 'White',
  label: 'White Suzuki Alto',
  // Far enough out that the expiry sweep never warns or suspends the account.
  expiryIso: '2035-12-31',
  expiryPrinted: '31-12-2035',
};

// ── The pictures ─────────────────────────────────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const FONT = "font-family='Arial, Helvetica, sans-serif'";

const silhouette = (x, y, size, fill) => `
  <g transform='translate(${x} ${y}) scale(${size / 100})'>
    <circle cx='50' cy='36' r='20' fill='${fill}'/>
    <path d='M12 100 C12 70 30 60 50 60 C70 60 88 70 88 100 Z' fill='${fill}'/>
  </g>`;

const watermark = (w, h) =>
  `<text x='${w / 2}' y='${h / 2}' ${FONT} font-size='${Math.round(h / 4)}' font-weight='700'
     fill='#d0342c' fill-opacity='0.12' text-anchor='middle' dominant-baseline='middle'
     transform='rotate(-18 ${w / 2} ${h / 2})'>TEST</text>`;

/** A plain card: never styled after a real government document, on purpose. */
function card({ title, rows, portrait = false, w = 1000, h = 630 }) {
  const fieldX = portrait ? 300 : 60;
  const lines = rows
    .map(
      ([k, v], i) => `
      <text x='${fieldX}' y='${210 + i * 78}' ${FONT} font-size='24' fill='#6b7280'>${esc(k)}</text>
      <text x='${fieldX}' y='${244 + i * 78}' ${FONT} font-size='32' font-weight='700' fill='#111827'>${esc(v)}</text>`,
    )
    .join('');
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>
    <rect width='${w}' height='${h}' rx='28' fill='#f3f4f6'/>
    <rect width='${w}' height='70' rx='28' fill='#d0342c'/>
    <rect y='40' width='${w}' height='30' fill='#d0342c'/>
    <text x='${w / 2}' y='46' ${FONT} font-size='28' font-weight='700' fill='#fff' text-anchor='middle'>TEST ACCOUNT · NOT A REAL DOCUMENT</text>
    <text x='60' y='140' ${FONT} font-size='40' font-weight='700' fill='#111827'>${esc(title)}</text>
    ${portrait ? `<rect x='60' y='180' width='200' height='250' rx='16' fill='#9ca3af'/>${silhouette(70, 200, 180, '#e5e7eb')}` : ''}
    ${lines}
    ${watermark(w, h)}
  </svg>`;
}

function avatar() {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'>
    <rect width='600' height='600' fill='#1f9d55'/>
    ${silhouette(100, 70, 400, '#e8f5ee')}
    <rect x='190' y='470' width='220' height='76' rx='38' fill='#d0342c'/>
    <text x='300' y='522' ${FONT} font-size='44' font-weight='700' fill='#fff' text-anchor='middle'>TEST</text>
  </svg>`;
}

function car() {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'>
    <rect width='1200' height='800' fill='#dbeafe'/>
    <rect y='560' width='1200' height='240' fill='#9ca3af'/>
    <path d='M230 520 L300 380 Q320 340 370 340 L760 340 Q810 340 840 380 L950 470 L1010 490 Q1040 500 1040 540 L1040 600 L160 600 L160 560 Q160 525 230 520 Z'
      fill='#ffffff' stroke='#374151' stroke-width='8'/>
    <path d='M330 470 L380 380 L560 380 L560 470 Z' fill='#93c5fd' stroke='#374151' stroke-width='6'/>
    <path d='M600 470 L600 380 L760 380 Q790 380 810 400 L880 470 Z' fill='#93c5fd' stroke='#374151' stroke-width='6'/>
    <circle cx='340' cy='605' r='72' fill='#111827'/><circle cx='340' cy='605' r='30' fill='#d1d5db'/>
    <circle cx='860' cy='605' r='72' fill='#111827'/><circle cx='860' cy='605' r='30' fill='#d1d5db'/>
    <rect x='510' y='520' width='180' height='56' rx='6' fill='#fff' stroke='#111827' stroke-width='4'/>
    <text x='600' y='560' ${FONT} font-size='34' font-weight='700' fill='#111827' text-anchor='middle'>${esc(DEMO.plate)}</text>
    <rect x='0' y='0' width='1200' height='90' fill='#d0342c'/>
    <text x='600' y='60' ${FONT} font-size='40' font-weight='700' fill='#fff' text-anchor='middle'>TEST ACCOUNT · PLACEHOLDER CAR PHOTO</text>
  </svg>`;
}

const PICTURES = {
  avatar: avatar(),
  photo: avatar(),
  'cnic-front': card({
    title: 'Identity card (test)',
    portrait: true,
    rows: [
      ['Name', DEMO.name],
      ['Identity number', DEMO.cnic],
      ['Date of expiry', DEMO.expiryPrinted],
    ],
  }),
  'cnic-back': card({
    title: 'Identity card (test) · back',
    rows: [
      ['Address', 'Test address, Islamabad'],
      ['Note', 'Sample only. Belongs to no one.'],
    ],
  }),
  license: card({
    title: 'Driving licence (test)',
    portrait: true,
    rows: [
      ['Name', DEMO.name],
      ['Licence number', DEMO.licenceNo],
      ['Valid till', DEMO.expiryPrinted],
    ],
  }),
  'vehicle-doc': card({
    title: 'Vehicle registration (test)',
    h: 700,
    rows: [
      ['Registration number', DEMO.plate],
      ['Make and colour', `${DEMO.make}, ${DEMO.color}`],
      ['Owner', DEMO.name],
    ],
  }),
  'vehicle-photo': car(),
};

const render = (svg) => sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();

// ── Run ──────────────────────────────────────────────────────────────────────

const rendered = Object.fromEntries(
  await Promise.all(Object.entries(PICTURES).map(async ([k, svg]) => [k, await render(svg)])),
);

if (dryRun) {
  const out = path.resolve(arg('out') ?? 'demo-preview');
  fs.mkdirSync(out, { recursive: true });
  for (const [k, buf] of Object.entries(rendered)) fs.writeFileSync(path.join(out, `${k}.jpg`), buf);
  console.log(`Dry run: ${Object.keys(rendered).length} pictures written to ${out}. Nothing sent.`);
  process.exit(0);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? path.join(REPO, SERVICE_ACCOUNT);
if (!fs.existsSync(keyPath)) {
  console.error(`No credentials. Expected ${SERVICE_ACCOUNT} at the repo root, or set GOOGLE_APPLICATION_CREDENTIALS.`);
  process.exit(1);
}
if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))), storageBucket: BUCKET });
}
const db = getFirestore();
const bucket = getStorage().bucket();

const user = await getAuth().getUserByPhoneNumber(phone);
const uid = user.uid;
const driverRef = db.doc(`drivers/${uid}`);
const driverSnap = await driverRef.get();
if (!driverSnap.exists) {
  console.error(`${phone} (uid ${uid}) has no driver document — onboard it once first.`);
  process.exit(1);
}

/** Upload one picture under a fresh name and hand back what the app stores. */
async function put(objectPath, buf) {
  const token = randomUUID();
  await bucket.file(objectPath).save(buf, {
    contentType: 'image/jpeg',
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
  return { path: objectPath, url };
}

const stamp = Date.now();
const doc = (kind) => put(`drivers/${uid}/documents/test-${kind}-${stamp}.jpg`, rendered[kind]);
const [avatarFile, photo, cnicFront, cnicBack, license, vehicleDoc, vehiclePhoto] = await Promise.all([
  put(`avatars/${uid}-test-${stamp}.jpg`, rendered.avatar),
  doc('photo'),
  doc('cnic-front'),
  doc('cnic-back'),
  doc('license'),
  doc('vehicle-doc'),
  doc('vehicle-photo'),
]);

const previous = Object.entries(driverSnap.data())
  .filter(([k, v]) => /DocPath$/.test(k) && typeof v === 'string')
  .map(([, v]) => v);
const previousCheck = driverSnap.get('vehicleCheck.photoPath');
if (typeof previousCheck === 'string') previous.push(previousCheck);

const now = Timestamp.now();
const batch = db.batch();
batch.set(
  db.doc(`users/${uid}`),
  { name: DEMO.name, displayName: DEMO.name, photoURL: avatarFile.url, updatedAt: FieldValue.serverTimestamp() },
  { merge: true },
);
batch.set(
  driverRef,
  {
    fullName: DEMO.name,
    cnic: DEMO.cnic,
    cnicExpiry: DEMO.expiryIso,
    licenseExpiry: DEMO.expiryIso,
    vehicleDocExpiry: DEMO.expiryIso,
    vehicleLabel: DEMO.label,
    plate: DEMO.plate,
    photoDocPath: photo.path,
    photoDocUrl: photo.url,
    cnicDocPath: cnicFront.path,
    cnicDocUrl: cnicFront.url,
    cnicBackDocPath: cnicBack.path,
    cnicBackDocUrl: cnicBack.url,
    licenseDocPath: license.path,
    licenseDocUrl: license.url,
    vehicleDocPath: vehicleDoc.path,
    vehicleDocUrl: vehicleDoc.url,
    vehiclePhotoDocPath: vehiclePhoto.path,
    vehiclePhotoDocUrl: vehiclePhoto.url,
    // The 30-day car-photo gate (domain/vehicleCheck.ts): fresh, so a tester can
    // go online straight away; it asks for a new photo in 30 days like anyone.
    vehicleCheck: {
      vehicleId: 'primary',
      plate: DEMO.plate,
      photoPath: vehiclePhoto.path,
      photoUrl: vehiclePhoto.url,
      status: 'approved',
      confirmedAt: now,
      reviewedAt: now,
      reviewedBy: 'seed-demo-driver',
      reason: null,
    },
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);
batch.set(
  driverRef.collection('vehicles').doc('primary'),
  {
    vehicleId: 'primary',
    driverId: uid,
    label: DEMO.label,
    make: DEMO.make,
    color: DEMO.color,
    plate: DEMO.plate,
    docPath: vehicleDoc.path,
    docUrl: vehicleDoc.url,
    photoPath: vehiclePhoto.path,
    photoUrl: vehiclePhoto.url,
    status: 'approved',
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);
await batch.commit();

console.log(`✅ ${phone} (uid ${uid}) is now "${DEMO.name}" — CNIC ${DEMO.cnic}, ${DEMO.label} ${DEMO.plate}.`);
console.log('   Pictures: avatar, selfie, CNIC front/back, licence, registration, car — all stamped TEST.');
console.log(`ℹ Old objects left in place (delete by hand when nobody needs them):\n   ${previous.join('\n   ')}`);
process.exit(0);
