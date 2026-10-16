/**
 * The rules our own verification engine reads documents and faces by.
 *
 * This is the judgement-free half of the engine: given text that came off an
 * image, or 68 landmark points that came off a face, what does it say? No
 * Firestore, no models, no network, no clock that is not passed in — so every
 * rule here is unit-testable offline, which matters more than usual because
 * these rules decide whether somebody gets to work.
 *
 * WHY WE HAVE OUR OWN. The engine used to be one vision-model call per
 * application. That is accurate, and it costs a key, a bill, and a third party
 * in the loop of a decision about a Pakistani driver's livelihood. Everything
 * here runs inside the function: Tesseract for the text, a 128-dimension face
 * descriptor for the faces, plain arithmetic for the rest.
 *
 * WHAT IT GIVES UP, stated plainly because the decision logic trusts this file:
 * a model can look at a card and say "this number has been painted over". We
 * cannot. So this engine NEVER reports tampering, a stock photograph, or a
 * photocopy — see UNDETECTABLE_LOCALLY. It reports only what arithmetic can
 * establish, and says `low` confidence rather than guessing. A paper this
 * engine cannot read is a paper a human reads; silence is never a pass.
 */
import type { Agreement, Confidence, DocumentKind, LooksLike } from './driverVerification';
import type { FaceChallenge } from './faceScan';

/**
 * The fraud signals a vision model could raise and this engine cannot.
 *
 * Listed rather than left implicit: anyone reading a verification report has to
 * know that the absence of these is absence of evidence, not evidence of
 * absence. They are why the engine's ceiling is "nothing here is provably
 * wrong" and never "this application is certainly genuine", and why
 * `requireHighConfidence` should stay on.
 */
export const UNDETECTABLE_LOCALLY = [
  'digital_edit',
  'stock_or_internet_image',
  'photocopy_presented_as_original',
  'screen_recapture',
] as const;

// ── Reading text off a document ──────────────────────────────────────────────

/**
 * Words that identify each kind of Pakistani paper.
 *
 * Matched case-insensitively against the whole OCR text, as short distinctive
 * fragments rather than whole phrases — "identity number" survives a card whose
 * top line came out as "ISLAMIC REPUBLlC 0F PAKISTAN", which a full-phrase
 * match would not.
 *
 * Deliberately NOT a list of provinces for the licence: Punjab, Sindh, KPK,
 * Balochistan and Islamabad all print differently, and change every few years.
 * A licence that failed to match an unfamiliar layout would be called a
 * forgery, so the licence is recognised by the words all of them carry.
 */
const DOCUMENT_MARKERS: Record<'cnicFront' | 'cnicBack' | 'license' | 'vehicleRegistration', string[]> = {
  cnicFront: [
    'identity card',
    'identity number',
    'national identity',
    'republic of pakistan',
    'father name',
    'country of stay',
    'date of birth',
  ],
  cnicBack: [
    'permanent address',
    'temporary address',
    'present address',
    'signature',
    'registrar',
    'nadra',
    'national database',
  ],
  license: [
    'driving licence',
    'driving license',
    'licence no',
    'license no',
    'driving',
    'ltv',
    'htv',
    'motor cycle',
    'motorcycle',
    'blood group',
    'valid till',
    'traffic police',
    'category',
  ],
  vehicleRegistration: [
    'registration',
    'excise',
    'taxation',
    'engine no',
    'chassis',
    'chasis',
    'horse power',
    'seating capacity',
    'token tax',
    'owner name',
  ],
};

/** A specimen card says so on its face. Any of these and it is not a real card. */
const SPECIMEN_MARKERS = ['specimen', 'sample only', 'not valid', 'void', 'dummy', 'template'];

function hits(text: string, markers: string[]): number {
  const haystack = text.toLowerCase();
  return markers.reduce((n, m) => (haystack.includes(m) ? n + 1 : n), 0);
}

/** Does the card admit, in print, to being a sample? */
export function looksLikeSpecimen(text: string): boolean {
  return hits(text, SPECIMEN_MARKERS) > 0;
}

