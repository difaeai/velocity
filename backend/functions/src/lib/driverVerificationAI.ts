/**
 * The eyes of the driver verification engine.
 *
 * Two jobs, both Claude vision calls, both returning a schema-constrained
 * object rather than prose:
 *
 *   · readDriverDocuments() — looks at every paper one applicant submitted, in
 *     ONE request, so the model can compare them against each other. Two
 *     separate calls could never answer "is the name on the licence the name on
 *     the CNIC", which is the question that catches a borrowed identity.
 *   · readFaceScan() — looks at the three live frames and says whether a real
 *     person performed the poses the SERVER asked for, and whether that person
 *     is the one on the ID.
 *
 * Both return null rather than a guess when the key is missing, an image will
 * not load, or the call fails. Null means "a human decides" everywhere it is
 * consumed — never "approved", and never "rejected" either. That asymmetry is
 * the whole safety story: the engine can be switched off by deleting a secret
 * and the worst that happens is that every driver waits for a person.
 *
 * Why structured outputs instead of "respond with JSON": the schema is enforced
 * by the API, so a verdict cannot come back with a field missing or an invented
 * fraud signal the decision logic does not know how to weigh. Hand-parsed JSON
 * (the older lib/paymentProofAI.ts way) silently degrades to null on a stray
 * word of preamble; this does not.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions';

import { storage } from './firebase';
import {
  FRAUD_SIGNALS,
  type DocumentKind,
  type DriverVerificationReport,
} from '../domain/driverVerification';
import {
  CHALLENGE_DESCRIPTION,
  FACE_CHALLENGES,
  type FaceChallenge,
  type FaceScanReport,
} from '../domain/faceScan';

/**
 * Identity fraud is the intelligence-sensitive end of this codebase — a forged
 * CNIC that gets through puts a stranger in a car with somebody's daughter. It
 * gets the best model, at high effort, and the cost is a rounding error against
 * one fraudulent driver.
 */
const MODEL = 'claude-opus-5-5';

/** Per-image ceiling. A phone photo at quality 0.6 is a tenth of this. */
const MAX_IMAGE_BYTES = 4_500_000;
/** Request ceiling, well under the API's 32 MB, leaving room for base64 growth. */
const MAX_TOTAL_BYTES = 18_000_000;

type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

interface LoadedImage {
  label: string;
  base64: string;
  mediaType: MediaType;
}

/** True when the Anthropic API key secret is present. */
export function verificationAIConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

/**
 * Pull one Storage object down as base64.
 *
 * Refuses anything that is not an image and anything oversized rather than
 * sending it: a 20 MB upload from a flagship phone would otherwise fail the
 * whole request, taking five perfectly good documents down with it.
 */
async function loadImage(path: string, label: string): Promise<LoadedImage | null> {
  try {
    const file = storage.bucket().file(path);
    const [meta] = await file.getMetadata();
    const contentType = (meta.contentType as string | undefined) ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      logger.warn('Driver document is not an image', { path, contentType });
      return null;
    }
    const size = Number(meta.size ?? 0);
    if (size > MAX_IMAGE_BYTES) {
      logger.warn('Driver document too large to verify', { path, size });
      return null;
    }
    const [buf] = await file.download();
    const mediaType: MediaType = contentType === 'image/png'
      ? 'image/png'
      : contentType === 'image/webp'
        ? 'image/webp'
        : contentType === 'image/gif'
          ? 'image/gif'
          : 'image/jpeg';
    return { label, base64: buf.toString('base64'), mediaType };
  } catch (e) {
    logger.error('Failed to load driver document from Storage', { path, e });
    return null;
  }
}

/** Load several, dropping failures and stopping at the request budget. */
async function loadImages(items: Array<{ path: string; label: string }>): Promise<LoadedImage[]> {
  const loaded = await Promise.all(items.map((i) => loadImage(i.path, i.label)));
  const out: LoadedImage[] = [];
  let total = 0;
  for (const img of loaded) {
    if (!img) continue;
    total += img.base64.length;
    if (total > MAX_TOTAL_BYTES) {
      logger.warn('Dropping driver image to stay within request budget', { label: img.label });
      continue;
    }
    out.push(img);
  }
  return out;
}

/** Interleave each image with a caption naming which slot of the form it came from. */
function imageContent(images: LoadedImage[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const img of images) {
    blocks.push({ type: 'text', text: `--- ${img.label} ---` });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    });
  }
  return blocks;
}

// ── Schemas ──────────────────────────────────────────────────────────────────
// Written as JSON Schema rather than through the SDK's zod helper on purpose:
// that helper wants `zod/v4` while every callable in this backend validates with
// zod v3 classic, and one zod per repository is worth more than the convenience.

