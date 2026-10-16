/**
 * End-to-end proof that the local verification engine actually decides.
 *
 *   cd backend/functions && npm run build && node scripts/smoke-local-vision.cjs
 *
 * WHY THIS EXISTS. An engine that routes every applicant to a human is
 * indistinguishable, from the outside, from an engine being careful — that is
 * not a hypothetical, it is what this codebase shipped for weeks. Unit tests
 * cover the rules; nothing else covers the question "does the whole thing,
 * compiled, reading real pixels, come back with an answer". So this builds six
 * synthetic Pakistani documents, stubs Cloud Storage so no production object is
 * touched, runs the real readDriverDocuments() and readFaceScan(), and puts the
 * verdict on screen next to what it should be.
 *
 * It needs no key, no emulator and no network.
 *
 * THE FIXTURE HAS TO BE REALISTIC OR IT TESTS NOTHING. Two things about it were
 * wrong at first and both made the engine look broken when it was not:
 *
 *   · The portraits are CROPPED to one head. The reference images are crowd
 *     photographs, and `detectSingleFace` returns the most confident face in
 *     the frame — so an uncropped "selfie" compared whichever stranger the
 *     detector liked best, and the distances came out meaningless.
 *   · The cards are rendered at twice their drawn size. Nobody uploads a
 *     1000-pixel photograph of their CNIC, and at that size the printed
 *     portrait lands near 100 pixels, below what the descriptor needs.
 *
 * The faces are the reference portraits inside @vladmandic/face-api. Measured
 * with the detector: samples 1 and 2 are the same person (0.51) and sample 5 is
 * someone else (0.79 from sample 1), which is what makes a real match and a
 * real mismatch testable. Sample 6 is smiling (happy 0.99).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const COMPILED = path.join(ROOT, 'lib');
const SAMPLES = path.join(ROOT, 'node_modules', '@vladmandic', 'face-api', 'demo');

if (!fs.existsSync(COMPILED)) {
  console.error('Run `npm run build` first — this drives the compiled engine, not the sources.');
  process.exit(1);
}

const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));

const face = (name) => path.join(SAMPLES, name);

/**
 * Where the face is in each reference photograph, as the detector reported it.
 *
 * Hard-coded rather than detected here on purpose: a fixture that calls the
 * engine to build itself cannot then be used to test the engine.
 */
const FACE_BOX = {
  'sample1.jpg': { x: 776, y: 445, w: 313, h: 256 },
  'sample2.jpg': { x: 1403, y: 173, w: 277, h: 264 },
  'sample5.jpg': { x: 313, y: 897, w: 316, h: 313 },
  'sample6.jpg': { x: 1432, y: 314, w: 299, h: 290 },
};

/** A head-and-shoulders crop with one face in it, the way a card prints one. */
async function portrait(name, width, height) {
  const box = FACE_BOX[name];
  const side = Math.round(Math.max(box.w, box.h) * 2.2);
  const meta = await sharp(face(name)).metadata();
  const left = Math.max(0, Math.min(meta.width - side, Math.round(box.x + box.w / 2 - side / 2)));
  const top = Math.max(0, Math.min(meta.height - side, Math.round(box.y + box.h / 2 - side / 2)));
  return sharp(face(name))
    .extract({
      left,
      top,
      width: Math.min(side, meta.width - left),
      height: Math.min(side, meta.height - top),
    })
    .resize(width, height, { fit: 'cover' })
    .png()
    .toBuffer();
}

/** How much bigger than its drawn SVG a finished page is rendered. See above. */
const CARD_SCALE = 2;

/** Render an SVG page at a realistic upload size. Re-rendered, never upscaled. */
async function page(svg, quality = 92) {
  const drawn = await sharp(Buffer.from(svg)).metadata();
  return sharp(Buffer.from(svg))
    .resize({ width: Math.round(drawn.width * CARD_SCALE) })
    .jpeg({ quality })
    .toBuffer();
}