/**
 * How much text we got off an image, as a count of word-like runs.
 *
 * Used to tell a photograph (a car, a person — almost no text) from a paper
 * (dozens of words).
 */
export function textDensity(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]{2,}/.test(w)).length;
}

/** Below this many words, an image carries too little text to be a document. */
export const MIN_DOCUMENT_WORDS = 8;

/**
 * How much of the frame a face has to fill before the image is a portrait OF
 * that person rather than a picture that happens to contain them.
 *
 * This number exists because of one specific honest mistake with a severe
 * consequence: a driver who photographs their car with themselves standing
 * beside it. A face found anywhere in frame would make that a `person_photo` in
 * the vehicle slot, which the decision logic reads as the wrong kind of
 * document — a FATAL reason, an automatic rejection of a real driver with a
 * real car. A selfie's face fills a tenth of the frame or more; a man standing
 * by a Corolla fills well under a hundredth.
 */
export const PORTRAIT_MIN_FACE_COVERAGE = 0.03;

/**
 * What an image actually is, from its text, its faces, and the slot it came in.
 *
 * Positive identification always wins: a CNIC uploaded into the licence slot is
 * reported as a CNIC, which is the mistake the slot check exists to catch and a
 * far more common one here than forgery.
 *
 * The slot only decides the cases where there is nothing to identify. A
 * photograph of a car has no text to match and no face to find, so it is
 * indistinguishable by these means from a photograph of a wall — and
 * `expected` is what stops every honest car photograph being called
 * unreadable. The slot is never allowed to vouch for a document, and never for
 * a portrait with no face in it.
 */
