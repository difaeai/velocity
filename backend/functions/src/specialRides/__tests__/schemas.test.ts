import { describe, expect, it } from 'vitest';

import { applicationSchema, bookingSchema, listingsQuerySchema } from '../schemas';

const DAY = 24 * 60 * 60 * 1000;

/** The exact shape the mobile compose screen sends today. */
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
  photos: [{ url: 'https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg', uploadedAt: 1 }],
  documentUrls: { insuranceProof: '', vehicleRegistration: '' },
  ownerName: 'Ali',
  ownerPhone: '03001234567',
};

describe('applicationSchema', () => {
  it('accepts what the app sends, including a blank year (parseInt → null)', () => {
    expect(applicationSchema.safeParse(fromApp).success).toBe(true);
    const blankYear = { ...fromApp, carDetails: { ...fromApp.carDetails, year: null } };
    expect(applicationSchema.safeParse(blankYear).success).toBe(true);
  });

  it('strips keys nobody asked for instead of storing them', () => {
    const parsed = applicationSchema.parse({ ...fromApp, status: 'approved', uid: 'someone-else' });
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('uid');
  });

  it('refuses non-https photo URLs and out-of-range prices', () => {
    expect(applicationSchema.safeParse({ ...fromApp, photos: [{ url: 'javascript:alert(1)', uploadedAt: 1 }] }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...fromApp, pricePerDay: 50 }).success).toBe(false);
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
