/**
 * Special Rides end to end, against the Firestore emulator.
 *
 * Pins down the three things that matter to people already using the app: an
 * application from app 1.12.0 (which cannot attach papers) is accepted, a car
 * cannot go live without its papers, and the papers never reach the listing
 * that every signed-in user can read.
 */
import type * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { adminReviewSpecialRidesApplication, submitSpecialRidesApplication } from '../applications';
import {
  bookSpecialRidesCar,
  getSpecialRidesListingDetails,
  getSpecialRidesListings,
} from '../listings';

const HOST = 'sr-host';
const RENTER = 'sr-renter';
const ADMIN = 'sr-admin';
const DAY = 24 * 60 * 60 * 1000;
const STORAGE = 'https://firebasestorage.googleapis.com/v0/b/velocity-fe379.appspot.com/o/';

function adminReq<T>(data: T): CallableRequest<T> {
  return {
    data,
    auth: { uid: ADMIN, token: { uid: ADMIN, role: 'admin' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

/** Exactly what compose.tsx in app 1.12.0 sends. */
const FROM_1_12 = {
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
  photos: [{ url: `${STORAGE}travelMateChat%2Fsr-host%2Fcar.jpg?alt=media`, uploadedAt: 1 }],
  documentUrls: { insuranceProof: '', vehicleRegistration: '' },
  ownerName: 'Ali',
  ownerPhone: '03001234567',
};

/** What the updated app sends. */
const WITH_PAPERS = {
  ...FROM_1_12,
  documentUrls: {
    insuranceProof: `${STORAGE}specialRides%2Fsr-host%2Fdocuments%2Finsurance-1?alt=media`,
    vehicleRegistration: `${STORAGE}specialRides%2Fsr-host%2Fdocuments%2Fregistration-1?alt=media`,
  },
};

const application = () => db().doc(`specialRidesApplications/${HOST}`).get();
const listing = () => db().doc(`specialRidesListings/${HOST}`).get();

beforeEach(async () => {
  await clearFirestore();
});

describe('Special Rides', () => {
  it('accepts an application from app 1.12.0, which cannot attach papers', async () => {
    await expect(submitSpecialRidesApplication.run(makeReq(FROM_1_12, HOST))).resolves.toMatchObject({ ok: true });
    expect((await application()).get('status')).toBe('pending');
  });

  it('will not approve a car without both papers', async () => {
    await submitSpecialRidesApplication.run(makeReq(FROM_1_12, HOST));
    await expect(
      adminReviewSpecialRidesApplication.run(adminReq({ uid: HOST, decision: 'approve' })),
    ).rejects.toThrow(/documents/);
    expect((await listing()).exists).toBe(false);
    expect((await application()).get('status')).toBe('pending');
  });

  it('lets the admin ask for the papers, and the host resubmit with them', async () => {
    await submitSpecialRidesApplication.run(makeReq(FROM_1_12, HOST));
    await adminReviewSpecialRidesApplication.run(
      adminReq({ uid: HOST, decision: 'resubmit', rejectionReason: 'Add your papers' }),
    );
    expect((await application()).get('status')).toBe('resubmit');

    await submitSpecialRidesApplication.run(makeReq(WITH_PAPERS, HOST));
    const resubmitted = await application();
    expect(resubmitted.get('status')).toBe('pending');
    expect(resubmitted.get('documentUrls.insuranceProof')).toContain('insurance');
  });

  it('approves with papers, and the papers never reach the public listing', async () => {
    await submitSpecialRidesApplication.run(makeReq(WITH_PAPERS, HOST));
    await adminReviewSpecialRidesApplication.run(adminReq({ uid: HOST, decision: 'approve' }));

    const live = await listing();
    expect(live.get('status')).toBe('active');
    expect(live.get('documentUrls')).toBeUndefined();
    // Still on the application, which only the host and admins can read.
    expect((await application()).get('documentUrls.vehicleRegistration')).toContain('registration');

    const browse = await getSpecialRidesListings.run(makeReq({ page: 0 }, RENTER));
    expect(browse.listings).toHaveLength(1);
    expect(browse.listings[0]).not.toHaveProperty('documentUrls');
    expect(browse.listings[0].ownerPhone).toBe('03001234567');
  });

  it('strips papers from a listing approved before the fix', async () => {
    await db()
      .doc(`specialRidesListings/${HOST}`)
      .set({ ...WITH_PAPERS, uid: HOST, listingId: 'L1', status: 'active' });

    const details = await getSpecialRidesListingDetails.run(
      makeReq({ listingId: 'L1', hostUid: HOST }, RENTER),
    );
    expect(details.listing).not.toHaveProperty('documentUrls');
    expect(details.listing.ownerPhone).toBe('03001234567');
  });

  it('refuses papers hosted anywhere but our storage, in words', async () => {
    const outside = {
      ...WITH_PAPERS,
      documentUrls: { ...WITH_PAPERS.documentUrls, insuranceProof: 'https://evil.example/ins.jpg' },
    };
    await expect(submitSpecialRidesApplication.run(makeReq(outside, HOST))).rejects.toThrow(
      'Please add the insurance photo again.',
    );
  });

  it('books a live car at the listed price', async () => {
    await submitSpecialRidesApplication.run(makeReq(WITH_PAPERS, HOST));
    await adminReviewSpecialRidesApplication.run(adminReq({ uid: HOST, decision: 'approve' }));

    const pickupDate = Date.now() + DAY;
    const res = (await bookSpecialRidesCar.run(
      makeReq(
        {
          listingId: (await listing()).get('listingId'),
          hostUid: HOST,
          pickupDate,
          returnDate: pickupDate + 2 * DAY,
          includeDriver: false,
        },
        RENTER,
      ),
    )) as { totalPrice: number };
    expect(res.totalPrice).toBe(10_000);
  });

  it('does not let a host book their own car', async () => {
    await submitSpecialRidesApplication.run(makeReq(WITH_PAPERS, HOST));
    await adminReviewSpecialRidesApplication.run(adminReq({ uid: HOST, decision: 'approve' }));

    const pickupDate = Date.now() + DAY;
    await expect(
      bookSpecialRidesCar.run(
        makeReq(
          {
            listingId: (await listing()).get('listingId'),
            hostUid: HOST,
            pickupDate,
            returnDate: pickupDate + DAY,
          },
          HOST,
        ),
      ),
    ).rejects.toThrow(/own car/);
  });
});