export function classifyDocument(params: {
  text: string;
  hasFace: boolean;
  /** Face box area over image area, 0 when no face was found. */
  faceCoverage: number;
  /** True when the image is too soft for its text to be trusted. */
  blurred: boolean;
  /** What this slot is supposed to contain. */
  expected: LooksLike;
}): LooksLike {
  const words = textDensity(params.text);

  if (words < MIN_DOCUMENT_WORDS) {
    // Too little text to identify a paper. Decide on the face and the slot.
    if (params.hasFace && params.faceCoverage >= PORTRAIT_MIN_FACE_COVERAGE) return 'person_photo';
    if (params.blurred) return 'unreadable';
    // A face too small to be the subject does not stop this being the car.
    if (params.expected === 'vehicle_photo') return 'vehicle_photo';
    // A portrait slot still has to show a face, at any size — "no face in the
    // selfie" is real evidence and is not waved through by the slot.
    if (params.expected === 'person_photo' && params.hasFace) return 'person_photo';
    return 'unreadable';
  }

  const scores = {
    license: hits(params.text, DOCUMENT_MARKERS.license),
    cnicFront: hits(params.text, DOCUMENT_MARKERS.cnicFront),
    cnicBack: hits(params.text, DOCUMENT_MARKERS.cnicBack),
    vehicleRegistration: hits(params.text, DOCUMENT_MARKERS.vehicleRegistration),
  };

  // A CNIC front carries a photograph and the identity number; the back carries
  // an address and no face. When both sides score, the face and the number
  // break the tie — the two sides of one card share a lot of vocabulary.
  if (scores.cnicFront > 0 && scores.cnicFront >= scores.cnicBack) {
    if (scores.license > scores.cnicFront) return 'driving_license';
    return params.hasFace || readCnicNumber(params.text) ? 'cnic_front' : 'cnic_back';
  }
  if (
    scores.cnicBack > 0 &&
    scores.cnicBack >= scores.license &&
    scores.cnicBack >= scores.vehicleRegistration
  ) {
    return 'cnic_back';
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  if (!best || best[1] === 0) {
    // Text came off the image, but none of it belongs to any Pakistani document
    // we know. That is only evidence of ANOTHER document — the fatal verdict —
    // for a slot that asked for a document. A photograph of a car legitimately
    // carries a plate, a dealer sticker and whatever is written on the wall
    // behind it, which is easily enough words to land here; calling that an
    // unrelated document would reject a real driver over his own number plate.
    if (params.hasFace && params.faceCoverage >= PORTRAIT_MIN_FACE_COVERAGE) return 'person_photo';
    if (params.expected === 'vehicle_photo') return 'vehicle_photo';
    if (params.expected === 'person_photo') return params.hasFace ? 'person_photo' : 'unreadable';
    return params.blurred ? 'unreadable' : 'other_document';
  }
  switch (best[0]) {
    case 'license':
      return 'driving_license';
    case 'cnicFront':
      return 'cnic_front';
    case 'cnicBack':
      return 'cnic_back';
    default:
      return 'vehicle_registration';
  }
}

/**
 * The 13-digit CNIC number, if the card gave us one.
 *
 * Returned in the hyphenated spelling NADRA prints, because the rest of the
 * system normalises on the way in (normalizeCnic) and a report should show what
 * the card says. Only the 00000-0000000-0 shape is accepted: a bare run of 13
 * digits is as likely to be an engine number or a phone number.
 */
export function readCnicNumber(text: string): string | null {
  const m = /(\d{5})\s*[-–—]?\s*(\d{7})\s*[-–—]?\s*(\d)(?!\d)/.exec(text);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * A plate is read off the REGISTRATION DOCUMENT, and never off a photograph of
 * the car.
 *
 * Measured, not assumed: on a clean synthetic car photograph with the plate
 * squarely in frame, OCR returned `LEA-482` for a plate reading `LEA-4821`. It
 * dropped a digit and reported good confidence doing it. Compared against the
 * registration that is a `plate_mismatch` — thirty points of risk and a flag an
 * admin then has to overturn — on an application where nothing is wrong.
 *
 * A plate at an angle, in sun, across a car park, is simply not something this
 * engine can read to the character. So it does not try, `plateConsistency` is
 * reported as undecided, and the plate the decision logic uses is the one
 * printed on the registration book, where OCR has a flat page and good
 * contrast. What is lost is the check that the car photographed is the car
 * registered; a human still sees both pictures.
 */
export const PLATE_IS_ONLY_READ_FROM_THE_DOCUMENT = true;

/** Pakistani plates: two or three letters, then three or four digits. */
export function readPlate(text: string): string | null {
  const m = /\b([A-Z]{2,3})\s*[-–—]?\s*(\d{3,4})\b/.exec(text.toUpperCase());
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

/** Every date in the text, in the order printed, exactly as printed. */
export function readDates(text: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0].replace(/\s+/g, ''));
  return out;
}

type DateKey = 'dateOfBirth' | 'issueDate' | 'expiryDate';

/** The labels NADRA and the excise offices print above their three dates. */
const DATE_LABELS: Array<{ key: DateKey; words: string[] }> = [
  { key: 'dateOfBirth', words: ['date of birth', 'd.o.b', 'dob', 'birth'] },
  { key: 'issueDate', words: ['date of issue', 'issue'] },
  {
    key: 'expiryDate',
    words: ['date of expiry', 'valid till', 'valid upto', 'valid up to', 'expiry', 'expires'],
  },
];

type DateFields = Record<DateKey, string | null>;

/** Which date labels a line carries, left to right. */
function labelsOn(line: string): DateKey[] {
  const lower = line.toLowerCase();
  const marks: Array<{ at: number; key: DateKey }> = [];
  for (const { key, words } of DATE_LABELS) {
    for (const word of words) {
      const at = lower.indexOf(word);
      if (at >= 0) {
        marks.push({ at, key });
        break; // Longest spelling first, so "date of birth" wins over "birth".
      }
    }
  }
  const found: DateKey[] = [];
  for (const mark of marks.sort((a, b) => a.at - b.at)) {
    if (!found.includes(mark.key)) found.push(mark.key);
  }
  return found;
}

/**
 * Pull the dates apart and work out which is which.
 *
 * Three strategies, in order of how much they prove:
 *
 *   1. The label and the date on ONE line — "Date of Expiry 02.03.2029".
 *   2. A row of labels above a row of dates, paired left to right. This is what
 *      a real CNIC actually produces: OCR reads the three headings as one line
 *      and the three dates as the next, so nothing on either line is attached
 *      to anything on the other except by position.
 *   3. Nothing labelled, but exactly three dates found: earliest is the birth,
 *      latest the expiry, the remaining one the issue. True of every CNIC and
 *      licence ever issued, and what keeps a card with a worn heading row
 *      readable.
 *
 * Anything less certain is left null, which costs the applicant a human
 * reviewer rather than a wrong date on their file.
 */
export function readLabelledDates(text: string): DateFields {
  const out: DateFields = { dateOfBirth: null, issueDate: null, expiryDate: null };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let i = 0; i < lines.length; i++) {
    const keys = labelsOn(lines[i]);
    if (keys.length === 0) continue;

    // 1 — same line.
    const sameLine = readDates(lines[i]);
    if (sameLine.length >= keys.length) {
      keys.forEach((key, n) => {
        if (!out[key]) out[key] = sameLine[n];
      });
      continue;
    }

    // 2 — the row underneath, paired by position.
    const below = readDates(lines[i + 1] ?? '');
    if (below.length >= keys.length) {
      keys.forEach((key, n) => {
        if (!out[key]) out[key] = below[n];
      });
    }
  }

  // 3 — nothing attached to a label, but the card gave us a full set.
  if (!out.dateOfBirth && !out.issueDate && !out.expiryDate) {
    const all = readDates(text);
    const sorted = [...all].sort((a, b) => (sortableDate(a) ?? 0) - (sortableDate(b) ?? 0));
    if (all.length === 3) {
      out.dateOfBirth = sorted[0];
      out.issueDate = sorted[1];
      out.expiryDate = sorted[2];
    } else if (all.length === 2) {
      // A licence often prints only issue and expiry.
      out.issueDate = sorted[0];
      out.expiryDate = sorted[1];
    }
  }
  return out;
}

