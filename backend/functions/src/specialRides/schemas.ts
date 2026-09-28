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
const httpsUrl = z.string().max(2048).regex(/^https:\/\//, 'must be an https URL');

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
  .array(z.object({ url: httpsUrl, uploadedAt: z.number().finite() }))
  .min(1)
  .max(20);

/** Empty strings are let through here; the callable decides whether they are required. */
const documentUrls = z.object({
  insuranceProof: z.union([httpsUrl, z.literal('')]),
  vehicleRegistration: z.union([httpsUrl, z.literal('')]),
});

export const applicationSchema = z.object({
  carDetails,
  location,
  pricePerDay: z.number().int().min(500).max(10_000),
  photos,
  documentUrls,
  ownerName: text(80).min(1),
  ownerPhone: text(20).min(1),
  instructions: text(1000).optional(),
});

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

/** Parses `data` or raises the same invalid-argument error the module always used. */
export function parseOrInvalid<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  invalid: (m: string) => never,
): z.infer<S> {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    invalid(issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : 'Invalid input');
  }
  return parsed.data;
}