const DOCUMENT_KINDS: DocumentKind[] = [
  'selfie', 'license', 'cnicFront', 'cnicBack', 'vehicleRegistration', 'vehiclePhoto',
];

const LOOKS_LIKE = [
  'driving_license', 'cnic_front', 'cnic_back', 'vehicle_registration',
  'person_photo', 'vehicle_photo', 'other_document', 'unreadable',
];

const nullableString = { type: ['string', 'null'] } as const;

const DOCUMENT_REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documents', 'crossChecks', 'fraudSignals', 'overallConfidence', 'summary'],
  properties: {
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'looksLike', 'legible', 'tampering', 'specimen', 'fields', 'confidence', 'notes'],
        properties: {
          kind: { type: 'string', enum: DOCUMENT_KINDS },
          looksLike: { type: 'string', enum: LOOKS_LIKE },
          legible: { type: 'boolean' },
          tampering: { type: 'string', enum: ['none', 'suspected', 'clear'] },
          specimen: { type: 'boolean' },
          fields: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'fatherName', 'idNumber', 'dateOfBirth', 'issueDate', 'expiryDate', 'plate', 'vehicleMake', 'vehicleColor'],
            properties: {
              name: nullableString,
              fatherName: nullableString,
              idNumber: nullableString,
              dateOfBirth: nullableString,
              issueDate: nullableString,
              expiryDate: nullableString,
              plate: nullableString,
              vehicleMake: nullableString,
              vehicleColor: nullableString,
            },
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          notes: { type: 'string' },
        },
      },
    },
    crossChecks: {
      type: 'object',
      additionalProperties: false,
      required: ['faceConsistency', 'nameConsistency', 'idNumberConsistency', 'plateConsistency', 'vehicleConsistency'],
      properties: {
        faceConsistency: { type: 'string', enum: ['match', 'mismatch', 'unclear'] },
        nameConsistency: { type: 'string', enum: ['match', 'mismatch', 'unclear'] },
        idNumberConsistency: { type: 'string', enum: ['match', 'mismatch', 'unclear'] },
        plateConsistency: { type: 'string', enum: ['match', 'mismatch', 'unclear'] },
        vehicleConsistency: { type: 'string', enum: ['match', 'mismatch', 'unclear'] },
      },
    },
    fraudSignals: { type: 'array', items: { type: 'string', enum: [...FRAUD_SIGNALS] } },
    overallConfidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    summary: { type: 'string' },
  },
} as const;

const FACE_SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frames', 'samePersonAcrossFrames', 'livePerson', 'matchesIdPhoto', 'confidence', 'summary'],
  properties: {
    frames: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'faceVisible', 'poseObserved', 'recaptured', 'notes'],
        properties: {
          index: { type: 'integer' },
          faceVisible: { type: 'boolean' },
          poseObserved: { type: 'string', enum: [...FACE_CHALLENGES, 'other', 'unclear'] },
          recaptured: { type: 'boolean' },
          notes: { type: 'string' },
        },
      },
    },
    samePersonAcrossFrames: { type: 'boolean' },
    livePerson: { type: 'boolean' },
    matchesIdPhoto: { type: 'string', enum: ['match', 'mismatch', 'unclear'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    summary: { type: 'string' },
  },
} as const;

/** One place to make the call, so both readers get the same guards and logging. */
async function askClaude<T>(params: {
  what: string;
  system: string;
  content: Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
}): Promise<T | null> {
  const client = new Anthropic();
  try {
    const res = await client.messages.create({
      model: MODEL,
      // Thinking is always on and adaptive on this model; high effort because a
      // forged card is exactly the kind of thing a quick glance misses.
      max_tokens: 16000,
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: params.schema },
      },
      system: params.system,
      messages: [{ role: 'user', content: params.content }],
    });

    if (res.stop_reason === 'refusal') {
      logger.warn('Verification refused by model', { what: params.what, details: res.stop_details });
      return null;
    }
    if (res.stop_reason === 'max_tokens') {
      logger.warn('Verification response truncated', { what: params.what });
      return null;
    }

    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    if (!text) {
      logger.warn('Verification returned no text block', { what: params.what });
      return null;
    }
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      logger.error('Anthropic call failed', { what: params.what, status: e.status, message: e.message });
    } else {
      logger.error('Verification call failed', { what: params.what, e });
    }
    return null;
  }
}

// ── Reading the papers ───────────────────────────────────────────────────────