/** Day-first, for ordering only — the printed spelling is what gets reported. */
function sortableDate(raw: string): number | null {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(raw);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  return year * 10000 + Number(m[2]) * 100 + Number(m[1]);
}

/**
 * Words printed on the cards themselves, which are therefore never a name.
 *
 * Matched as whole words rather than as substrings, so a real name is never
 * truncated by a heading that happens to be inside it.
 */
const NAME_NOISE = new Set([
  'name', 'father', 'husband', 'gender', 'country', 'stay', 'identity', 'pakistan',
  'islamic', 'republic', 'national', 'birth', 'date', 'issue', 'expiry', 'expires',
  'valid', 'till', 'upto', 'signature', 'address', 'permanent', 'temporary', 'present',
  'holder', 'card', 'number', 'licence', 'license', 'category', 'blood', 'group',
  'government', 'punjab', 'sindh', 'balochistan', 'islamabad', 'excise', 'taxation',
  'department', 'registration', 'owner', 'make', 'model', 'colour', 'color', 'engine',
  'chassis', 'chasis', 'horse', 'power', 'seating', 'capacity', 'token', 'tax',
  'authority', 'registrar', 'nadra', 'database', 'driving', 'traffic', 'police',
  'city', 'book', 'the', 'and', 'of', 'no',
]);

/** Could this word be part of a printed name? */
function isNameWord(token: string): boolean {
  // Cards print names in Title Case or in capitals; a lower-case first letter
  // is OCR noise far more often than it is a name.
  if (!/^[A-Z][A-Za-z]+$/.test(token)) return false;
  return !NAME_NOISE.has(token.toLowerCase());
}

/**
 * The longest run of name-like words in one line of OCR output.
 *
 * Written as a run rather than as a pattern over the whole line because that is
 * what Tesseract actually hands back. A real CNIC produces lines like
 * `§ 3 Z&' Muhammad Imran Khan` — the security guilloche either side of the
 * printed name comes through as punctuation — and a regular expression anchored
 * to the start of the line matches none of it, which left every applicant with
 * no name read off their card and a `name_unclear` reason on their file.
 */
