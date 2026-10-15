/**
 * What a driver's papers have to prove — and what counts as proof.
 *
 * This file is the *judgement* half of the driver verification engine: given
 * what a vision model read off the documents, what the driver typed, and what
 * the rest of the fleet already contains, it answers one question — approve,
 * reject, or put this in front of a human?
 *
 * Pure functions only. No Firestore, no Anthropic, no `Date.now()` that is not
 * passed in. That is deliberate: this is the part that can quietly ruin
 * somebody's livelihood by getting an expiry date wrong, so it has to be
 * testable to the day, offline, without a key (see __tests__/driverVerification).
 *
 * THE POSTURE, which the thresholds below all serve:
 *
 *   · Auto-APPROVE only on a clean sweep. Every required paper present, the
 *     right kind of paper, readable, unexpired, naming the same person, with no
 *     sign of editing and nobody else already holding that CNIC. One doubt
 *     anywhere and a human looks instead.
 *   · Auto-REJECT only on facts that can be checked and shown. An expired
 *     licence, a vehicle registration where a licence should be, a specimen
 *     card, a CNIC that already belongs to an approved driver. Things the
 *     driver can be told plainly and can fix or dispute.
 *   · Everything in between is REVIEW. That is not a failure of the engine —
 *     it is the engine working. A wrong auto-approve puts an unvetted stranger
 *     in a car with a passenger; a wrong auto-reject takes away a job.
 *
 * One judgement is deliberately NOT allowed to reject on its own: whether the
 * face on the selfie is the face on the CNIC. Models are good enough at this to
 * raise a flag and nowhere near good enough to end an application, and the
 * people most often misread are the ones with the least recourse. A face
 * mismatch always routes to a human — see FACE_MISMATCH_IS_REVIEW_ONLY.
 */
import { FACE_SCAN_VALID_DAYS, faceScanIsFresh } from './faceScan';

/** The papers a driver submits, in the shape the onboarding form collects them. */
export type DocumentKind =
  | 'selfie'
  | 'license'
  | 'cnicFront'
  | 'cnicBack'
  | 'vehicleRegistration'
  | 'vehiclePhoto';

/** The four cards of the onboarding form — a rejection names the ones to redo. */
export type SectionKey = 'basic' | 'license' | 'cnic' | 'vehicle';

/** Which section a document belongs to, so a rejection reopens the right card. */
export const SECTION_OF: Record<DocumentKind, SectionKey> = {
  selfie: 'basic',
  license: 'license',
  cnicFront: 'cnic',
  cnicBack: 'cnic',
  vehicleRegistration: 'vehicle',
  vehiclePhoto: 'vehicle',
};

/** Documents without which there is nothing to judge. */
export const REQUIRED_DOCUMENTS: DocumentKind[] = [
  'selfie',
  'license',
  'cnicFront',
  'cnicBack',
  'vehicleRegistration',
  'vehiclePhoto',
];

/** What the model says a picture actually *is*, which may not be what was asked for. */
export type LooksLike =
  | 'driving_license'
  | 'cnic_front'
  | 'cnic_back'
  | 'vehicle_registration'
  | 'person_photo'
  | 'vehicle_photo'
  | 'other_document'
  | 'unreadable';

/** What each slot in the form is supposed to contain. */
export const EXPECTED_LOOK: Record<DocumentKind, LooksLike[]> = {
  selfie: ['person_photo'],
  license: ['driving_license'],
  cnicFront: ['cnic_front'],
  cnicBack: ['cnic_back'],
  vehicleRegistration: ['vehicle_registration'],
  vehiclePhoto: ['vehicle_photo'],
};

export type Confidence = 'high' | 'medium' | 'low';
export type Tampering = 'none' | 'suspected' | 'clear';
export type Agreement = 'match' | 'mismatch' | 'unclear';

/**
 * The fixed vocabulary of things that can be wrong.
 *
 * A closed set on purpose: the decision below switches on these, and a model
 * free to invent a seventeenth signal would be a model that can silently stop
 * triggering a rule. Anything it wants to say outside this list goes in `notes`,
 * which is shown to admins and never acted on automatically.
 */
export const FRAUD_SIGNALS = [
  /** Photographed off a laptop or phone screen rather than the card itself. */
  'screen_recapture',
  /** Pixel-level editing: cloned areas, mismatched fonts, altered numbers. */
  'digital_edit',
  /** A specimen/sample card, a template, or a novelty card. */
  'specimen_document',
  /** Recognisably a stock photo, a public figure, or an image off the internet. */
  'stock_or_internet_image',
  /** A photocopy or print-out passed off as the original document. */
  'photocopy_presented_as_original',
  /** The faces across the selfie, CNIC and licence are not the same person. */
  'face_mismatch',
  /** The names printed across the documents are not the same person's. */
  'name_mismatch',
  /** The CNIC number on the card and on the licence disagree. */
  'id_number_mismatch',
  /** The plate on the registration is not the plate on the car. */
  'plate_mismatch',
  /** The car photographed is not the car the registration describes. */
  'vehicle_mismatch',
  /** A paper of the wrong kind in this slot. */
  'wrong_document_type',
  /** The document is printed expired on its face. */
  'expired_document',
  /** Too blurred, dark, or cropped to read the fields that matter. */
  'unreadable_document',
  /** The date of birth makes the applicant implausibly young or old to drive. */
  'age_implausible',
  /** Two documents that should have been issued to one person disagree on it. */
  'cross_document_conflict',
] as const;

