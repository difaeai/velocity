/**
 * The judgement half of the driver verification engine.
 *
 * These are the tests that matter most in this feature, because this is the
 * code that can quietly end somebody's livelihood by misreading a date or
 * being too sure about a face. Everything here is pure — no emulator, no API
 * key, no network — so the full decision table runs in milliseconds and can be
 * run by anyone, which is the point: a rule nobody can check is a rule nobody
 * will notice changing.
 *
 * Two properties are load-bearing and have their own tests below:
 *   · a face mismatch NEVER rejects on its own (it goes to a human);
 *   · no model verdict NEVER approves (it goes to a human too).
 */
import { describe, expect, it } from 'vitest';

import {
  DATE_AGREEMENT_DAYS,
  LIFETIME,
  decideDriverVerification,
  namesAgree,
  normalizeCnic,
  normalizePlate,
  parseDocumentDate,
  resolveExpiry,
  type DocumentFinding,
  type DocumentKind,
  type DriverVerificationReport,
  type FaceScanState,
  type SubmittedDetails,
} from '../../domain/driverVerification';
import {
  FACE_CHALLENGES,
  pickChallenges,
  scoreFaceScan,
  type FaceScanReport,
} from '../../domain/faceScan';

const NOW = Date.UTC(2026, 9, 15); // 15 October 2026
const DAY = 24 * 60 * 60 * 1000;

// ── Date parsing ─────────────────────────────────────────────────────────────

describe('parseDocumentDate', () => {
  it('reads ISO dates from our own pickers', () => {
    expect(parseDocumentDate('2027-03-09')).toBe(Date.UTC(2027, 2, 9));
    expect(parseDocumentDate('2027/03/09')).toBe(Date.UTC(2027, 2, 9));
  });

  it('reads Pakistani cards day-first', () => {
    // The whole point: 03/04/2027 on a card in Lahore is 3 April, not 4 March.
    expect(parseDocumentDate('03/04/2027')).toBe(Date.UTC(2027, 3, 3));
    expect(parseDocumentDate('12-03-2027')).toBe(Date.UTC(2027, 2, 12));
    expect(parseDocumentDate('09.11.2027')).toBe(Date.UTC(2027, 10, 9));
  });

  it('swaps when the second number cannot be a month', () => {
    // Printed month-first by a clerk who knew better. Day-first is the house
    // rule, but "month 25" is impossible, so the two are read the other way
    // round rather than thrown away.
    expect(parseDocumentDate('12/25/2027')).toBe(Date.UTC(2027, 11, 25));
    expect(parseDocumentDate('11/23/2027')).toBe(Date.UTC(2027, 10, 23));
  });

  it('still reads day-first when both numbers could be either', () => {
    // The ambiguous case stays day-first, because that is how the cards here
    // are printed — getting this backwards would quietly expire or un-expire
    // every licence issued in the first twelve days of a month.
    expect(parseDocumentDate('05/06/2027')).toBe(Date.UTC(2027, 5, 5));
  });

  it('reads month names in either order', () => {
    expect(parseDocumentDate('12 Mar 2027')).toBe(Date.UTC(2027, 2, 12));
    expect(parseDocumentDate('12-MAR-2027')).toBe(Date.UTC(2027, 2, 12));
    expect(parseDocumentDate('Mar 12, 2027')).toBe(Date.UTC(2027, 2, 12));
  });

  it('expands two-digit years into this century', () => {
    expect(parseDocumentDate('12-03-27')).toBe(Date.UTC(2027, 2, 12));
  });

  it('treats lifetime cards as never expiring', () => {
    expect(parseDocumentDate('Lifetime')).toBe(LIFETIME);
    expect(parseDocumentDate('LIFE TIME')).toBe(LIFETIME);
    expect(parseDocumentDate('Permanent')).toBe(LIFETIME);
  });

  it('refuses dates that cannot be printed on a card', () => {
    // Date.UTC would happily roll 31 February into March; a card cannot.
    expect(parseDocumentDate('31-02-2027')).toBe(null);
    expect(parseDocumentDate('00-01-2027')).toBe(null);
    expect(parseDocumentDate('not a date')).toBe(null);
    expect(parseDocumentDate('')).toBe(null);
    expect(parseDocumentDate(null)).toBe(null);
  });
});