export function nameFromLine(line: string): string | null {
  let best: string[] = [];
  let run: string[] = [];
  for (const raw of line.split(/\s+/)) {
    // Strip the punctuation OCR hangs off the ends of real words.
    const token = raw.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '');
    if (token && isNameWord(token)) {
      run.push(token);
    } else {
      if (run.length > best.length) best = run;
      run = [];
    }
  }
  if (run.length > best.length) best = run;
  if (best.length === 0) return null;
  // One word is a name only if it is long enough to be one, and a name is at
  // least six letters all told — otherwise a stray "Al" or "Se" becomes a name
  // and then a name mismatch.
  if (best.length === 1 && best[0].length < 4) return null;
  const joined = best.join(' ');
  return joined.replace(/\s/g, '').length >= 6 ? joined : null;
}

/**
 * The name and the father's name off a card.
 *
 * Reads the value beside the heading, or on one of the next two lines, which is
 * how both NADRA and every provincial licence lay the card out. "Father Name"
 * is tested before "Name" because it contains it; the other way round
 * attributes the father's name to the applicant, which reads as a name mismatch
 * and sends an honest driver to a reviewer.
 */
export function readNames(text: string): { name: string | null; fatherName: string | null } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let name: string | null = null;
  let fatherName: string | null = null;

  const valueAfter = (index: number, label: string): string | null => {
    const line = lines[index];
    const at = line.toLowerCase().indexOf(label);
    const beside = nameFromLine(line.slice(at + label.length));
    if (beside) return beside;
    for (let j = index + 1; j < Math.min(lines.length, index + 3); j++) {
      const below = nameFromLine(lines[j]);
      if (below) return below;
    }
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (!fatherName && (lower.includes('father') || lower.includes('husband'))) {
      fatherName = valueAfter(i, lower.includes('father') ? 'father' : 'husband');
      continue;
    }
    if (!name && lower.includes('name')) name = valueAfter(i, 'name');
  }
  return { name, fatherName };
}

// ── Comparing faces ──────────────────────────────────────────────────────────

/**
 * How far apart two 128-dimension face descriptors may be and still be one
 * person.
 *
 * Calibrated, not guessed: against the reference faces that ship with the
 * descriptor model, two photographs of the same person measured 0.51, and three
 * pairs of different people measured 0.71, 0.71 and 0.75. The band between the
 * two numbers below is therefore genuinely undecided, and is reported as such.
 *
 * The gap is wide on purpose. A CNIC photograph is often a decade old, at 200
 * dpi, behind a security laminate, of a man who has since grown a beard — a
 * harder comparison than any pair these numbers were measured on. Reporting
 * `unclear` costs one human review; reporting `mismatch` wrongly puts a mark on
 * an honest applicant's file.
 */
export const FACE_SAME_PERSON_BELOW = 0.58;
export const FACE_DIFFERENT_PERSON_ABOVE = 0.75;

export function faceAgreement(distance: number | null): Agreement {
  if (distance === null || !Number.isFinite(distance)) return 'unclear';
  if (distance <= FACE_SAME_PERSON_BELOW) return 'match';
  if (distance >= FACE_DIFFERENT_PERSON_ABOVE) return 'mismatch';
  return 'unclear';
}

// ── Reading a pose off 68 landmarks ──────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** The numbers a pose is judged on, all scale- and position-free. */
export interface FaceGeometry {
  /** Nose tip nearer one eye than the other. The sign is NOT a direction. */
  yaw: number;
  /** Chin-to-nose against nose-to-eyes, vertically. */
  pitch: number;
  /** Inner-lip opening against lip width. */
  mouthOpen: number;
  /** Lip corners apart, against the distance between the eyes. */
  mouthWidth: number;
  /** Distance between the eye centres, in pixels — the scale of the face. */
  interocular: number;
}

/**
 * WHICH WAY the head turned is not checked, and cannot be.
 *
 * A front camera may or may not mirror the frame it saves; it varies by handset
 * and by Android version, and nothing in the image says which happened. So a
 * left turn and a right turn are the same observation here, and either
 * satisfies either prompt.
 *
 * What that costs: the server draws its sequence from six poses, and conflating
 * the two turns makes it effectively five. A still photograph held to the
 * camera still fails — it does not turn, smile or open its mouth on command —
 * which is what the sequence is for. What pretending otherwise would cost: half
 * of all honest drivers asked to turn their head, failed on a coin toss.
 *
 * The same applies to tilt: `look_up` is confirmed as vertical head movement,
 * without asserting up from down.
 */