/** Paste a portrait where the card prints one, so the face is ON the document. */
async function cardWithPortrait(svg, portraitName, box) {
  const drawn = await sharp(Buffer.from(svg)).metadata();
  const card = await sharp(Buffer.from(svg))
    .resize({ width: Math.round(drawn.width * CARD_SCALE) })
    .png()
    .toBuffer();
  const photo = await portrait(portraitName, box.w * CARD_SCALE, box.h * CARD_SCALE);
  return sharp(card)
    .composite([{ input: photo, top: box.top * CARD_SCALE, left: box.left * CARD_SCALE }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ── The documents ────────────────────────────────────────────────────────────

/**
 * A NADRA-style card. The three dates sit in a label row above a value row,
 * which is exactly the layout that defeats naive label matching — and exactly
 * what real OCR hands back for a real card.
 */
function cnicFront({ name, father, cnic, dob, issue, expiry }) {
  return `<svg width="1000" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="630" fill="#f3f5f0"/>
    <text x="250" y="58" font-family="Arial" font-size="29" font-weight="bold">ISLAMIC REPUBLIC OF PAKISTAN</text>
    <text x="330" y="98" font-family="Arial" font-size="25">NATIONAL IDENTITY CARD</text>
    <text x="300" y="168" font-family="Arial" font-size="19" fill="#555">Name</text>
    <text x="300" y="200" font-family="Arial" font-size="27" font-weight="bold">${name}</text>
    <text x="300" y="248" font-family="Arial" font-size="19" fill="#555">Father Name</text>
    <text x="300" y="280" font-family="Arial" font-size="27" font-weight="bold">${father}</text>
    <text x="300" y="328" font-family="Arial" font-size="19" fill="#555">Gender</text>
    <text x="300" y="358" font-family="Arial" font-size="24">M</text>
    <text x="470" y="328" font-family="Arial" font-size="19" fill="#555">Country of Stay</text>
    <text x="470" y="358" font-family="Arial" font-size="24">Pakistan</text>
    <text x="40" y="432" font-family="Arial" font-size="19" fill="#555">Identity Number</text>
    <text x="40" y="468" font-family="Arial" font-size="33" font-weight="bold">${cnic}</text>
    <text x="40" y="528" font-family="Arial" font-size="19" fill="#555">Date of Birth</text>
    <text x="380" y="528" font-family="Arial" font-size="19" fill="#555">Date of Issue</text>
    <text x="700" y="528" font-family="Arial" font-size="19" fill="#555">Date of Expiry</text>
    <text x="40" y="562" font-family="Arial" font-size="24">${dob}</text>
    <text x="380" y="562" font-family="Arial" font-size="24">${issue}</text>
    <text x="700" y="562" font-family="Arial" font-size="24">${expiry}</text>
  </svg>`;
}

function cnicBack({ cnic }) {
  return `<svg width="1000" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="630" fill="#f3f5f0"/>
    <text x="40" y="70" font-family="Arial" font-size="22" fill="#555">Permanent Address</text>
    <text x="40" y="110" font-family="Arial" font-size="24">House 14, Street 7, Gulberg III, Lahore</text>
    <text x="40" y="180" font-family="Arial" font-size="22" fill="#555">Temporary Address</text>
    <text x="40" y="220" font-family="Arial" font-size="24">Flat 3B, Askari Housing, Rawalpindi</text>
    <text x="40" y="330" font-family="Arial" font-size="20" fill="#555">Identity Number</text>
    <text x="40" y="365" font-family="Arial" font-size="28" font-weight="bold">${cnic}</text>
    <text x="40" y="470" font-family="Arial" font-size="22">Holder Signature</text>
    <text x="600" y="470" font-family="Arial" font-size="22">Registrar</text>
    <text x="40" y="560" font-family="Arial" font-size="18" fill="#666">NATIONAL DATABASE AND REGISTRATION AUTHORITY</text>
  </svg>`;
}

function licence({ name, father, cnic, issue, expiry }) {
  return `<svg width="1000" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="630" fill="#eef3f6"/>
    <text x="230" y="56" font-family="Arial" font-size="27" font-weight="bold">GOVERNMENT OF THE PUNJAB</text>
    <text x="300" y="96" font-family="Arial" font-size="26" font-weight="bold">DRIVING LICENCE</text>
    <text x="300" y="150" font-family="Arial" font-size="19" fill="#555">Name</text>
    <text x="300" y="182" font-family="Arial" font-size="26" font-weight="bold">${name}</text>
    <text x="300" y="228" font-family="Arial" font-size="19" fill="#555">Father Name</text>
    <text x="300" y="258" font-family="Arial" font-size="24">${father}</text>
    <text x="40" y="400" font-family="Arial" font-size="19" fill="#555">Licence No</text>
    <text x="40" y="432" font-family="Arial" font-size="27" font-weight="bold">${cnic}</text>
    <text x="520" y="400" font-family="Arial" font-size="19" fill="#555">Category</text>
    <text x="520" y="432" font-family="Arial" font-size="24">LTV</text>
    <text x="760" y="400" font-family="Arial" font-size="19" fill="#555">Blood Group</text>
    <text x="760" y="432" font-family="Arial" font-size="24">B+</text>
    <text x="40" y="500" font-family="Arial" font-size="19" fill="#555">Date of Issue</text>
    <text x="40" y="534" font-family="Arial" font-size="24">${issue}</text>
    <text x="420" y="500" font-family="Arial" font-size="19" fill="#555">Valid Till</text>
    <text x="420" y="534" font-family="Arial" font-size="24">${expiry}</text>
    <text x="40" y="600" font-family="Arial" font-size="18" fill="#666">City Traffic Police, Lahore</text>
  </svg>`;
}

function registration({ name, plate, expiry }) {
  return `<svg width="1000" height="700" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="700" fill="#f7f4ec"/>
    <text x="140" y="56" font-family="Arial" font-size="25" font-weight="bold">EXCISE AND TAXATION DEPARTMENT</text>
    <text x="300" y="98" font-family="Arial" font-size="25" font-weight="bold">REGISTRATION BOOK</text>
    <text x="40" y="170" font-family="Arial" font-size="19" fill="#555">Registration No</text>
    <text x="40" y="206" font-family="Arial" font-size="31" font-weight="bold">${plate}</text>
    <text x="40" y="270" font-family="Arial" font-size="19" fill="#555">Owner Name</text>
    <text x="40" y="302" font-family="Arial" font-size="25">${name}</text>
    <text x="520" y="170" font-family="Arial" font-size="19" fill="#555">Make</text>
    <text x="520" y="202" font-family="Arial" font-size="24">Toyota Corolla</text>
    <text x="520" y="270" font-family="Arial" font-size="19" fill="#555">Colour</text>
    <text x="520" y="302" font-family="Arial" font-size="24">White</text>
    <text x="40" y="380" font-family="Arial" font-size="19" fill="#555">Engine No</text>
    <text x="40" y="412" font-family="Arial" font-size="24">2NZ8841772</text>
    <text x="520" y="380" font-family="Arial" font-size="19" fill="#555">Chassis No</text>
    <text x="520" y="412" font-family="Arial" font-size="24">NZE1410094417</text>
    <text x="40" y="490" font-family="Arial" font-size="19" fill="#555">Horse Power</text>
    <text x="40" y="522" font-family="Arial" font-size="24">1300 CC</text>
    <text x="520" y="490" font-family="Arial" font-size="19" fill="#555">Seating Capacity</text>
    <text x="520" y="522" font-family="Arial" font-size="24">5</text>
    <text x="40" y="600" font-family="Arial" font-size="19" fill="#555">Token Tax Valid Till</text>
    <text x="40" y="634" font-family="Arial" font-size="24">${expiry}</text>
  </svg>`;
}

/** A car, with its plate on it and the usual roadside clutter of words. */
function carPhoto({ plate }) {
  return `<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="800" fill="#8fa3b0"/>
    <rect y="520" width="1200" height="280" fill="#54585c"/>
    <rect x="180" y="250" width="840" height="300" rx="40" fill="#e9eaec"/>
    <rect x="300" y="280" width="420" height="130" rx="18" fill="#2f3337"/>
    <circle cx="350" cy="560" r="62" fill="#1d2023"/>
    <circle cx="860" cy="560" r="62" fill="#1d2023"/>
    <rect x="520" y="470" width="190" height="62" rx="6" fill="#ffffff" stroke="#111" stroke-width="3"/>
    <text x="537" y="516" font-family="Arial" font-size="40" font-weight="bold">${plate}</text>
    <text x="60" y="110" font-family="Arial" font-size="30" fill="#2b3b45">AL-HAMD MOTORS</text>
    <text x="60" y="160" font-family="Arial" font-size="26" fill="#2b3b45">Service Centre</text>
  </svg>`;
}

// ── Cloud Storage, stubbed ───────────────────────────────────────────────────

const objects = new Map();

function stubFirebase() {
  const at = (p) => {
    const buf = objects.get(p);
    if (!buf) throw new Error(`no stubbed object at ${p}`);
    return buf;
  };
  const stub = {
    db: {},
    auth: {},
    storage: {
      bucket: () => ({
        file: (p) => ({
          getMetadata: async () => [{ contentType: 'image/jpeg', size: at(p).byteLength }],
          download: async () => [at(p)],
        }),
      }),
    },
    FieldValue: {},
    Timestamp: {},
  };
  // Seed the module cache so requiring the engine never initialises Admin, and
  // so nothing here can reach a real bucket even by mistake.
  const id = require.resolve(path.join(COMPILED, 'lib', 'firebase.js'));
  const mod = new Module(id, null);
  mod.filename = id;
  mod.loaded = true;
  mod.exports = stub;
  require.cache[id] = mod;
}

// ── Checks ───────────────────────────────────────────────────────────────────

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}` +
      (ok ? '' : ` (wanted ${JSON.stringify(expected)})`),
  );
}

const IDENTITY = {
  name: 'Muhammad Imran Khan',
  father: 'Abdul Rasheed Khan',
  cnic: '35202-1234567-1',
  dob: '14.08.1990',
  issue: '02.03.2019',
  expiry: '02.03.2029',
  plate: 'LEA-4821',
};

const FORM = {
  fullName: IDENTITY.name,
  cnic: IDENTITY.cnic,
  plate: IDENTITY.plate,
  vehicleType: 'car',
  vehicleLabel: 'Toyota Corolla',
  dob: IDENTITY.dob,
  licenseExpiry: IDENTITY.expiry,
  cnicExpiry: IDENTITY.expiry,
  vehicleDocExpiry: IDENTITY.expiry,
  present: {
    selfie: true,
    license: true,
    cnicFront: true,
    cnicBack: true,
    vehicleRegistration: true,
    vehiclePhoto: true,
  },
};

const NOW = Date.parse('2026-10-16T00:00:00Z');

async function buildApplication({ portraitOnCard }) {
  objects.clear();
  const [frontCard, licenceCard, backCard, book, car, selfie] = await Promise.all([
    cardWithPortrait(cnicFront(IDENTITY), portraitOnCard, { top: 130, left: 40, w: 230, h: 270 }),
    cardWithPortrait(licence(IDENTITY), portraitOnCard, { top: 130, left: 40, w: 230, h: 230 }),
    page(cnicBack(IDENTITY)),
    page(registration(IDENTITY)),
    page(carPhoto(IDENTITY)),
    portrait('sample1.jpg', 689, 689).then((b) => sharp(b).jpeg({ quality: 92 }).toBuffer()),
  ]);
  objects.set('d/cnicFront.jpg', frontCard);
  objects.set('d/cnicBack.jpg', backCard);
  objects.set('d/license.jpg', licenceCard);
  objects.set('d/registration.jpg', book);
  objects.set('d/car.jpg', car);
  objects.set('d/selfie.jpg', selfie);
  return [
    { kind: 'selfie', path: 'd/selfie.jpg' },
    { kind: 'license', path: 'd/license.jpg' },
    { kind: 'cnicFront', path: 'd/cnicFront.jpg' },
    { kind: 'cnicBack', path: 'd/cnicBack.jpg' },
    { kind: 'vehicleRegistration', path: 'd/registration.jpg' },
    { kind: 'vehiclePhoto', path: 'd/car.jpg' },
  ];
}

function show(report) {
  for (const doc of report.documents) {
    console.log(
      `    ${doc.kind.padEnd(20)} looksLike=${doc.looksLike.padEnd(22)} conf=${doc.confidence.padEnd(6)} legible=${doc.legible}`,
    );
  }
  console.log(`    crossChecks: ${JSON.stringify(report.crossChecks)}`);
}

async function main() {
  stubFirebase();
  const engine = require(path.join(COMPILED, 'lib', 'driverVerificationLocal.js'));
  const decide = require(path.join(COMPILED, 'domain', 'driverVerification.js'));
  const scoring = require(path.join(COMPILED, 'domain', 'faceScan.js'));

  console.log('\n=== 1. A clean application: the card portrait IS the applicant ===');
  let t = Date.now();
  let documents = await buildApplication({ portraitOnCard: 'sample2.jpg' });
  let report = await engine.readDriverDocuments(documents, { cnic: IDENTITY.cnic });
  console.log(`  read six documents in ${Date.now() - t} ms`);
  if (!report) {
    console.log('  FAIL  the engine returned null — nothing was read at all');
    failures++;
  } else {
    show(report);
    const front = report.documents.find((d) => d.kind === 'cnicFront');
    check(
      'every slot held the right document',
      report.documents.every((d) => decide.EXPECTED_LOOK[d.kind].includes(d.looksLike)),
      true,
    );
    check('CNIC number read off the card', front.fields.idNumber, IDENTITY.cnic);
    check('name read off the card', front.fields.name, IDENTITY.name);
    check("father's name read off the card", front.fields.fatherName, IDENTITY.father);
    check('date of birth', front.fields.dateOfBirth, IDENTITY.dob);
    check('date of expiry', front.fields.expiryDate, IDENTITY.expiry);
    check('licence expiry', report.documents.find((d) => d.kind === 'license').fields.expiryDate, IDENTITY.expiry);
    check(
      'plate off the registration',
      report.documents.find((d) => d.kind === 'vehicleRegistration').fields.plate,
      IDENTITY.plate,
    );
    check(
      'no plate is claimed off the car photograph',
      report.documents.find((d) => d.kind === 'vehiclePhoto').fields.plate,
      null,
    );
    check('the live face is the card face', report.crossChecks.faceConsistency, 'match');
    check('names agree across the papers', report.crossChecks.nameConsistency, 'match');
    check('CNIC number agrees across the papers', report.crossChecks.idNumberConsistency, 'match');
    check('nothing is claimed about tampering', report.documents.every((d) => d.tampering === 'none'), true);
    check('no fraud signal is raised', report.fraudSignals, []);
    check('overall confidence', report.overallConfidence, 'high');

    const verdict = decide.decideDriverVerification({
      report,
      submitted: FORM,
      duplicates: [],
      faceScan: { status: 'missing', matchesDocuments: 'unclear', passedAtMs: null },
      now: NOW,
    });
    console.log(`  verdict: ${verdict.status}, risk ${verdict.riskScore}, reasons [${verdict.reasons.map((r) => r.code).join(', ')}]`);
    check('a clean application is APPROVED without a human', verdict.status, 'approved');
  }

  console.log('\n=== 2. The same papers, but the card portrait is somebody else ===');
  documents = await buildApplication({ portraitOnCard: 'sample5.jpg' });
  report = await engine.readDriverDocuments(documents, { cnic: IDENTITY.cnic });
  console.log(`    crossChecks: ${JSON.stringify(report.crossChecks)}`);
  check('the face is reported as a mismatch', report.crossChecks.faceConsistency, 'mismatch');
  check('and it is listed as a signal', report.fraudSignals.includes('face_mismatch'), true);
  check('confidence falls below the approval bar', report.overallConfidence !== 'high', true);
  const impostor = decide.decideDriverVerification({
    report,
    submitted: FORM,
    duplicates: [],
    now: NOW,
  });
  console.log(`  verdict: ${impostor.status}, risk ${impostor.riskScore}, reasons [${impostor.reasons.map((r) => r.code).join(', ')}]`);
  check('a borrowed card goes to a HUMAN, never to an auto-reject', impostor.status, 'review');

  console.log('\n=== 3. A document in the wrong slot ===');
  documents = await buildApplication({ portraitOnCard: 'sample2.jpg' });
  objects.set('d/license.jpg', objects.get('d/registration.jpg'));
  report = await engine.readDriverDocuments(documents, { cnic: IDENTITY.cnic });
  const slot = report.documents.find((d) => d.kind === 'license');
  check('the licence slot is seen to hold the registration', slot.looksLike, 'vehicle_registration');
  check('and the engine says so out loud', report.fraudSignals.includes('wrong_document_type'), true);
  const wrongSlot = decide.decideDriverVerification({
    report,
    submitted: FORM,
    duplicates: [],
    now: NOW,
  });
  console.log(`  verdict: ${wrongSlot.status}, reasons [${wrongSlot.reasons.map((r) => r.code).join(', ')}]`);
  check('which is a rejection the driver can act on', wrongSlot.status, 'rejected');
  check('and it names the section to redo', wrongSlot.rejectedSections.includes('license'), true);

  console.log('\n=== 4. An expired licence ===');
  documents = await buildApplication({ portraitOnCard: 'sample2.jpg' });
  objects.set(
    'd/license.jpg',
    await cardWithPortrait(
      licence({ ...IDENTITY, issue: '02.03.2014', expiry: '02.03.2019' }),
      'sample2.jpg',
      { top: 130, left: 40, w: 230, h: 230 },
    ),
  );
  report = await engine.readDriverDocuments(documents, { cnic: IDENTITY.cnic });
  check(
    'the printed expiry is read exactly as printed',
    report.documents.find((d) => d.kind === 'license').fields.expiryDate,
    '02.03.2019',
  );
  const expired = decide.decideDriverVerification({
    report,
    submitted: { ...FORM, licenseExpiry: '02.03.2019' },
    duplicates: [],
    now: NOW,
  });
  console.log(`  verdict: ${expired.status}, reasons [${expired.reasons.map((r) => r.code).join(', ')}]`);
  check('an expired licence is refused on the spot', expired.status, 'rejected');
  check('for the right reason', expired.reasons.some((r) => r.code === 'document_expired'), true);

  console.log('\n=== 5. An upload that will not load at all ===');
  documents = await buildApplication({ portraitOnCard: 'sample2.jpg' });
  objects.delete('d/cnicBack.jpg');
  report = await engine.readDriverDocuments(documents, { cnic: IDENTITY.cnic });
  check('the slot is still reported, not quietly dropped', report.documents.length, 6);
  check(
    'and it is reported as unreadable',
    report.documents.find((d) => d.kind === 'cnicBack').looksLike,
    'unreadable',
  );
  check('so the engine cannot claim high confidence', report.overallConfidence !== 'high', true);
  const lost = decide.decideDriverVerification({
    report,
    submitted: FORM,
    duplicates: [],
    now: NOW,
  });
  console.log(`  verdict: ${lost.status}, reasons [${lost.reasons.map((r) => r.code).join(', ')}]`);
  check('a human looks rather than the paper being treated as fine', lost.status, 'review');

  console.log('\n=== 6. The live face scan ===');
  objects.clear();
  objects.set('f/0.jpg', await sharp(await portrait('sample1.jpg', 689, 689)).jpeg().toBuffer());
  objects.set('f/1.jpg', await sharp(await portrait('sample6.jpg', 689, 689)).jpeg().toBuffer());
  objects.set(
    'f/id.jpg',
    await cardWithPortrait(cnicFront(IDENTITY), 'sample2.jpg', { top: 130, left: 40, w: 230, h: 270 }),
  );

  t = Date.now();
  const asked = ['look_straight', 'smile'];
  const scan = await engine.readFaceScan({
    frames: [
      { index: 0, path: 'f/0.jpg' },
      { index: 1, path: 'f/1.jpg' },
    ],
    asked,
    idPhotoPath: 'f/id.jpg',
  });
  console.log(`  scored two frames in ${Date.now() - t} ms`);
  for (const f of scan.frames) {
    console.log(`    frame ${f.index}: visible=${f.faceVisible} pose=${f.poseObserved} recaptured=${f.recaptured}`);
  }
  check('both frames had a face', scan.frames.every((f) => f.faceVisible), true);
  check('the frames differ, so a live person', scan.livePerson, true);
  check('one person across the frames', scan.samePersonAcrossFrames, true);
  check('the straight-ahead frame was seen as such', scan.frames[0].poseObserved, 'look_straight');
  check('the smile was seen', scan.frames[1].poseObserved, 'smile');
  check('the live face is not called a stranger', scan.matchesIdPhoto !== 'mismatch', true);
  const passed = scoring.scoreFaceScan({ report: scan, asked });
  console.log(`  scan verdict: ${passed.status} — ${passed.message}`);
  check('the scan PASSES', passed.status, 'passed');

  console.log('\n  --- the same photograph handed in for both poses ---');
  objects.set('f/1.jpg', objects.get('f/0.jpg'));
  const replay = await engine.readFaceScan({
    frames: [
      { index: 0, path: 'f/0.jpg' },
      { index: 1, path: 'f/1.jpg' },
    ],
    asked,
    idPhotoPath: null,
  });
  check('caught as a recapture', replay.frames.some((f) => f.recaptured), true);
  check('and not a live person', replay.livePerson, false);
  const failed = scoring.scoreFaceScan({ report: replay, asked });
  console.log(`  scan verdict: ${failed.status} — ${failed.message}`);
  check('the scan FAILS', failed.status, 'failed');

  console.log('\n  --- a frame with no face in it ---');
  objects.set('f/1.jpg', await page(carPhoto(IDENTITY)));
  const noFace = await engine.readFaceScan({
    frames: [
      { index: 0, path: 'f/0.jpg' },
      { index: 1, path: 'f/1.jpg' },
    ],
    asked,
    idPhotoPath: null,
  });
  check('the empty frame is reported as empty', noFace.frames[1].faceVisible, false);
  check('and the scan is not live', noFace.livePerson, false);
  check('the scan FAILS', scoring.scoreFaceScan({ report: noFace, asked }).status, 'failed');

  // Sized from this, not guessed: the sweeper and submitFaceScan have to be
  // given more memory than one application actually costs.
  const peakMb = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(`\n  peak resident memory for one application: ${peakMb} MB`);
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nthe harness itself broke:', e);
  process.exit(1);
});