export type FraudSignal = (typeof FRAUD_SIGNALS)[number];

/** Everything the model read off one picture. */
export interface DocumentFinding {
  kind: DocumentKind;
  looksLike: LooksLike;
  legible: boolean;
  tampering: Tampering;
  /** A sample/specimen card rather than a real one issued to a person. */
  specimen: boolean;
  fields: {
    name: string | null;
    fatherName: string | null;
    /** CNIC number, licence number — whichever this document carries. */
    idNumber: string | null;
    dateOfBirth: string | null;
    issueDate: string | null;
    /** Exactly as printed, in whatever format it is printed in. */
    expiryDate: string | null;
    plate: string | null;
    vehicleMake: string | null;
    vehicleColor: string | null;
  };
  confidence: Confidence;
  /** Free text for the admin's eyes. Never acted on automatically. */
  notes: string;
}

/** Whether the documents agree with each other about who and what they describe. */
export interface CrossChecks {
  faceConsistency: Agreement;
  nameConsistency: Agreement;
  idNumberConsistency: Agreement;
  plateConsistency: Agreement;
  vehicleConsistency: Agreement;
}

/** The model's full read of one application. */
export interface DriverVerificationReport {
  documents: DocumentFinding[];
  crossChecks: CrossChecks;
  fraudSignals: FraudSignal[];
  overallConfidence: Confidence;
  summary: string;
}

/**
 * The live face scan, as it stands when the papers are judged.
 *
 * The scan itself is scored in domain/faceScan.ts well before this runs — by
 * the time an application reaches the decision below, the only questions left
 * are "did it pass" and "is the person who passed it the person on the CNIC".
 */
export interface FaceScanState {
  status: 'passed' | 'failed' | 'review' | 'missing';
  /** Whether the live face matches the photograph on the ID documents. */
  matchesDocuments: Agreement;
  /** When it passed, so a scan from last year can be asked for again. */
  passedAtMs: number | null;
}

/** What the driver typed into the form, to be checked against what they uploaded. */
export interface SubmittedDetails {
  fullName: string;
  cnic: string;
  plate: string;
  vehicleType: string;
  vehicleLabel: string;
  dob?: string | null;
  licenseExpiry?: string | null;
  cnicExpiry?: string | null;
  vehicleDocExpiry?: string | null;
  /** Documents actually attached, so a missing upload is caught before any AI call. */
  present: Partial<Record<DocumentKind, boolean>>;
}

/**
 * Somebody else on the platform already holds this identifier.
 *
 * Found by querying Firestore, not by asking a model — "has this CNIC been used
 * before" is a fact, and the single most effective fake-driver check there is.
 * One person opening six accounts, or driving on a relative's papers, both show
 * up here and nowhere else.
 */
export interface DuplicateHit {
  field: 'cnic' | 'plate' | 'licenseNumber';
  value: string;
  /** The OTHER driver already holding it. */
  driverId: string;
  status: string;
  /** That account was banned — the strongest signal in the system. */
  banned: boolean;
}

export type ExpiryState = 'valid' | 'expiring' | 'expired' | 'lifetime' | 'unknown';

export interface ExpiryVerdict {
  state: ExpiryState;
  /** Days until expiry; negative once past. Null when there is no date. */
  daysLeft: number | null;
  /** The date we settled on, ISO, after reconciling typed and printed. */
  resolved: string | null;
  /** Which of the two sources decided it. */
  source: 'document' | 'typed' | 'none';
  /** Typed and printed disagree by more than DATE_AGREEMENT_DAYS. */
  conflict: boolean;
}

/** The three papers that go stale and have to be watched for the rest of time. */
export type ExpiringDocument = 'license' | 'cnic' | 'vehicleRegistration';

export const EXPIRING_DOCUMENTS: ExpiringDocument[] = ['license', 'cnic', 'vehicleRegistration'];

/** What to call each of them when telling a driver which one lapsed. */
export const EXPIRING_DOCUMENT_LABEL: Record<ExpiringDocument, string> = {
  license: 'driving licence',
  cnic: 'CNIC',
  vehicleRegistration: 'vehicle registration',
};

export const EXPIRING_DOCUMENT_SECTION: Record<ExpiringDocument, SectionKey> = {
  license: 'license',
  cnic: 'cnic',
  vehicleRegistration: 'vehicle',
};

