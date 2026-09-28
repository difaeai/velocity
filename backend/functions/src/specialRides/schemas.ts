/**
 * Input schemas for the Special Rides callables.
 *
 * This module used to destructure `request.data` raw, so arbitrary objects went
 * straight into Firestore — and, on approval, into `specialRidesListings`, which
 * every signed-in user can read. Every callable now parses its input here first.
 * Unknown keys are stripped, not stored.
 */
import { z } from 'zod';

import { docId } from '../lib/guards';

const text = (max: number) => z.string().trim().max(max);
/** parseInt('') on the client serialises as null, so optional numbers accept it. */
const optNum = (min: number, max: number) => z.number().finite().min(min).max(max).nullish();

/** Same test as the CNIC and partner uploads: a file the app put in our own bucket. */
export function isOwnStorageUrl(url: string): boolean {
  return (
    url.startsWith('https://firebasestorage.googleapis.com/') ||
    url.startsWith('https://storage.googleapis.com/')
  );
}

const storageUrl = z
  .string()
  .max(2048)
  .refine(isOwnStorageUrl, 'must be uploaded to Velocity Rides storage');

const carDetails = z.object({
  make: text(60).min(1),
  model: text(60).min(1),
  year: optNum(1950, 2100),
  licensePlate: text(20).optional(),
  color: text(30).optional(),
  seatsCount: optNum(1, 60),
  transmissionType: z.enum(['manual', 'automatic']).optional(),
  mileage: optNum(0, 5_000_000),
  features: z.array(text(40)).max(30).optional(),
});

const location = z.object({
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  address: text(300).min(1),
  city: text(60).min(1),
});

const photos = z
  .array(z.object({ url: storageUrl, uploadedAt: z.number().finite() }))
  .min(1)
  .max(20);

/**
 * The host's insurance and registration papers.
 *
 * Either may be an empty string. App builds up to 1.12.0 have no way to upload
 * them and always send both empty; refusing that at submission meant nobody on
 * those builds could list a car at all. The requirement is enforced where it
 * matters instead: an application without both papers cannot be approved.
 */
const documentUrl = z
  .string()
  .max(2048)
  .refine((u) => u === '' || isOwnStorageUrl(u), 'must be uploaded to Velocity Rides storage');

const documentUrls = z
  .object({ insuranceProof: documentUrl, vehicleRegistration: documentUrl })
  .default({ insuranceProof: '', vehicleRegistration: '' });

/** Both papers are on file. Tolerates the field being absent on older documents. */
export function hasBothDocuments(
  docs: { insuranceProof?: string; vehicleRegistration?: string } | null | undefined,
): boolean {
  return Boolean(docs?.insuranceProof && docs?.vehicleRegistration);
}

export const applicationSchema = z.object({
  carDetails,
  location,
  pricePerDay: z.number().int().min(500).max(10_000),
  photos,
  documentUrls,
  // Not required: the app pre-fills it from the account and never checked it,
  // and the original callable stored whatever arrived.
  ownerName: text(80),
  ownerPhone: text(30).min(1),
  instructions: text(2000).optional(),
});

/**
 * What to tell a host who got a field wrong, keyed by the field's path. The app
 * shows the callable's message as-is, and zod's own ("String must contain at
 * least 1 character(s)") is not something to put in front of a person.
 */
export const APPLICATION_MESSAGES: Record<string, string> = {
  'carDetails.make': 'Enter the car make, e.g. Toyota.',
  'carDetails.model': 'Enter the car model, e.g. Corolla.',
  'carDetails.year': 'Enter the model year, e.g. 2019.',
  'carDetails.licensePlate': 'Check the licence plate.',
  'carDetails.color': 'Check the colour.',
  'carDetails.seatsCount': 'Enter the number of seats.',
  'carDetails.mileage': 'Check the mileage.',
  'location.address': 'Enter the address or area where the car is parked.',
  'location.city': 'Enter the city.',
  pricePerDay: 'Price must be between 500 and 10,000 PKR.',
  photos: 'Add between 1 and 20 photos of your car.',
  'documentUrls.insuranceProof': 'Please add the insurance photo again.',
  'documentUrls.vehicleRegistration': 'Please add the registration photo again.',
  ownerName: 'Check your name.',
  ownerPhone: 'Enter a contact phone number.',
  instructions: 'The instructions are too long.',
};

export const applicationUpdateSchema = applicationSchema.partial();

export const reviewSchema = z.object({
  uid: docId,
  decision: z.enum(['approve', 'reject', 'resubmit']),
  rejectionReason: text(500).optional(),
  maxDailyRate: z.number().int().min(500).max(10_000).optional(),
});

export const suspendSchema = z.object({
  uid: docId,
  suspended: z.boolean(),
  reason: text(500).optional(),
});

export const listingsQuerySchema = z.object({
  city: text(60).optional(),
  maxPrice: z.number().finite().min(0).optional(),
  page: z.number().int().min(0).max(1000).default(0),
});

export const listingRefSchema = z.object({ listingId: docId, hostUid: docId });

/** A rental can start up to a year out and last up to 90 days. */
const DAY_MS = 24 * 60 * 60 * 1000;
export const bookingSchema = z
  .object({
    listingId: docId,
    hostUid: docId,
    pickupDate: z.number().int().positive(),
    returnDate: z.number().int().positive(),
    includeDriver: z.boolean().default(false),
  })
  .refine((b) => b.returnDate > b.pickupDate, 'Return date must be after pick-up date')
  .refine((b) => b.returnDate - b.pickupDate <= 90 * DAY_MS, 'A rental can be at most 90 days')
  .refine((b) => b.pickupDate <= Date.now() + 365 * DAY_MS, 'Pick-up must be within a year');

export const bookingRefSchema = z.object({
  bookingId: docId,
  reason: text(500).optional(),
});

/** The message for `path` or its nearest listed parent ('photos.0.url' → 'photos'). */
function messageFor(path: string, messages: Record<string, string>): string | undefined {
  for (let key = path; key; key = key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : '') {
    if (messages[key]) return messages[key];
  }
  return undefined;
}

/**
 * Parses `data` or raises the same invalid-argument error the module always
 * used — in words from `messages` where the field has an entry.
 */
export function parseOrInvalid<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  invalid: (m: string) => never,
  messages: Record<string, string> = {},
): z.infer<S> {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    invalid(
      issue ? messageFor(path, messages) ?? `${path || 'input'}: ${issue.message}` : 'Invalid input',
    );
  }
  return parsed.data;
}