describe('resolveExpiry', () => {
  const base = { now: NOW, warnWithinDays: 7 };

  it('calls a past date expired, with the days counted', () => {
    const v = resolveExpiry({ ...base, printed: '2026-09-15', typed: null });
    expect(v.state).toBe('expired');
    expect(v.daysLeft).toBe(-30);
  });

  it('calls a date inside the warning window expiring', () => {
    const v = resolveExpiry({ ...base, printed: '2026-10-19', typed: null });
    expect(v.state).toBe('expiring');
    expect(v.daysLeft).toBe(4);
  });

  it('prefers what is printed on the card over what was typed', () => {
    // The driver typed a date four years out; the card says it lapsed. The card
    // is the fact, and this is the single most important line in the file.
    const v = resolveExpiry({ ...base, printed: '15-09-2026', typed: '2030-01-01' });
    expect(v.state).toBe('expired');
    expect(v.source).toBe('document');
    expect(v.conflict).toBe(true);
  });

  it('falls back to the typed date when the card is unreadable', () => {
    const v = resolveExpiry({ ...base, printed: null, typed: '2026-01-01' });
    expect(v.state).toBe('expired');
    expect(v.source).toBe('typed');
  });

  it('does not call a small disagreement a conflict', () => {
    const typed = new Date(NOW + 400 * DAY).toISOString().slice(0, 10);
    const printed = new Date(NOW + (400 + DATE_AGREEMENT_DAYS - 1) * DAY).toISOString().slice(0, 10);
    expect(resolveExpiry({ ...base, printed, typed }).conflict).toBe(false);
  });

  it('knows the difference between lifetime and unknown', () => {
    expect(resolveExpiry({ ...base, printed: 'Lifetime', typed: null }).state).toBe('lifetime');
    expect(resolveExpiry({ ...base, printed: null, typed: null }).state).toBe('unknown');
  });
});

// ── Name and identifier comparison ───────────────────────────────────────────

describe('namesAgree', () => {
  it('accepts transliteration variants of the same name', () => {
    expect(namesAgree('Muhammad Imran Khan', 'Mohammad Imran Khan')).toBe('match');
    expect(namesAgree('Md Imran', 'Muhammad Imran')).toBe('match');
    expect(namesAgree('Ahmed Raza', 'Ahmad Raza')).toBe('match');
  });

  it('accepts one card carrying more of the name than the other', () => {
    expect(namesAgree('Imran Khan Niazi', 'Imran Khan')).toBe('match');
  });

  it('does not treat a shared Muhammad or Khan as evidence', () => {
    // Half of Pakistan shares both. Matching on them alone would wave through
    // a borrowed CNIC, which is the exact fraud this check exists for.
    expect(namesAgree('Muhammad Asif', 'Muhammad Bilal')).toBe('unclear');
    expect(namesAgree('Imran Khan', 'Bilal Khan')).toBe('unclear');
  });

  it('calls genuinely different people a mismatch', () => {
    expect(namesAgree('Imran Shah', 'Bilal Mehmood')).toBe('mismatch');
  });

  it('is unclear rather than wrong when a name is missing', () => {
    expect(namesAgree('Imran Khan', null)).toBe('unclear');
    expect(namesAgree('', 'Imran Khan')).toBe('unclear');
  });
});

describe('identifier normalisation', () => {
  it('reads one CNIC through any spelling', () => {
    expect(normalizeCnic('35202-1234567-1')).toBe('3520212345671');
    expect(normalizeCnic('3520212345671')).toBe('3520212345671');
  });

  it('reads one plate through any spelling', () => {
    expect(normalizePlate('LEA-1234')).toBe('LEA1234');
    expect(normalizePlate('lea 1234')).toBe('LEA1234');
  });
});

// ── Building a clean application to vary one thing at a time ─────────────────