export type DecisionStatus = 'approved' | 'rejected' | 'review';

export interface DecisionReason {
  /** Stable key so the dashboard can group and the tests can assert on it. */
  code: string;
  /** One line for the admin reading the queue. */
  detail: string;
  severity: 'fatal' | 'major' | 'minor';
  section?: SectionKey;
}

export interface VerificationDecision {
  status: DecisionStatus;
  /** 0 (nothing wrong) to 100 (certain fraud). Only ever advisory to a human. */
  riskScore: number;
  reasons: DecisionReason[];
  /** Cards the driver has to redo. Empty on approval. */
  rejectedSections: SectionKey[];
  /** One sentence, plain, shown to the driver. Never mentions the risk score. */
  driverMessage: string;
  expiries: Record<ExpiringDocument, ExpiryVerdict>;
}

/**
 * The knobs, with the defaults this launches on.
 *
 * Mirrors the `adminConfig/*` convention used by pricing and platform costs:
 * the catalogue of what exists lives in code, the chosen numbers live in
 * Firestore, and absent means "use the number below".
 */
export interface VerificationConfig {
  /**
   * `full`    — the engine approves and rejects on its own (what this is for).
   * `suggest` — it decides and records, but every application still waits for a
   *             human. The honest setting for the first week of real traffic.
   * `off`     — no AI at all; straight to the review queue.
   */
  mode: 'full' | 'suggest' | 'off';
  /** At or below this, a clean application is approved. */
  autoApproveMaxRisk: number;
  /** At or above this, an application is rejected. */
  autoRejectMinRisk: number;
  /** How close to expiry a paper may be and still be accepted at onboarding. */
  minDaysBeforeExpiry: number;
  /** Days before expiry the daily sweep starts warning a working driver. */
  warnDaysBeforeExpiry: number[];
  /** Approve only when the model itself says it is sure. */
  requireHighConfidence: boolean;
  /** Treat a CNIC already held by another driver as fatal rather than review. */
  rejectOnDuplicateCnic: boolean;
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  mode: 'full',
  autoApproveMaxRisk: 10,
  autoRejectMinRisk: 60,
  minDaysBeforeExpiry: 7,
  warnDaysBeforeExpiry: [30, 14, 7, 3, 1],
  requireHighConfidence: true,
  rejectOnDuplicateCnic: true,
};

/**
 * A model saying "that is not the same face" is a reason to look, never a
 * reason to refuse. Lighting, age, a beard grown since the CNIC was issued and
 * a 2009 scan at 200 dpi all read as mismatch, and the cost of being wrong
 * lands entirely on the applicant. Named rather than inlined so that anyone
 * who later wants to make it fatal has to come here and read this first.
 */
export const FACE_MISMATCH_IS_REVIEW_ONLY = true;

/** Typed and printed dates further apart than this are treated as a conflict. */
export const DATE_AGREEMENT_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Read a date off a Pakistani document, or out of our own date picker.
 *
 * Day-first throughout: NADRA cards and licences print `DD-MM-YYYY`, and
 * `03/04/2026` on a card in Lahore is the third of April. Our own pickers emit
 * ISO, which is unambiguous and caught by the first branch. A four-digit year
 * anywhere in the string is what tells the two apart.
 *
 * Returns a UTC midnight timestamp, or null when the string is not a date —
 * null is "we do not know", and never means "fine".
 */
export function parseDocumentDate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/life\s*time|lifetime|permanent|never\s*expires/.test(s)) return LIFETIME;

  // ISO first: YYYY-MM-DD or YYYY/MM/DD.
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return utc(+iso[1], +iso[2], +iso[3]);

  // DD-MM-YYYY, DD/MM/YY, DD.MM.YYYY — the way cards are printed here.
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const day = +dmy[1];
    const month = +dmy[2];
    // A "day" above 12 with a month at or below it can only be day-first, which
    // is what we assume anyway; the reverse (month > 12) means it was printed
    // month-first and we swap rather than throw the date away.
    const [d, m] = month > 12 && day <= 12 ? [month, day] : [day, month];
    return utc(expandYear(+dmy[3]), m, d);
  }

  // 12 Mar 2026 / 12-MAR-2026 / Mar 12, 2026.
  const dMonY = s.match(/^(\d{1,2})[\s-]*([a-z]{3,})[\s-]*(\d{2,4})$/);
  if (dMonY && MONTHS[dMonY[2].slice(0, 3)]) {
    return utc(expandYear(+dMonY[3]), MONTHS[dMonY[2].slice(0, 3)], +dMonY[1]);
  }
  const monDY = s.match(/^([a-z]{3,})[\s-]*(\d{1,2}),?[\s-]*(\d{2,4})$/);
  if (monDY && MONTHS[monDY[1].slice(0, 3)]) {
    return utc(expandYear(+monDY[3]), MONTHS[monDY[1].slice(0, 3)], +monDY[2]);
  }

  return null;
}