export const TURN_DIRECTION_IS_NOT_CHECKED = true;

/**
 * Turn and tilt are measured against the applicant's OWN straight-ahead frame,
 * never against a fixed number, because a fixed number would be wrong for most
 * faces. Measured across the reference faces, six people all looking straight
 * at the camera spread over yaw 0.069–0.129 and pitch 1.18–1.68 — wider than
 * the movement being detected. Between two frames of ONE face that spread is
 * not there, so a change this size is a real movement.
 *
 * The server always asks for `look_straight` first (pickChallenges guarantees
 * it), which is what makes a per-applicant baseline available at all.
 */
export const TURN_DELTA = 0.12;
export const TILT_DELTA = 0.18;
/** Absolute band for the first frame, which has no baseline of its own yet. */
export const STRAIGHT_YAW_LIMIT = 0.22;
/** Inner-lip opening that is an open mouth rather than a broad smile. */
export const MOUTH_OPEN_RATIO = 0.35;
export const MOUTH_OPEN_DELTA = 0.18;
/** How sure the expression model has to be to call a smile a smile. */
export const SMILE_PROBABILITY = 0.6;

const distanceBetween = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts: Point[]): Point => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/**
 * Turn the 68 landmark points into the ratios above.
 *
 * Takes plain points rather than the model's own landmark object, so every rule
 * in this file stays testable without loading a neural network.
 */
export function measureFaceGeometry(parts: {
  leftEye: Point[];
  rightEye: Point[];
  nose: Point[];
  mouth: Point[];
  jaw: Point[];
}): FaceGeometry | null {
  const { leftEye, rightEye, nose, mouth, jaw } = parts;
  if (
    leftEye.length < 4 ||
    rightEye.length < 4 ||
    nose.length < 4 ||
    mouth.length < 20 ||
    jaw.length < 9
  ) {
    return null;
  }
  const leftCentre = centre(leftEye);
  const rightCentre = centre(rightEye);
  const interocular = distanceBetween(leftCentre, rightCentre);
  if (interocular < 1) return null;

  const tip = nose[nose.length - 1];
  const eyeMid = centre([leftCentre, rightCentre]);
  const chin = jaw[Math.floor(jaw.length / 2)];

  const toLeft = distanceBetween(tip, leftEye[0]);
  const toRight = distanceBetween(tip, rightEye[3]);

  // Inner lips are the last eight of the twenty mouth points (68-point scheme).
  const inner = mouth.slice(12);
  const lipWidth = distanceBetween(inner[0], inner[4]);
  const lipHeight =
    (distanceBetween(inner[1], inner[7]) +
      distanceBetween(inner[2], inner[6]) +
      distanceBetween(inner[3], inner[5])) /
    3;

  const eyeToNose = tip.y - eyeMid.y;
  return {
    yaw: (toLeft - toRight) / Math.max(1e-6, toLeft + toRight),
    pitch: (chin.y - tip.y) / (Math.abs(eyeToNose) < 1 ? 1 : eyeToNose),
    mouthOpen: lipHeight / Math.max(1e-6, lipWidth),
    mouthWidth: distanceBetween(mouth[0], mouth[6]) / interocular,
    interocular,
  };
}

/** What a frame can be shown to be doing, as opposed to what it was asked. */
export type PoseCategory = 'straight' | 'turned' | 'tilted' | 'smiling' | 'mouth_open' | 'unclear';

/** Which observation satisfies which prompt. */
export const CATEGORY_OF_CHALLENGE: Record<FaceChallenge, PoseCategory> = {
  look_straight: 'straight',
  turn_left: 'turned',
  turn_right: 'turned',
  look_up: 'tilted',
  smile: 'smiling',
  open_mouth: 'mouth_open',
};

/**
 * What this frame is doing.
 *
 * Mouth first: an open mouth and a smile are decided by the face itself, while
 * a turn and a tilt are decided by how far the face has moved from its own
 * first frame. A frame that moved in no measurable way is straight, which is a
 * real answer and not a failure to classify.
 */