function finding(kind: DocumentKind, over: Partial<DocumentFinding> = {}): DocumentFinding {
  const looks = {
    selfie: 'person_photo',
    license: 'driving_license',
    cnicFront: 'cnic_front',
    cnicBack: 'cnic_back',
    vehicleRegistration: 'vehicle_registration',
    vehiclePhoto: 'vehicle_photo',
  } as const;
  return {
    kind,
    looksLike: looks[kind],
    legible: true,
    tampering: 'none',
    specimen: false,
    fields: {
      name: 'Muhammad Imran Khan',
      fatherName: 'Abdul Rashid',
      idNumber: kind === 'cnicFront' ? '35202-1234567-1' : null,
      dateOfBirth: kind === 'cnicFront' ? '12-03-1990' : null,
      issueDate: null,
      expiryDate:
        kind === 'license' ? '2028-06-30' : kind === 'cnicFront' ? '2030-01-01' : null,
      plate: kind === 'vehicleRegistration' || kind === 'vehiclePhoto' ? 'LEA-1234' : null,
      vehicleMake: kind === 'vehicleRegistration' ? 'Toyota Corolla' : null,
      vehicleColor: kind === 'vehicleRegistration' ? 'White' : null,
    },
    confidence: 'high',
    notes: '',
    ...over,
  };
}

function cleanReport(over: Partial<DriverVerificationReport> = {}): DriverVerificationReport {
  return {
    documents: [
      finding('selfie'), finding('license'), finding('cnicFront'),
      finding('cnicBack'), finding('vehicleRegistration'), finding('vehiclePhoto'),
    ],
    crossChecks: {
      faceConsistency: 'match',
      // Per card, and both of them: this is what the identity gate reads, and a
      // clean application is one where the applicant is on BOTH documents.
      selfieVsCnic: 'match',
      selfieVsLicense: 'match',
      nameConsistency: 'match',
      idNumberConsistency: 'match',
      plateConsistency: 'match',
      vehicleConsistency: 'match',
    },
    fraudSignals: [],
    overallConfidence: 'high',
    summary: 'Everything checks out.',
    ...over,
  };
}

function cleanSubmission(over: Partial<SubmittedDetails> = {}): SubmittedDetails {
  return {
    fullName: 'Muhammad Imran Khan',
    cnic: '35202-1234567-1',
    plate: 'LEA-1234',
    vehicleType: 'mini',
    vehicleLabel: 'White Toyota Corolla',
    dob: '1990-03-12',
    licenseExpiry: '2028-06-30',
    cnicExpiry: '2030-01-01',
    vehicleDocExpiry: null,
    present: {
      selfie: true, license: true, cnicFront: true,
      cnicBack: true, vehicleRegistration: true, vehiclePhoto: true,
    },
    ...over,
  };
}

const PASSED_SCAN: FaceScanState = {
  status: 'passed',
  matchesDocuments: 'match',
  // The live face against each identity document on its own. Both, because
  // that is what IDENTITY_MUST_BE_PROVEN asks for.
  matchesCnic: 'match',
  matchesLicense: 'match',
  passedAtMs: NOW - DAY,
  afterDocuments: true,
};

function decide(over: {
  report?: DriverVerificationReport | null;
  submitted?: Partial<SubmittedDetails>;
  duplicates?: Parameters<typeof decideDriverVerification>[0]['duplicates'];
  faceScan?: FaceScanState;
  config?: Parameters<typeof decideDriverVerification>[0]['config'];
} = {}) {
  return decideDriverVerification({
    report: over.report === undefined ? cleanReport() : over.report,
    submitted: cleanSubmission(over.submitted),
    duplicates: over.duplicates ?? [],
    faceScan: over.faceScan ?? PASSED_SCAN,
    now: NOW,
    config: over.config,
  });
}

// ── The decision ─────────────────────────────────────────────────────────────

describe('decideDriverVerification — approving', () => {
  it('approves a clean application outright', () => {
    const d = decide();
    expect(d.status).toBe('approved');
    expect(d.riskScore).toBe(0);
    expect(d.rejectedSections).toEqual([]);
    expect(d.reasons).toEqual([]);
  });

  it('never approves without a model verdict, even with nothing else wrong', () => {
    // No API key, or the call failed. "We could not check" must not read as
    // "we checked and it was fine".
    const d = decide({ report: null });
    expect(d.status).toBe('review');
  });

  it('does not approve on a hedged reading', () => {
    expect(decide({ report: cleanReport({ overallConfidence: 'medium' }) }).status).toBe('review');
    expect(decide({ report: cleanReport({ overallConfidence: 'low' }) }).status).toBe('review');
  });

  it('can be told to accept a hedged reading', () => {
    const d = decide({
      report: cleanReport({ overallConfidence: 'medium' }),
      config: { requireHighConfidence: false },
    });
    expect(d.status).toBe('approved');
  });

  it('decides nothing at all in suggest mode', () => {
    expect(decide({ config: { mode: 'suggest' } }).status).toBe('review');
    // Even a plainly fraudulent one still waits for a human.
    expect(
      decide({
        report: cleanReport({ documents: [finding('license', { specimen: true })] }),
        config: { mode: 'suggest' },
      }).status,
    ).toBe('review');
  });
});