const DOCUMENT_SYSTEM = `You are the document-verification examiner for Velocity Rides, a ride-hailing platform in Pakistan. Applicants who want to drive upload their own identity and vehicle papers; you inspect them and report what you actually see.

Your report decides whether a human reviewer has to look at this application. Both of your possible errors are costly and they are not symmetric:
- Passing a forged or borrowed document puts an unvetted stranger alone in a car with a passenger.
- Failing an honest applicant takes away their income, and the people most likely to be failed unfairly are those with old, worn, or hand-corrected documents — which in Pakistan is very many legitimate drivers.

So: report what is on the image, never what is probably true. If a field is unreadable, it is null — do not infer it from another document or from the applicant's name. If you are unsure whether a document is altered, say "suspected", not "clear". Reserve "clear" tampering for visible evidence: cloned pixels, mismatched fonts within one printed line, a number overwritten, an obviously pasted photograph.

Pakistani documents you will see:
- CNIC (NADRA national identity card): front has the photo, name, father's name, 13-digit CNIC number formatted 00000-0000000-0, date of birth, date of issue, date of expiry. Many older cards are lifetime cards and print no expiry — report expiryDate as null for those, not as expired. The back has the address and the signature/thumbprint.
- Driving licence: issued provincially (Punjab, Sindh, KPK, Balochistan, Islamabad), with the holder's photo, licence number, category (LTV/HTV/motorcycle), date of issue and date of expiry. Formats and card stock vary considerably between provinces and between years — an unfamiliar layout is not by itself a forgery.
- Vehicle registration ("registration book" or smart card) from the provincial excise department: registration/plate number, make, model, colour, engine and chassis numbers, owner name. Many are open-ended and print no expiry; report null rather than guessing.

Dates: transcribe them EXACTLY as printed, including the separators, and do not reformat them. "12-03-2026" stays "12-03-2026". The platform parses them itself and knows they are day-first.

Names: transcribe exactly as printed. Do not normalise spelling. When judging nameConsistency, however, be aware that "Muhammad"/"Mohammad"/"Md" and similar transliteration variants are the same name, as are names written with and without a father's name — only call a mismatch when the documents genuinely name different people.

faceConsistency compares the photograph printed on the CNIC with the one on the licence and with the applicant's submitted profile photo. These are often a decade apart, low-resolution, and printed through a security laminate. Answer "unclear" unless you can actually tell; "mismatch" means you are confident they are different people.

Only use the fraudSignals vocabulary you are given. Anything else you want to flag goes in the notes field of the relevant document.`;

/**
 * Inspect everything one applicant submitted.
 *
 * `documents` is already filtered to the slots that have an upload; a slot
 * missing entirely is caught by the decision logic before this is ever called.
 */
export async function readDriverDocuments(
  documents: Array<{ kind: DocumentKind; path: string }>,
): Promise<DriverVerificationReport | null> {
  if (!verificationAIConfigured() || documents.length === 0) return null;

  const images = await loadImages(
    documents.map((d) => ({ path: d.path, label: `${d.kind} (submitted as: ${slotLabel(d.kind)})` })),
  );
  if (images.length === 0) {
    logger.warn('No driver documents could be loaded for verification');
    return null;
  }

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `Inspect this driver application. ${images.length} image(s) follow, each captioned with the form slot it was uploaded into.

Report one entry in "documents" for each image, using the slot name as "kind". Set "looksLike" to what the image ACTUALLY shows, which may not be what the slot was for — a person who uploads their CNIC into the licence slot has made a mistake we need to catch, not a forgery.

Then fill in "crossChecks" by comparing the documents with each other, and list any applicable "fraudSignals".`,
    },
    ...imageContent(images),
  ];

  const report = await askClaude<DriverVerificationReport>({
    what: 'driver documents',
    system: DOCUMENT_SYSTEM,
    content,
    schema: DOCUMENT_REPORT_SCHEMA as unknown as Record<string, unknown>,
  });

  if (report) {
    logger.info('Driver documents read', {
      documents: report.documents.length,
      signals: report.fraudSignals,
      confidence: report.overallConfidence,
    });
  }
  return report;
}

function slotLabel(kind: DocumentKind): string {
  switch (kind) {
    case 'selfie': return 'profile photo of the applicant';
    case 'license': return 'driving licence';
    case 'cnicFront': return 'CNIC front';
    case 'cnicBack': return 'CNIC back';
    case 'vehicleRegistration': return 'vehicle registration document';
    case 'vehiclePhoto': return 'photo of the vehicle';
  }
}

// ── Reading the face scan ────────────────────────────────────────────────────