export function categorisePose(params: {
  geometry: FaceGeometry;
  /** The applicant's own `look_straight` frame. Absent for frame 0 itself. */
  baseline?: FaceGeometry | null;
  /** The expression model's probability that this face is smiling. */
  smileProbability: number;
}): PoseCategory {
  const { geometry, baseline, smileProbability } = params;

  const openedFurther = baseline ? geometry.mouthOpen - baseline.mouthOpen >= MOUTH_OPEN_DELTA : false;
  if (geometry.mouthOpen >= MOUTH_OPEN_RATIO || openedFurther) return 'mouth_open';
  if (smileProbability >= SMILE_PROBABILITY) return 'smiling';

  if (!baseline) {
    // Frame 0. Nothing to compare against, so only a gross turn can be ruled
    // out; the band is wide because every honest frontal face measured inside it.
    return Math.abs(geometry.yaw) <= STRAIGHT_YAW_LIMIT ? 'straight' : 'turned';
  }

  const sideways = Math.abs(geometry.yaw - baseline.yaw);
  const vertical = Math.abs(geometry.pitch - baseline.pitch);

  if (sideways >= TURN_DELTA && sideways >= vertical) return 'turned';
  if (vertical >= TILT_DELTA) return 'tilted';
  if (sideways < TURN_DELTA && vertical < TILT_DELTA) return 'straight';
  return 'unclear';
}

/**
 * Report a frame against what it was asked to do.
 *
 * Returns the challenge itself when the observation satisfies it — including
 * for either turn, per TURN_DIRECTION_IS_NOT_CHECKED — and otherwise the pose
 * the frame is actually doing, so an admin reading the report sees the real
 * mistake rather than a bare "wrong".
 */
export function observedPose(params: {
  asked: FaceChallenge | undefined;
  category: PoseCategory;
}): FaceChallenge | 'other' | 'unclear' {
  const { asked, category } = params;
  if (category === 'unclear') return 'unclear';
  if (asked && CATEGORY_OF_CHALLENGE[asked] === category) return asked;
  switch (category) {
    case 'straight':
      return 'look_straight';
    case 'turned':
      return 'turn_left';
    case 'tilted':
      return 'look_up';
    case 'smiling':
      return 'smile';
    case 'mouth_open':
      return 'open_mouth';
    default:
      return 'other';
  }
}

/**
 * Did these frames come from a person who moved, or from one photograph?
 *
 * The real local liveness test, and the one check here a printed photo cannot
 * pass: the server asked for three different things, so three frames whose
 * geometry is identical to several decimal places were not three responses. A
 * live face cannot hold that still, and a photograph cannot help it.
 */
export const LIVENESS_MIN_VARIATION = 0.02;

export function framesShowMovement(geometries: Array<FaceGeometry | null>): boolean {
  const seen = geometries.filter((g): g is FaceGeometry => g !== null);
  if (seen.length < 2) return false;
  const spread = (pick: (g: FaceGeometry) => number): number => {
    const values = seen.map(pick);
    return Math.max(...values) - Math.min(...values);
  };
  return (
    spread((g) => g.yaw) >= LIVENESS_MIN_VARIATION ||
    spread((g) => g.pitch) >= LIVENESS_MIN_VARIATION ||
    spread((g) => g.mouthOpen) >= LIVENESS_MIN_VARIATION ||
    spread((g) => g.mouthWidth) >= LIVENESS_MIN_VARIATION
  );
}

/**
 * Two frames that are the same image.
 *
 * Descriptors of one photograph submitted twice are identical; of two
 * photographs of one person seconds apart, never quite. This is the only
 * recapture signal the engine raises, because it is the only one it can prove.
 */
export const SAME_IMAGE_DISTANCE = 0.005;

// ── How sure the engine is ───────────────────────────────────────────────────