describe('decideDriverVerification — rejecting', () => {
  it('rejects an expired licence and names it', () => {
    const d = decide({
      report: cleanReport({
        documents: [finding('license', { fields: { ...finding('license').fields, expiryDate: '30-06-2026' } })],
      }),
      submitted: { licenseExpiry: '2026-06-30' },
    });
    expect(d.status).toBe('rejected');
    expect(d.reasons.map((r) => r.code)).toContain('document_expired');
    expect(d.rejectedSections).toContain('license');
    expect(d.driverMessage).toMatch(/expired/i);
  });

  it('rejects the wrong kind of document in a slot', () => {
    const d = decide({
      report: cleanReport({
        documents: [finding('license', { looksLike: 'cnic_front' })],
      }),
    });
    expect(d.status).toBe('rejected');
    expect(d.reasons.map((r) => r.code)).toContain('wrong_document_type');
  });

  it('rejects a specimen card', () => {
    const d = decide({
      report: cleanReport({ documents: [finding('cnicFront', { specimen: true })] }),
    });
    expect(d.status).toBe('rejected');
    expect(d.reasons.map((r) => r.code)).toContain('specimen_document');
  });

  it('rejects a clearly edited document', () => {
    const d = decide({
      report: cleanReport({ documents: [finding('license', { tampering: 'clear' })] }),
    });
    expect(d.status).toBe('rejected');
  });

  it('rejects a CNIC already held by another driver', () => {
    const d = decide({
      duplicates: [
        { field: 'cnic', value: '35202-1234567-1', driverId: 'other', status: 'approved', banned: false },
      ],
    });
    expect(d.status).toBe('rejected');
    expect(d.reasons.map((r) => r.code)).toContain('duplicate_cnic');
  });

  it('rejects hardest when the CNIC belongs to a banned account', () => {
    const d = decide({
      duplicates: [
        { field: 'cnic', value: '35202-1234567-1', driverId: 'banned-one', status: 'suspended', banned: true },
      ],
    });
    expect(d.status).toBe('rejected');
    expect(d.riskScore).toBe(100);
  });

  it('rejects when the typed CNIC is not the number on the card', () => {
    const d = decide({ submitted: { cnic: '35202-7654321-9' } });
    expect(d.status).toBe('rejected');
    expect(d.reasons.map((r) => r.code)).toContain('typed_cnic_mismatch');
  });

  it('rejects when the two government documents name different people', () => {
    const d = decide({ report: cleanReport({ crossChecks: { ...cleanReport().crossChecks, nameConsistency: 'mismatch' } }) });
    expect(d.status).toBe('rejected');
  });

  it('rejects an applicant too young to hold a licence', () => {
    const d = decide({
      report: cleanReport({
        documents: [finding('cnicFront', {
          fields: { ...finding('cnicFront').fields, dateOfBirth: '12-03-2012' },
        })],
      }),
    });
    expect(d.status).toBe('rejected');
    expect(d.reasons.map((r) => r.code)).toContain('age_implausible');
  });

  it('rejects before spending anything when a document is simply missing', () => {
    const d = decide({
      report: null,
      submitted: { present: { selfie: true, license: true, cnicFront: true, cnicBack: true, vehicleRegistration: true } },
    });
    expect(d.status).toBe('rejected');
    expect(d.reasons.map((r) => r.code)).toContain('document_missing');
  });
});

describe('decideDriverVerification — what must NOT reject on its own', () => {
  // The load-bearing safety property. A vision model calling two photographs
  // of one person a mismatch is routine — old CNIC scans, a beard grown since,
  // a laminate — and the cost of being wrong lands entirely on the applicant.
  it('sends a face mismatch to a human instead of refusing', () => {
    const d = decide({
      report: cleanReport({ crossChecks: { ...cleanReport().crossChecks, faceConsistency: 'mismatch' } }),
    });
    expect(d.status).toBe('review');
    expect(d.reasons.map((r) => r.code)).toContain('face_mismatch');
    expect(d.rejectedSections).toEqual([]);
  });

  it('sends a live-face-versus-ID mismatch to a human too', () => {
    const d = decide({ faceScan: { ...PASSED_SCAN, matchesDocuments: 'mismatch' } });
    expect(d.status).toBe('review');
  });

  it('sends a shared plate to a human — families and fleets share cars', () => {
    const d = decide({
      duplicates: [
        { field: 'plate', value: 'LEA-1234', driverId: 'brother', status: 'approved', banned: false },
      ],
    });
    expect(d.status).toBe('review');
  });

  it('sends a blurred document to a human rather than refusing it', () => {
    const d = decide({ report: cleanReport({ documents: [finding('cnicBack', { legible: false })] }) });
    expect(d.status).toBe('review');
  });
});