/** Sentinel for cards that never expire (a lifetime CNIC is common here). */
export const LIFETIME = Number.MAX_SAFE_INTEGER;

function utc(year: number, month: number, day: number): number | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  const t = Date.UTC(year, month - 1, day);
  // Date.UTC rolls 31 February over into March — reject rather than accept a
  // date the card cannot actually be printed with.
  const back = new Date(t);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return t;
}

function expandYear(y: number): number {
  if (y >= 1000) return y;
  // A two-digit year on a document that expires is this century.
  return y >= 70 ? 1900 + y : 2000 + y;
}

/** Midnight UTC on the day `now` falls in — expiry is a day, not an instant. */
function startOfDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function toIsoDate(ts: number): string | null {
  if (ts === LIFETIME) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Reconcile what the driver typed with what their document actually says, and
 * decide whether the paper is still good.
 *
 * The printed date wins. A driver who types 2027 on a card that reads 2024 has
 * either mistyped or is hoping nobody looks, and either way the card is the
 * fact. The typed date is the fallback when the photo is unreadable — if they
 * tell us themselves that it lapsed, that is enough to act on.
 */
export function resolveExpiry(params: {
  printed: string | null | undefined;
  typed: string | null | undefined;
  now: number;
  warnWithinDays: number;
}): ExpiryVerdict {
  const { now, warnWithinDays } = params;
  const printedTs = parseDocumentDate(params.printed);
  const typedTs = parseDocumentDate(params.typed);

  const chosen = printedTs ?? typedTs;
  const source: ExpiryVerdict['source'] =
    printedTs !== null ? 'document' : typedTs !== null ? 'typed' : 'none';

  if (chosen === null) {
    return { state: 'unknown', daysLeft: null, resolved: null, source: 'none', conflict: false };
  }

  const conflict =
    printedTs !== null &&
    typedTs !== null &&
    printedTs !== LIFETIME &&
    typedTs !== LIFETIME &&
    Math.abs(printedTs - typedTs) > DATE_AGREEMENT_DAYS * DAY_MS;

  if (chosen === LIFETIME) {
    return { state: 'lifetime', daysLeft: null, resolved: null, source, conflict };
  }

  const daysLeft = Math.round((chosen - startOfDay(now)) / DAY_MS);
  const state: ExpiryState =
    daysLeft < 0 ? 'expired' : daysLeft <= warnWithinDays ? 'expiring' : 'valid';

  return { state, daysLeft, resolved: toIsoDate(chosen), source, conflict };
}

// ── Name and identifier comparison ───────────────────────────────────────────

/**
 * Transliteration variants that are the same name on two different cards. A
 * licence clerk's "Mohammad" and NADRA's "Muhammad" must not cost a driver
 * their application.
 */
const NAME_VARIANTS: Array<[RegExp, string]> = [
  [/^m(u|o)h?am+[ae]?d$/, 'muhammad'],
  [/^md$/, 'muhammad'],
  [/^ah?m[ae]d$/, 'ahmad'],
  [/^h?uss?a?in$/, 'hussain'],
  [/^al+ah?$/, 'allah'],
  [/^kh?an$/, 'khan'],
  [/^sye?d$/, 'syed'],
  [/^sh?a?ikh$/, 'shaikh'],
  [/^ab+as$/, 'abbas'],
  [/^rehm?an$/, 'rahman'],
];

/** Honorifics that appear on one card and not the other. */
const NAME_NOISE = new Set(['mr', 'mrs', 'ms', 'miss', 'malik', 'ch', 'chaudhry', 'hafiz', 'syed']);

export function normalizeNameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return String(name)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_NOISE.has(t))
    .map((t) => {
      for (const [re, canonical] of NAME_VARIANTS) if (re.test(t)) return canonical;
      return t;
    })
    .filter(Boolean);
}

/**
 * Do these two strings name the same person?
 *
 * Deliberately generous. One card carries a father's name the other does not;
 * one spells out a middle name. A shared distinctive token is treated as
 * agreement, and only a complete absence of overlap is a mismatch — the strict
 * version of this check rejected real drivers in testing for having "Khan" on
 * one card and "Khan Niazi" on the other.
 */
export function namesAgree(a: string | null | undefined, b: string | null | undefined): Agreement {
  const ta = normalizeNameTokens(a);
  const tb = normalizeNameTokens(b);
  if (!ta.length || !tb.length) return 'unclear';
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t));
  if (!shared.length) return 'mismatch';
  // "Muhammad" alone is shared by half of Pakistan — it is not evidence.
  const distinctive = shared.filter((t) => t !== 'muhammad' && t !== 'khan');
  if (distinctive.length) return 'match';
  return shared.length >= 2 ? 'match' : 'unclear';
}