/**
 * Laplacian variance below which an image has been destroyed, rather than
 * merely taken badly.
 *
 * The floor is this low because the measure does not survive being compared
 * across crops, and a higher one failed honest photographs. Measured:
 *
 *   full reference photographs, in focus      320 – 2005
 *   a SHARP tight crop of one of them           104
 *   the same photograph blurred, sigma 2        141
 *   blurred sigma 4                              33
 *   blurred sigma 8                               7
 *
 * A sharp head-and-shoulders crop scores LOWER than a visibly out-of-focus
 * full frame, because cropping throws away the background detail that drove
 * the variance. So no single number separates sharp from blurred, and the first
 * attempt at one — a floor of 120 — marked every tightly framed selfie
 * illegible while passing photographs that were actually out of focus.
 *
 * It therefore decides only one thing: whether an image with no text and no
 * face in it is a photograph of something or a write-off. Legibility is decided
 * per slot, on evidence that means something — whether a face was found, or
 * whether the text came off confidently. See legibleFor() in
 * lib/driverVerificationLocal.ts.
 */
export const IMAGE_DESTROYED_BELOW = 25;
/** Tesseract's own mean word confidence, below which its text is not trusted. */
export const OCR_CONFIDENCE_FLOOR = 55;

/**
 * The engine's confidence in its own read of an application.
 *
 * `high` is a positive claim, and the bar is deliberately a checklist rather
 * than a feeling: every paper was the paper it should be, the CNIC number came
 * off the card and matched the form, a name was read, the licence expiry was
 * read, and the applicant's face was found on both the selfie and the card and
 * matched.
 *
 * `requireHighConfidence` gates auto-approval on exactly this, which makes this
 * function the thing standing between "we checked" and "we did not look". It
 * returns `high` only when the engine POSITIVELY established each item — an
 * unread field is never treated as a field with nothing wrong with it.
 */
export function readConfidence(params: {
  /** Documents whose slot and content agreed. */
  slotsCorrect: number;
  slotsExpected: number;
  cnicNumberRead: boolean;
  cnicMatchesForm: boolean;
  nameRead: boolean;
  licenceExpiryRead: boolean;
  faceComparable: boolean;
  faceMatched: boolean;
  /** Images too blurred to read, or OCR that distrusted itself. */
  unreadable: number;
}): Confidence {
  const everything =
    params.slotsCorrect === params.slotsExpected &&
    params.unreadable === 0 &&
    params.cnicNumberRead &&
    params.cnicMatchesForm &&
    params.nameRead &&
    params.licenceExpiryRead &&
    params.faceComparable &&
    params.faceMatched;
  if (everything) return 'high';

  // Nothing read off the papers at all, or most slots wrong: the engine has not
  // so much as identified the documents, and should say so rather than hedge.
  const mostSlotsWrong = params.slotsCorrect * 2 < params.slotsExpected;
  if (mostSlotsWrong || (!params.cnicNumberRead && !params.nameRead)) return 'low';
  return 'medium';
}

/** One line for the admin queue, naming what was and was not established. */
export function summarise(params: {
  documents: number;
  slotsCorrect: number;
  cnicNumberRead: boolean;
  faceAgreement: Agreement;
  faceDistance: number | null;
  confidence: Confidence;
}): string {
  const face =
    params.faceDistance === null
      ? 'the face could not be compared with the card'
      : `face ${params.faceAgreement} at distance ${params.faceDistance.toFixed(2)}`;
  return [
    'Read on this machine, with no external model.',
    `${params.slotsCorrect} of ${params.documents} uploads were the document the slot asked for;`,
    params.cnicNumberRead ? 'the CNIC number came off the card;' : 'the CNIC number could not be read;',
    `${face}.`,
    `Confidence ${params.confidence}.`,
    'This engine does not detect editing, photocopies, screen captures or stock',
    'photographs — their absence from this report is not a finding.',
  ].join(' ');
}

/** The slot a document was uploaded into, named for the report's notes field. */
export function slotLabel(kind: DocumentKind): string {
  switch (kind) {
    case 'selfie':
      return 'profile photo of the applicant';
    case 'license':
      return 'driving licence';
    case 'cnicFront':
      return 'CNIC front';
    case 'cnicBack':
      return 'CNIC back';
    case 'vehicleRegistration':
      return 'vehicle registration document';
    case 'vehiclePhoto':
      return 'photo of the vehicle';
  }
}