describe('decideDriverVerification — the decision is writable to Firestore', () => {
  // The whole decision is stored on drivers/{uid}.verification, and the Admin
  // SDK throws on an undefined value because this backend does not set
  // ignoreUndefinedProperties. An `undefined` anywhere in here would crash the
  // verification job rather than failing a check, so every application would
  // land in the review queue by accident and nobody would know why.
  function assertNoUndefined(value: unknown, path = 'decision'): void {
    expect(value, `${path} is undefined`).not.toBeUndefined();
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
    }
  }

  it('carries no undefined through a reason without a section', () => {
    // 'medium_confidence' and 'name_unclear' both attach to no section, and
    // between them they appear on a large share of real applications.
    const d = decide({
      report: cleanReport({
        overallConfidence: 'medium',
        crossChecks: { ...cleanReport().crossChecks, nameConsistency: 'unclear' },
      }),
    });
    expect(d.reasons.some((r) => !('section' in r))).toBe(true);
    assertNoUndefined(d);
  });

  it('carries no undefined on an approval, a rejection or a review', () => {
    assertNoUndefined(decide());
    assertNoUndefined(decide({ faceScan: { status: 'missing', matchesDocuments: 'unclear', passedAtMs: null } }));
    assertNoUndefined(decide({ report: null }));
  });
});

describe('decideDriverVerification — the face scan gate, once required', () => {
  const required = { requireFaceScan: true };

  it('refuses an application with no face scan at all', () => {
    const d = decide({
      faceScan: { status: 'missing', matchesDocuments: 'unclear', passedAtMs: null },
      config: required,
    });
    expect(d.status).toBe('rejected');
    expect(d.reasons.map((r) => r.code)).toContain('face_scan_missing');
    expect(d.rejectedSections).toContain('basic');
  });

  it('refuses an application whose face scan failed', () => {
    const d = decide({
      faceScan: { status: 'failed', matchesDocuments: 'unclear', passedAtMs: null },
      config: required,
    });
    expect(d.status).toBe('rejected');
  });

  it('sends an unscoreable face scan to a human', () => {
    const d = decide({
      faceScan: { status: 'review', matchesDocuments: 'unclear', passedAtMs: null },
      config: required,
    });
    expect(d.status).toBe('review');
  });

  it('asks again for a scan that has gone stale', () => {
    const d = decide({ faceScan: { ...PASSED_SCAN, passedAtMs: NOW - 400 * DAY }, config: required });
    expect(d.status).toBe('review');
    expect(d.reasons.map((r) => r.code)).toContain('face_scan_stale');
  });
});

describe('decideDriverVerification — the face scan gate, before the app can do one', () => {
  // This is the default, and it has to hold: the scan needs a native build, so
  // until that build is in the stores every driver would fail a step their app
  // does not have. Getting this wrong refuses every new driver in the country.
  it('does not hold a missing scan against a driver, and still approves', () => {
    const d = decide({ faceScan: { status: 'missing', matchesDocuments: 'unclear', passedAtMs: null } });
    expect(d.status).toBe('approved');
    expect(d.reasons.map((r) => r.code)).not.toContain('face_scan_missing');
  });

  it('ignores a stale scan too', () => {
    const d = decide({ faceScan: { ...PASSED_SCAN, passedAtMs: NOW - 400 * DAY } });
    expect(d.status).toBe('approved');
  });

  it('still sends a FAILED scan to a human — they had the screen', () => {
    // Attempting and failing means the build supports it and something on it
    // went wrong: a screen held up to the camera, two different faces.
    const d = decide({ faceScan: { status: 'failed', matchesDocuments: 'unclear', passedAtMs: null } });
    expect(d.status).toBe('review');
    expect(d.reasons.map((r) => r.code)).toContain('face_scan_failed');
  });
});

