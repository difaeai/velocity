import { describe, expect, it } from 'vitest';

import {
  APPLICATION_MESSAGES,
  applicationSchema,
  bookingSchema,
  hasBothDocuments,
  listingsQuerySchema,
  parseOrInvalid,
} from '../schemas';

const DAY = 24 * 60 * 60 * 1000;
const STORAGE = 'https://firebasestorage.googleapis.com/v0/b/x/o/';

/** The exact shape the compose screen of app 1.12.0 sends: no way to attach papers. */
const fromApp = {
  carDetails: {
    make: 'Toyota',
    model: 'Corolla',
    year: 2019,
    licensePlate: 'LEA-1234',
    color: 'White',
    seatsCount: 5,
    transmissionType: 'automatic',
    mileage: 0,
    features: [],
  },
  location: { lat: 0, lng: 0, address: 'F-7 Markaz', city: 'Islamabad' },
  pricePerDay: 5000,
  photos: [{ url: `${STORAGE}p.jpg`, uploadedAt: 1 }],
  documentUrls: { insuranceProof: '', vehicleRegistration: '' },
  ownerName: 'Ali',
  ownerPhone: '03001234567',
};

/** Throws the message, the way `invalid()` does inside a callable. */
function raise(message: string): never {
  throw new Error(message);
}

describe('applicationSchema', () => {
  it('accepts what the app sends, including a blank year (parseInt → null)', () => {
    expect(applicationSchema.safeParse(fromApp).success).toBe(true);
    const blankYear = { ...fromApp, carDetails: { ...fromApp.carDetails, year: null } };
    expect(applicationSchema.safeParse(blankYear).success).toBe(true);
  });

  it('accepts a blank owner name, as the original callable did', () => {
    expect(applicationSchema.safeParse({ ...fromApp, ownerName: '' }).success).toBe(true);
  });

  it('strips keys nobody asked for instead of storing them', () => {
    const parsed = applicationSchema.parse({ ...fromApp, status: 'approved', uid: 'someone-else' });
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('uid');
  });

  it('refuses photos from outside our storage and out-of-range prices', () => {
    expect(applicationSchema.safeParse({ ...fromApp, photos: [{ url: 'javascript:alert(1)', uploadedAt: 1 }] }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...fromApp, photos: [{ url: 'https://evil.example/p.jpg', uploadedAt: 1 }] }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...fromApp, pricePerDay: 50 }).success).toBe(false);
  });

  it('takes papers from our storage, and refuses them from anywhere else', () => {
    const papers = { insuranceProof: `${STORAGE}ins.jpg`, vehicleRegistration: `${STORAGE}reg.jpg` };
    expect(applicationSchema.safeParse({ ...fromApp, documentUrls: papers }).success).toBe(true);
    const outside = { ...papers, insuranceProof: 'https://evil.example/ins.jpg' };
    expect(applicationSchema.safeParse({ ...fromApp, documentUrls: outside }).success).toBe(false);
  });

  it('treats absent papers as not provided rather than as an error', () => {
    const { documentUrls: _omitted, ...withoutPapers } = fromApp;
    const parsed = applicationSchema.parse(withoutPapers);
    expect(parsed.documentUrls).toEqual({ insuranceProof: '', vehicleRegistration: '' });
    expect(hasBothDocuments(parsed.documentUrls)).toBe(false);
  });
});

describe('hasBothDocuments', () => {
  it('needs both', () => {
    expect(hasBothDocuments({ insuranceProof: 'a', vehicleRegistration: 'b' })).toBe(true);
    expect(hasBothDocuments({ insuranceProof: 'a', vehicleRegistration: '' })).toBe(false);
    expect(hasBothDocuments(undefined)).toBe(false);
  });
});

describe('parseOrInvalid', () => {
  it('tells a host what to fix in words, not in zod', () => {
    const noAddress = { ...fromApp, location: { ...fromApp.location, address: '' } };
    expect(() => parseOrInvalid(applicationSchema, noAddress, raise, APPLICATION_MESSAGES)).toThrow(
      'Enter the address or area where the car is parked.',
    );
  });

  it('falls back to the nearest listed parent for nested fields', () => {
    const badPhoto = { ...fromApp, photos: [{ url: 'file:///local.jpg', uploadedAt: 1 }] };
    expect(() => parseOrInvalid(applicationSchema, badPhoto, raise, APPLICATION_MESSAGES)).toThrow(
      'Add between 1 and 20 photos of your car.',
    );
  });

  it('keeps the field path when there are no words for it', () => {
    expect(() => parseOrInvalid(bookingSchema, { listingId: 'a/b' }, raise)).toThrow(/^listingId: /);
  });
});

describe('bookingSchema', () => {
  const now = Date.now();
  const base = { listingId: 'L1', hostUid: 'H1', pickupDate: now + DAY, returnDate: now + 3 * DAY };

  it('accepts a normal booking and defaults includeDriver', () => {
    const parsed = bookingSchema.parse(base);
    expect(parsed.includeDriver).toBe(false);
  });

  it('refuses the inputs that used to produce a NaN price', () => {
    expect(bookingSchema.safeParse({ ...base, pickupDate: 'tomorrow' }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...base, returnDate: base.pickupDate }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...base, returnDate: base.pickupDate + 400 * DAY }).success).toBe(false);
  });

  it('refuses a host id that is a path', () => {
    expect(bookingSchema.safeParse({ ...base, hostUid: 'H1/bookings/x' }).success).toBe(false);
  });
});

describe('listingsQuerySchema', () => {
  it('defaults the page', () => {
    expect(listingsQuerySchema.parse({}).page).toBe(0);
  });
});