const FACE_SCAN_SYSTEM = `You are the liveness examiner for Velocity Rides, a ride-hailing platform in Pakistan. A driver applicant has just been shown a sequence of poses, one at a time, and the front camera captured a frame for each. The platform chose that sequence after the applicant started the scan, so the applicant could not have prepared for it.

Your job is to say whether a live human being performed those poses just now, and whether that human is the person on the identity documents.

Judge each frame on three things:
- faceVisible: is there one human face, large enough and lit well enough to assess?
- poseObserved: which of the listed poses is this face actually doing? Use "other" when it is clearly a different pose from any listed, and "unclear" when you cannot tell. Note that head-turn directions are from the PERSON's point of view, not the camera's; the image may also be mirrored, as front cameras usually are. If you cannot determine the mirroring, prefer "unclear" over guessing a direction.
- recaptured: is this a photograph of a screen or of a printed photo rather than of a person? Look for moiré patterns, a device bezel or edge, screen glare, pixel grid, flat uniform lighting across a face, a visible paper edge or fold, or a face that is suspiciously planar.

Then across all the frames: samePersonAcrossFrames, and livePerson — a genuine living person in front of the camera, as opposed to a screen, a print, a mask, or a generated image.

Finally, matchesIdPhoto compares this live face with the photograph on the identity document supplied at the end. ID photographs here are often years old, low-resolution and printed behind a security laminate, and people age, gain weight, and grow and shave beards. Answer "unclear" unless you can genuinely tell; "mismatch" means you are confident this is a different person. A wrong "mismatch" costs an honest driver their job, so the bar for it is high.

Be strict about screens and prints, and generous about imperfect poses: an applicant holding a phone at arm's length in bright sun does not turn their head as far as asked.`;

/**
 * Score one completed face scan.
 *
 * `asked` is the sequence the SERVER issued — read from the stored scan, never
 * from anything the handset sent back. `idPhotoPath` is the CNIC front when we
 * have one, so the live face can be compared with the card in the same call.
 */
export async function readFaceScan(params: {
  frames: Array<{ index: number; path: string }>;
  asked: FaceChallenge[];
  idPhotoPath?: string | null;
}): Promise<(FaceScanReport & { matchesIdPhoto: 'match' | 'mismatch' | 'unclear' }) | null> {
  if (!verificationAIConfigured() || params.frames.length === 0) return null;

  const ordered = [...params.frames].sort((a, b) => a.index - b.index);

  // The frames and the ID photo are loaded SEPARATELY, and that is not tidiness.
  // Loaded together, a dropped frame and a present ID photo give the same count
  // as three good frames — and the model, told the last image is the ID, would
  // read frame 2 as the ID and score a scan that is missing a pose. Counting
  // the frames on their own is what makes "all three arrived" checkable.
  const frameImages = await loadImages(
    ordered.map((f) => ({
      path: f.path,
      label: `frame ${f.index} — the applicant was asked to: ${describe(params.asked[f.index])}`,
    })),
  );
  // Every frame has to be present: a scan judged on two of three frames is not
  // the scan we asked for, and a dropped frame must not look like a pass.
  if (frameImages.length !== ordered.length) {
    logger.warn('Face scan frames could not all be loaded', {
      wanted: ordered.length,
      got: frameImages.length,
    });
    return null;
  }

  // The ID photo is optional — a scan taken before the documents has nothing to
  // compare against — so a failure here degrades to a liveness-only check
  // rather than failing the scan.
  const idImage = params.idPhotoPath
    ? (await loadImages([{ path: params.idPhotoPath, label: 'identity document (for the face comparison only)' }]))[0]
    : undefined;
  const images = idImage ? [...frameImages, idImage] : frameImages;

  const poseList = params.asked
    .map((c, i) => `  frame ${i}: ${c} — ${CHALLENGE_DESCRIPTION[c]}`)
    .join('\n');

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      // Keyed off the image that actually loaded, never off the path we were
      // handed — telling the model to expect an ID photo that is not there is
      // how the last frame gets read as the ID.
      text: `This face scan asked for ${params.asked.length} poses, in this order:\n${poseList}\n\nThe frames follow in order, each captioned.${idImage ? ' The final image is the identity document, for the face comparison only — do not report it as a frame.' : ' No identity document was available, so answer matchesIdPhoto as "unclear".'}`,
    },
    ...imageContent(images),
  ];

  const report = await askClaude<FaceScanReport & { matchesIdPhoto: 'match' | 'mismatch' | 'unclear' }>({
    what: 'face scan',
    system: FACE_SCAN_SYSTEM,
    content,
    schema: FACE_SCAN_SCHEMA as unknown as Record<string, unknown>,
  });

  if (report) {
    logger.info('Face scan read', {
      live: report.livePerson,
      samePerson: report.samePersonAcrossFrames,
      matchesId: report.matchesIdPhoto,
      confidence: report.confidence,
    });
  }
  return report;
}

function describe(challenge: FaceChallenge | undefined): string {
  return challenge ? CHALLENGE_DESCRIPTION[challenge] : 'an unspecified pose';
}