// ── The identity gate ────────────────────────────────────────────────────────
//
// IDENTITY_MUST_BE_PROVEN. Nothing is approved automatically unless this
// applicant's own face was matched to the photograph on their own CNIC and
// their own licence — and nothing is REFUSED for failing to establish it. The
// two halves of that sentence are the whole feature, and each one has a test.

describe('decideDriverVerification — identity: the face on both cards', () => {
  const noScan: FaceScanState = {
    status: 'missing',
    matchesDocuments: 'unclear',
    passedAtMs: null,
  };
  const cross = (over: Partial<DriverVerificationReport['crossChecks']>) =>
    cleanReport({ crossChecks: { ...cleanReport().crossChecks, ...over } });

  it('approves when the live scan matches both the CNIC and the licence', () => {
    const d = decide({ faceScan: PASSED_SCAN });
    expect(d.status).toBe('approved');
    expect(d.identity).toMatchObject({ source: 'face_scan', agreement: 'match', proven: true });
  });

  it('will not approve when the licence photo could not be compared', () => {
    // The commonest honest case: a laminated 2011 licence whose portrait no
    // engine can find a face in. Not a refusal — a person looks.
    const d = decide({ faceScan: { ...PASSED_SCAN, matchesLicense: 'unclear' } });
    expect(d.status).toBe('review');
    expect(d.reasons.map((r) => r.code)).toContain('identity_not_proven');
  });

  it('will not approve when the CNIC photo could not be compared', () => {
    const d = decide({ faceScan: { ...PASSED_SCAN, matchesCnic: 'unclear' } });
    expect(d.status).toBe('review');
  });

  it('never REFUSES an application for a face mismatch alone', () => {
    // The other half of the rule. A mismatch is a flag for a human, whichever
    // card it is on, however high the risk score climbs.
    const d = decide({
      faceScan: { ...PASSED_SCAN, matchesCnic: 'mismatch', matchesDocuments: 'mismatch' },
      report: cross({ faceConsistency: 'mismatch', selfieVsCnic: 'mismatch' }),
    });
    expect(d.status).toBe('review');
    expect(d.identity.proven).toBe(false);
  });

  it('falls back to the uploaded photo when there is no live scan', () => {
    // Every driver on the current app build. Weaker evidence, and still a real
    // comparison against both cards — so it can approve.
    const d = decide({ faceScan: noScan });
    expect(d.status).toBe('approved');
    expect(d.identity.source).toBe('uploaded_photo');
  });

  it('will not approve when the uploaded photo matches only one card', () => {
    const d = decide({ faceScan: noScan, report: cross({ selfieVsLicense: 'unclear' }) });
    expect(d.status).toBe('review');
    expect(d.identity.proven).toBe(false);
  });

  it('can be told to settle for the CNIC alone', () => {
    // The admin lever, for a fleet drowning in unreadable licence portraits.
    const d = decide({
      faceScan: { ...PASSED_SCAN, matchesLicense: 'unclear' },
      config: { requireLicenceFaceMatch: false },
    });
    expect(d.status).toBe('approved');
  });

  it('still refuses to settle for a licence that shows somebody else', () => {
    // The lever softens "could not tell", never "that is a different person".
    const d = decide({
      faceScan: { ...PASSED_SCAN, matchesLicense: 'mismatch' },
      config: { requireLicenceFaceMatch: false },
    });
    expect(d.status).toBe('review');
  });

  it('does not credit a scan taken before the documents were uploaded', () => {
    // The substitution this stops: pass a scan against your own CNIC, then
    // resubmit with somebody else's papers and keep the pass. Such a scan
    // proves a live person and nothing more, so the uploaded photo decides.
    const d = decide({
      faceScan: { ...PASSED_SCAN, afterDocuments: false, matchesCnic: 'mismatch' },
      report: cross({ selfieVsCnic: 'unclear' }),
    });
    expect(d.status).toBe('review');
    expect(d.identity.source).toBe('uploaded_photo');
    expect(d.reasons.map((r) => r.code)).toContain('face_scan_before_documents');
  });

  it('records what it found even when it found nothing', () => {
    const d = decide({ faceScan: noScan, report: null });
    expect(d.identity).toMatchObject({ proven: false, agreement: 'unclear' });
  });
});