/** Digits only — a CNIC is the same number with or without its hyphens. */
export function normalizeCnic(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Plates get written `ABC-123`, `ABC 123`, `abc123`; all are one plate. */
export function normalizePlate(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** What each thing that can be wrong adds to the risk score. */
const WEIGHTS = {
  tamperingClear: 70,
  tamperingSuspected: 25,
  specimen: 75,
  wrongType: 55,
  illegible: 18,
  missingDocument: 40,
  faceMismatch: 45,
  faceUnclear: 12,
  faceScanMissing: 50,
  faceScanFailed: 70,
  faceScanReview: 25,
  faceScanStale: 20,
  nameMismatch: 40,
  nameUnclear: 10,
  idMismatch: 50,
  plateMismatch: 30,
  vehicleMismatch: 20,
  duplicateCnicBanned: 100,
  duplicateCnicActive: 80,
  duplicatePlate: 25,
  duplicateLicense: 60,
  expired: 45,
  expiringTooSoon: 15,
  dateConflict: 20,
  lowConfidence: 15,
  mediumConfidence: 5,
  typedNameMismatch: 25,
  typedCnicMismatch: 35,
  typedPlateMismatch: 20,
  ageImplausible: 30,
  stockImage: 60,
  photocopy: 20,
  screenRecapture: 40,
} as const;

/** The youngest a driver may be. LTO Pakistan issues an LTV licence at 18. */
export const MIN_DRIVER_AGE = 18;
export const MAX_DRIVER_AGE = 75;

/**
 * The whole judgement, in one pure function.
 *
 * Takes the model's read, the form, the duplicates found in Firestore and the
 * clock; returns what to do. Every branch that can end an application appends a
 * reason with a stable `code`, because "rejected" with no reason is not a
 * decision a driver can act on and not one an admin can audit.
 */
export function decideDriverVerification(params: {
  report: DriverVerificationReport | null;
  submitted: SubmittedDetails;
  duplicates: DuplicateHit[];
  /** Absent is treated as 'missing' — never as "fine". */
  faceScan?: FaceScanState;
  now: number;
  config?: Partial<VerificationConfig>;
}): VerificationDecision {
  const config: VerificationConfig = { ...DEFAULT_VERIFICATION_CONFIG, ...params.config };
  const { submitted, duplicates, now } = params;
  const faceScan: FaceScanState = params.faceScan ?? {
    status: 'missing',
    matchesDocuments: 'unclear',
    passedAtMs: null,
  };
  const reasons: DecisionReason[] = [];
  const sections = new Set<SectionKey>();
  let risk = 0;

  const add = (
    code: string,
    detail: string,
    severity: DecisionReason['severity'],
    weight: number,
    section?: SectionKey,
  ): void => {
    // `section` is OMITTED rather than set to undefined when there isn't one.
    // The whole decision is written to Firestore, and the Admin SDK throws on
    // an undefined value unless ignoreUndefinedProperties is set, which this
    // backend deliberately does not set. A reason with no section is ordinary
    // — "the names could not be compared", "the model was only moderately
    // confident" — so this would have thrown on most applications.
    reasons.push(section ? { code, detail, severity, section } : { code, detail, severity });
    risk += weight;
    if (section && severity !== 'minor') sections.add(section);
  };

  // ── 1. Is anything simply not there? Checked before the model is consulted,
  //       so a half-filled application never costs an API call.
  for (const kind of REQUIRED_DOCUMENTS) {
    if (!submitted.present[kind]) {
      add(
        'document_missing',
        `No ${labelOf(kind)} was uploaded.`,
        'fatal',
        WEIGHTS.missingDocument,
        SECTION_OF[kind],
      );
    }
  }

  // ── 1b. The live face scan. This runs before the papers are weighed because
  //        it answers the prior question: is there a real person here at all,
  //        and are they the person these documents were issued to? Papers can be
  //        borrowed; a head that turns on command when asked, seconds ago, in a
  //        sequence the server chose, cannot be.
  if (faceScan.status === 'missing') {
    add(
      'face_scan_missing',
      'The driver has not completed a live face scan.',
      'fatal',
      WEIGHTS.faceScanMissing,
      'basic',
    );
  } else if (faceScan.status === 'failed') {
    add(
      'face_scan_failed',
      'The live face scan did not pass — the poses asked for were not performed by a live person.',
      'fatal',
      WEIGHTS.faceScanFailed,
      'basic',
    );
  } else if (faceScan.status === 'review') {
    add(
      'face_scan_unverified',
      'The live face scan could not be scored automatically.',
      'major',
      WEIGHTS.faceScanReview,
      'basic',
    );
  } else if (!faceScanIsFresh(faceScan.passedAtMs, now)) {
    // Passed, but long enough ago that it is no longer evidence about today.
    add(
      'face_scan_stale',
      `The face scan is older than ${FACE_SCAN_VALID_DAYS} days and has to be done again.`,
      'major',
      WEIGHTS.faceScanStale,
      'basic',
    );
  }

  // Does the live face belong to the ID? A mismatch here is the same judgement
  // as crossChecks.faceConsistency and is held to the same rule: a flag for a
  // human, never a refusal on its own. See FACE_MISMATCH_IS_REVIEW_ONLY.
  if (faceScan.status === 'passed' && faceScan.matchesDocuments === 'mismatch') {
    add(
      'face_scan_not_document_holder',
      'The person who did the face scan may not be the person on the ID documents.',
      'major',
      WEIGHTS.faceMismatch,
      'basic',
    );
  }

  const byKind = new Map<DocumentKind, DocumentFinding>();
  for (const doc of params.report?.documents ?? []) byKind.set(doc.kind, doc);

  // ── 2. Expiry. The one check that matters for the rest of the driver's life,
  //       not only today — the daily sweep in drivers/documentExpiry.ts runs the
  //       same resolveExpiry() against the same stored dates.
  const expiries: Record<ExpiringDocument, ExpiryVerdict> = {
    license: resolveExpiry({
      printed: byKind.get('license')?.fields.expiryDate,
      typed: submitted.licenseExpiry,
      now,
      warnWithinDays: config.minDaysBeforeExpiry,
    }),
    cnic: resolveExpiry({
      printed: byKind.get('cnicFront')?.fields.expiryDate ?? byKind.get('cnicBack')?.fields.expiryDate,
      typed: submitted.cnicExpiry,
      now,
      warnWithinDays: config.minDaysBeforeExpiry,
    }),
    vehicleRegistration: resolveExpiry({
      printed: byKind.get('vehicleRegistration')?.fields.expiryDate,
      typed: submitted.vehicleDocExpiry,
      now,
      warnWithinDays: config.minDaysBeforeExpiry,
    }),
  };

  for (const key of EXPIRING_DOCUMENTS) {
    const verdict = expiries[key];
    const label = EXPIRING_DOCUMENT_LABEL[key];
    const section = EXPIRING_DOCUMENT_SECTION[key];
    if (verdict.state === 'expired') {
      add(
        'document_expired',
        `The ${label} expired on ${verdict.resolved} (${Math.abs(verdict.daysLeft ?? 0)} days ago).`,
        'fatal',
        WEIGHTS.expired,
        section,
      );
    } else if (verdict.state === 'expiring') {
      add(
        'document_expiring',
        `The ${label} expires in ${verdict.daysLeft} days — too soon to start on.`,
        'major',
        WEIGHTS.expiringTooSoon,
        section,
      );
    }
    if (verdict.conflict) {
      add(
        'expiry_conflict',
        `The ${label} expiry typed on the form does not match the date printed on the document.`,
        'major',
        WEIGHTS.dateConflict,
        section,
      );
    }
    // A registration with no readable expiry is normal in Pakistan (many are
    // open-ended), so only the licence is held to having one.
    if (verdict.state === 'unknown' && key === 'license') {
      add(
        'expiry_unknown',
        'The licence expiry date could not be read and was not provided.',
        'major',
        WEIGHTS.illegible,
        section,
      );
    }
  }

  // ── 3. Identity reuse. Facts from our own database, and the single most
  //       effective fake-driver check we have.
  for (const hit of duplicates) {
    if (hit.field === 'cnic') {
      if (hit.banned) {
        add(
          'duplicate_cnic_banned',
          `This CNIC belongs to a banned account (${hit.driverId}).`,
          'fatal',
          WEIGHTS.duplicateCnicBanned,
          'cnic',
        );
      } else {
        add(
          'duplicate_cnic',
          `This CNIC is already registered to driver ${hit.driverId} (${hit.status}).`,
          config.rejectOnDuplicateCnic ? 'fatal' : 'major',
          WEIGHTS.duplicateCnicActive,
          'cnic',
        );
      }
    } else if (hit.field === 'licenseNumber') {
      add(
        'duplicate_license',
        `This licence number is already on driver ${hit.driverId} (${hit.status}).`,
        'fatal',
        WEIGHTS.duplicateLicense,
        'license',
      );
    } else {
      // Two drivers on one car is normal — a shared family car, a fleet. Worth
      // a human's eye, never an automatic refusal.
      add(
        'duplicate_plate',
        `This plate is already registered to driver ${hit.driverId} (${hit.status}).`,
        'major',
        WEIGHTS.duplicatePlate,
        'vehicle',
      );
    }
  }

  // Without a model read there is nothing left to judge: the application goes to
  // a human with whatever the deterministic checks above found.
  if (!params.report) {
    const fatal = reasons.some((r) => r.severity === 'fatal');
    const status: DecisionStatus = fatal && config.mode === 'full' ? 'rejected' : 'review';
    return {
      status,
      riskScore: clamp(risk),
      reasons,
      // Only a rejection names sections to redo. A driver merely waiting on a
      // human must not see red crosses against their documents — the checklist
      // draws those from this list, and nothing has been refused yet.
      rejectedSections: status === 'rejected' ? [...sections] : [],
      driverMessage: fatal
        ? firstDriverMessage(reasons)
        : 'Your documents are with our team for review. We will let you know shortly.',
      expiries,
    };
  }

  const report = params.report;

  // ── 4. Each picture on its own: is it the right kind of document, readable,
  //       and not interfered with?
  for (const doc of report.documents) {
    const section = SECTION_OF[doc.kind];
    const label = labelOf(doc.kind);

    if (doc.specimen) {
      add('specimen_document', `The ${label} is a specimen or sample card, not a real one.`, 'fatal', WEIGHTS.specimen, section);
    }
    if (doc.tampering === 'clear') {
      add('document_tampered', `The ${label} shows clear signs of editing.`, 'fatal', WEIGHTS.tamperingClear, section);
    } else if (doc.tampering === 'suspected') {
      add('document_tampering_suspected', `The ${label} may have been edited — ${doc.notes || 'needs a closer look'}.`, 'major', WEIGHTS.tamperingSuspected, section);
    }
    if (!EXPECTED_LOOK[doc.kind].includes(doc.looksLike)) {
      if (doc.looksLike === 'unreadable') {
        add('document_illegible', `The ${label} is too unclear to read.`, 'major', WEIGHTS.illegible, section);
      } else {
        add(
          'wrong_document_type',
          `The ${label} slot contains a ${humanLook(doc.looksLike)} instead.`,
          'fatal',
          WEIGHTS.wrongType,
          section,
        );
      }
    } else if (!doc.legible) {
      add('document_illegible', `The ${label} is too unclear to read.`, 'major', WEIGHTS.illegible, section);
    }
  }

  // ── 5. Do the documents agree with each other about who this is?
  const x = report.crossChecks;
  if (x.nameConsistency === 'mismatch') {
    add('name_mismatch', 'The name on the CNIC and the name on the licence are different people.', 'fatal', WEIGHTS.nameMismatch, 'cnic');
  } else if (x.nameConsistency === 'unclear') {
    add('name_unclear', 'The names across the documents could not be compared.', 'minor', WEIGHTS.nameUnclear);
  }
  if (x.idNumberConsistency === 'mismatch') {
    add('id_number_mismatch', 'The CNIC number on the card and on the licence do not match.', 'fatal', WEIGHTS.idMismatch, 'cnic');
  }
  if (x.faceConsistency === 'mismatch') {
    // Deliberately 'major', never 'fatal'. See FACE_MISMATCH_IS_REVIEW_ONLY.
    add('face_mismatch', 'The person in the selfie may not be the person on the ID documents.', 'major', WEIGHTS.faceMismatch, 'basic');
  } else if (x.faceConsistency === 'unclear') {
    add('face_unclear', 'The selfie could not be compared with the ID photographs.', 'minor', WEIGHTS.faceUnclear);
  }
  if (x.plateConsistency === 'mismatch') {
    add('plate_mismatch', 'The plate on the registration is not the plate on the car.', 'major', WEIGHTS.plateMismatch, 'vehicle');
  }
  if (x.vehicleConsistency === 'mismatch') {
    add('vehicle_mismatch', 'The car photographed is not the car the registration describes.', 'major', WEIGHTS.vehicleMismatch, 'vehicle');
  }

  // ── 6. Do the documents agree with what the driver typed? A form that does
  //       not match the papers behind it is either a typo or a substitution.
  const cnicDoc = byKind.get('cnicFront') ?? byKind.get('cnicBack');
  const licenseDoc = byKind.get('license');

  const documentName = cnicDoc?.fields.name ?? licenseDoc?.fields.name ?? null;
  if (namesAgree(submitted.fullName, documentName) === 'mismatch') {
    add(
      'typed_name_mismatch',
      `The form says "${submitted.fullName}" but the documents say "${documentName}".`,
      'major',
      WEIGHTS.typedNameMismatch,
      'basic',
    );
  }

  const typedCnic = normalizeCnic(submitted.cnic);
  const readCnic = normalizeCnic(cnicDoc?.fields.idNumber);
  if (typedCnic && readCnic.length === 13 && typedCnic !== readCnic) {
    add(
      'typed_cnic_mismatch',
      `The CNIC typed on the form is not the number printed on the card.`,
      'fatal',
      WEIGHTS.typedCnicMismatch,
      'cnic',
    );
  }

  const typedPlate = normalizePlate(submitted.plate);
  const readPlate = normalizePlate(
    byKind.get('vehicleRegistration')?.fields.plate ?? byKind.get('vehiclePhoto')?.fields.plate,
  );
  if (typedPlate && readPlate && typedPlate !== readPlate) {
    add(
      'typed_plate_mismatch',
      `The plate typed on the form (${submitted.plate}) is not the plate on the papers (${readPlate}).`,
      'major',
      WEIGHTS.typedPlateMismatch,
      'vehicle',
    );
  }

  // ── 7. Age. A 14-year-old with a borrowed licence is a specific, real fraud.
  const dobTs = parseDocumentDate(cnicDoc?.fields.dateOfBirth ?? submitted.dob);
  if (dobTs !== null && dobTs !== LIFETIME) {
    const age = Math.floor((now - dobTs) / (365.2425 * DAY_MS));
    if (age < MIN_DRIVER_AGE || age > MAX_DRIVER_AGE) {
      add(
        'age_implausible',
        `The date of birth on the CNIC makes the applicant ${age} years old.`,
        age < MIN_DRIVER_AGE ? 'fatal' : 'major',
        WEIGHTS.ageImplausible,
        'cnic',
      );
    }
  }

  // ── 8. The model's own fraud flags, for the ones not already covered above.
  for (const signal of report.fraudSignals) {
    switch (signal) {
      case 'stock_or_internet_image':
        add('stock_image', 'A submitted photograph appears to be taken from the internet.', 'fatal', WEIGHTS.stockImage, 'basic');
        break;
      case 'screen_recapture':
        add('screen_recapture', 'A document was photographed off a screen rather than the original.', 'major', WEIGHTS.screenRecapture);
        break;
      case 'photocopy_presented_as_original':
        add('photocopy', 'A document is a photocopy rather than the original.', 'minor', WEIGHTS.photocopy);
        break;
      case 'digital_edit':
        // The per-document tampering verdict above already carries the weight;
        // this only ensures a flag raised without a per-document finding counts.
        if (!reasons.some((r) => r.code === 'document_tampered')) {
          add('digital_edit', 'Signs of digital editing were found on a document.', 'major', WEIGHTS.tamperingSuspected);
        }
        break;
      case 'cross_document_conflict':
        if (!reasons.some((r) => r.code.endsWith('_mismatch'))) {
          add('cross_document_conflict', 'The documents disagree with one another.', 'major', WEIGHTS.nameMismatch);
        }
        break;
      default:
        break; // Already handled by a structured check above.
    }
  }

  // ── 9. How sure is the model about any of this?
  if (report.overallConfidence === 'low') {
    add('low_confidence', 'The automatic check was not confident in its reading.', 'minor', WEIGHTS.lowConfidence);
  } else if (report.overallConfidence === 'medium') {
    add('medium_confidence', 'The automatic check was only moderately confident.', 'minor', WEIGHTS.mediumConfidence);
  }

  // ── 10. Add it up.
  const riskScore = clamp(risk);
  const hasFatal = reasons.some((r) => r.severity === 'fatal');
  const hasMajor = reasons.some((r) => r.severity === 'major');

  let status: DecisionStatus;
  if (config.mode !== 'full') {
    status = 'review';
  } else if (hasFatal || riskScore >= config.autoRejectMinRisk) {
    status = 'rejected';
  } else if (
    !hasMajor &&
    riskScore <= config.autoApproveMaxRisk &&
    (!config.requireHighConfidence || report.overallConfidence === 'high')
  ) {
    status = 'approved';
  } else {
    status = 'review';
  }

  return {
    status,
    riskScore,
    reasons,
    rejectedSections: status === 'rejected' ? [...sections] : [],
    driverMessage:
      status === 'approved'
        ? 'Your documents were verified. You can start driving.'
        : status === 'rejected'
          ? firstDriverMessage(reasons)
          : 'Your documents are with our team for review. We will let you know shortly.',
    expiries,
  };
}

/**
 * What the driver is told. The most serious reason, phrased so they know what
 * to change — never the risk score, never "our model thinks", and never a
 * list so long they stop reading at the part that matters.
 */
function firstDriverMessage(reasons: DecisionReason[]): string {
  const fatal = reasons.find((r) => r.severity === 'fatal') ?? reasons[0];
  if (!fatal) return 'We could not verify your documents. Please submit them again.';
  return `${fatal.detail} Please fix this and submit again.`;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function labelOf(kind: DocumentKind): string {
  switch (kind) {
    case 'selfie': return 'profile photo';
    case 'license': return 'driving licence';
    case 'cnicFront': return 'CNIC (front)';
    case 'cnicBack': return 'CNIC (back)';
    case 'vehicleRegistration': return 'vehicle registration';
    case 'vehiclePhoto': return 'photo of the car';
  }
}

function humanLook(look: LooksLike): string {
  switch (look) {
    case 'driving_license': return 'driving licence';
    case 'cnic_front': return 'CNIC front';
    case 'cnic_back': return 'CNIC back';
    case 'vehicle_registration': return 'vehicle registration';
    case 'person_photo': return 'photo of a person';
    case 'vehicle_photo': return 'photo of a vehicle';
    case 'other_document': return 'unrelated document';
    case 'unreadable': return 'unreadable image';
  }
}