// ── The vehicle papers are held to a looser standard ─────────────────────────

describe('decideDriverVerification — the car is not the identity', () => {
  const cross = (over: Partial<DriverVerificationReport['crossChecks']>) =>
    cleanReport({ crossChecks: { ...cleanReport().crossChecks, ...over } });

  it('approves despite a plate that does not match the car photo', () => {
    // The OCR reads LEA-482 off a plate that says LEA-4821. A car registered
    // to a father, or bought last month and not yet transferred, is ordinary
    // here. None of it says anything about who is driving.
    const d = decide({ report: cross({ plateConsistency: 'mismatch' }) });
    expect(d.status).toBe('approved');
    expect(d.reasons.map((r) => r.code)).toContain('plate_mismatch');
  });

  it('approves despite the car not matching its registration', () => {
    const d = decide({ report: cross({ vehicleConsistency: 'mismatch' }) });
    expect(d.status).toBe('approved');
  });

  it('sends both together to a human rather than refusing', () => {
    const d = decide({
      report: cross({ plateConsistency: 'mismatch', vehicleConsistency: 'mismatch' }),
    });
    expect(d.status).toBe('review');
  });

  it('a typed plate that disagrees with the papers is still only a note', () => {
    const d = decide({ submitted: { plate: 'ABC-999' } });
    expect(d.status).toBe('approved');
    expect(d.reasons.map((r) => r.code)).toContain('typed_plate_mismatch');
  });
});

// ── The face scan itself ─────────────────────────────────────────────────────

describe('pickChallenges', () => {
  it('always opens with a straight-on frame', () => {
    // That frame is the one compared against the CNIC photograph later.
    for (let i = 0; i < 20; i++) expect(pickChallenges()[0]).toBe('look_straight');
  });

  it('never repeats a pose within one scan', () => {
    for (let i = 0; i < 20; i++) {
      const picked = pickChallenges();
      expect(new Set(picked).size).toBe(picked.length);
    }
  });

  it('draws from the real vocabulary and honours the count', () => {
    const picked = pickChallenges(4, () => 0.5);
    expect(picked).toHaveLength(4);
    for (const c of picked) expect(FACE_CHALLENGES).toContain(c);
  });
});

describe('scoreFaceScan', () => {
  const asked = ['look_straight', 'turn_left', 'smile'] as const;

  function report(over: Partial<FaceScanReport> = {}): FaceScanReport {
    return {
      frames: asked.map((c, index) => ({
        index, faceVisible: true, poseObserved: c, recaptured: false, notes: '',
      })),
      samePersonAcrossFrames: true,
      livePerson: true,
      confidence: 'high',
      summary: '',
      ...over,
    };
  }

  it('passes a scan that did everything asked', () => {
    const v = scoreFaceScan({ report: report(), asked: [...asked] });
    expect(v.status).toBe('passed');
    expect(v.posesMatched).toBe(3);
  });

  it('fails a photograph of a screen outright', () => {
    const frames = report().frames.map((f, i) => (i === 0 ? { ...f, recaptured: true } : f));
    const v = scoreFaceScan({ report: report({ frames }), asked: [...asked] });
    expect(v.status).toBe('failed');
    expect(v.reasons).toContain('face_scan_recaptured');
    expect(v.message).toMatch(/not a photo or a screen/i);
  });

  it('fails when the frames are not all the same person', () => {
    const v = scoreFaceScan({ report: report({ samePersonAcrossFrames: false }), asked: [...asked] });
    expect(v.status).toBe('failed');
    expect(v.message).toMatch(/more than one person/i);
  });

  it('asks an honest driver to try again rather than queueing them', () => {
    // One shallow head turn in bright sun. Common, and not fraud.
    const frames = report().frames.map((f, i) => (i === 1 ? { ...f, poseObserved: 'unclear' as const } : f));
    const v = scoreFaceScan({ report: report({ frames }), asked: [...asked] });
    expect(v.status).toBe('failed');
    expect(v.reasons).toContain('face_scan_retry');
    expect(v.message).toMatch(/try the face scan again/i);
  });

  it('sends a scan with no verdict to a human, never passes it', () => {
    const v = scoreFaceScan({ report: null, asked: [...asked] });
    expect(v.status).toBe('review');
    expect(v.reasons).toContain('face_scan_unverified');
  });
});
