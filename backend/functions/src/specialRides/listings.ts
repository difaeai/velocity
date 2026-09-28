import { onCall } from 'firebase-functions/v2/https';

import { db } from '../lib/firebase';
import { invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import {
  applicationUpdateSchema,
  bookingRefSchema,
  bookingSchema,
  listingRefSchema,
  listingsQuerySchema,
  parseOrInvalid,
} from './schemas';
import { SpecialRidesListing, SpecialRidesBooking } from './types';

/**
 * What a renter may see of a listing. Listings approved before the approval
 * step stopped copying them may still carry the host's insurance and
 * registration papers; those never leave the server through here.
 */
function toPublicListing(listing: SpecialRidesListing): SpecialRidesListing {
  const { documentUrls: _privateDocs, ...rest } = listing as SpecialRidesListing & {
    documentUrls?: unknown;
  };
  return rest as SpecialRidesListing;
}

/**
 * Get all active special rides listings (public listing)
 */
export const getSpecialRidesListings = onCall(async (request) => {
  const { uid } = requireAuth(request);
  await rateLimit(uid, 'specialRidesBrowse', 120, 600);
  const { city, maxPrice, page } = parseOrInvalid(listingsQuerySchema, request.data, invalid);

  const snaps = await db
    .collection('specialRidesListings')
    .where('status', '==', 'active')
    .get();
  let listings = snaps.docs.map((doc) => toPublicListing(doc.data() as SpecialRidesListing));

  // Client-side filtering (alternative: use composite indexes for server-side)
  if (city) {
    listings = listings.filter((l) => l.location.city.toLowerCase() === city.toLowerCase());
  }
  if (maxPrice) {
    listings = listings.filter((l) => l.pricePerDay <= maxPrice);
  }

  const pageSize = 20;
  const paged = listings.slice(page * pageSize, (page + 1) * pageSize);

  return {
    ok: true,
    listings: paged,
    total: listings.length,
    hasMore: (page + 1) * pageSize < listings.length,
  };
});

/**
 * Get details of a specific listing
 */
export const getSpecialRidesListingDetails = onCall(async (request) => {
  const { uid } = requireAuth(request);
  await rateLimit(uid, 'specialRidesBrowse', 120, 600);
  const { listingId, hostUid } = parseOrInvalid(listingRefSchema, request.data, invalid);

  const snap = await db.collection('specialRidesListings').doc(hostUid).get();
  if (!snap.exists) {
    invalid('Listing not found');
  }

  const listing = snap.data() as SpecialRidesListing;
  if (listing.listingId !== listingId) {
    invalid('Listing not found');
  }

  return {
    ok: true,
    listing: toPublicListing(listing),
  };
});

/**
 * Update a pending application (before approval)
 */
export const updateSpecialRidesApplication = onCall(async (request) => {
  const { uid } = requireAuth(request);
  await rateLimit(uid, 'specialRidesUpdate', 20, 3600);

  const {
    carDetails,
    location,
    pricePerDay,
    photos,
    documentUrls,
    ownerName,
    ownerPhone,
    instructions,
  } = parseOrInvalid(applicationUpdateSchema, request.data, invalid);

  const appSnap = await db.collection('specialRidesApplications').doc(uid).get();
  if (!appSnap.exists) {
    invalid('Application not found');
  }

  const app = appSnap.data() as any;
  if (!app || (app.status !== 'pending' && app.status !== 'resubmit')) {
    invalid('Cannot edit approved or rejected applications');
  }

  const updates: any = {
    updatedAt: Date.now(),
  };

  if (carDetails) updates.carDetails = carDetails;
  if (location) updates.location = location;
  if (pricePerDay) updates.pricePerDay = pricePerDay;
  if (photos) updates.photos = photos;
  if (documentUrls) updates.documentUrls = documentUrls;
  if (ownerName) updates.ownerName = ownerName;
  if (ownerPhone) updates.ownerPhone = ownerPhone;
  if (instructions !== undefined) updates.instructions = instructions;

  // Reset to pending if it was resubmit
  if (app && app.status === 'resubmit') {
    updates.status = 'pending';
  }

  await db.collection('specialRidesApplications').doc(uid).update(updates);

  return {
    ok: true,
    message: 'Application updated',
  };
});

/**
 * Delete a pending application or listing
 */
export const deleteSpecialRidesListing = onCall(async (request) => {
  const { uid } = requireAuth(request);
  await rateLimit(uid, 'specialRidesDelete', 10, 3600);

  // Check if there's an application
  const appSnap = await db.collection('specialRidesApplications').doc(uid).get();
  if (appSnap.exists) {
    const app = appSnap.data();
    if (app?.status === 'pending' || app?.status === 'resubmit') {
      await db.collection('specialRidesApplications').doc(uid).delete();
      return { ok: true, message: 'Application deleted' };
    }
  }

  // Check if there's an active listing
  const listingSnap = await db.collection('specialRidesListings').doc(uid).get();
  if (listingSnap.exists) {
    const listing = listingSnap.data();
    if (listing?.status === 'active' || listing?.status === 'suspended') {
      await db
        .collection('specialRidesListings')
        .doc(uid)
        .update({
          status: 'deleted',
        });
      return { ok: true, message: 'Listing deleted' };
    }
  }

  invalid('No listing found to delete');
});

/**
 * Book a special rides car
 */
export const bookSpecialRidesCar = onCall(async (request) => {
  const { uid } = requireAuth(request);
  await rateLimit(uid, 'specialRidesBook', 10, 3600);

  // Dates are checked for type, order and span in the schema — they used to be
  // taken as-is, so a non-numeric pair produced a NaN price on the booking.
  const {
    listingId,
    hostUid,
    pickupDate,
    returnDate,
    includeDriver,
  } = parseOrInvalid(bookingSchema, request.data, invalid);

  if (hostUid === uid) {
    invalid('You cannot book your own car');
  }

  // Get listing details
  const listingSnap = await db.collection('specialRidesListings').doc(hostUid).get();
  if (!listingSnap.exists) {
    invalid('Listing not found or host inactive');
  }

  const listing = listingSnap.data() as SpecialRidesListing;
  if (listing?.status !== 'active' || listing.listingId !== listingId) {
    invalid('This listing is not available for booking');
  }

  // Calculate total price
  const days = Math.ceil((returnDate - pickupDate) / (24 * 60 * 60 * 1000));
  let totalPrice = days * (listing?.pricePerDay || 0);
  let driverPrice: number | undefined;

  if (includeDriver) {
    driverPrice = days * 1000; // 1000 PKR per day for driver
    totalPrice += driverPrice;
  }

  // Create booking
  const bookingId = db.collection('specialRidesBookings').doc().id;
  const booking: SpecialRidesBooking = {
    bookingId,
    uid,
    hostUid,
    listingId,
    status: 'pending',
    pickupDate,
    returnDate,
    totalPrice,
    includeDriver,
    driverPrice,
    createdAt: Date.now(),
  };

  await db.collection('specialRidesBookings').doc(bookingId).set(booking);

  return {
    ok: true,
    bookingId,
    totalPrice,
    message: 'Booking created. Awaiting host confirmation.',
  };
});

/**
 * Confirm a booking (host action)
 */
export const confirmSpecialRidesBooking = onCall(async (request) => {
  const { uid } = requireAuth(request);
  await rateLimit(uid, 'specialRidesBookingAction', 30, 3600);

  const { bookingId } = parseOrInvalid(bookingRefSchema, request.data, invalid);

  const bookingSnap = await db.collection('specialRidesBookings').doc(bookingId).get();
  if (!bookingSnap.exists) {
    invalid('Booking not found');
  }

  const booking = bookingSnap.data() as SpecialRidesBooking;
  if (booking?.hostUid !== uid) {
    invalid('Only the host can confirm this booking');
  }
  if (booking?.status !== 'pending') {
    invalid('Booking is not in pending state');
  }

  await db
    .collection('specialRidesBookings')
    .doc(bookingId)
    .update({
      status: 'confirmed',
      confirmedAt: Date.now(),
    });

  return {
    ok: true,
    message: 'Booking confirmed',
  };
});

/**
 * Cancel a booking
 */
export const cancelSpecialRidesBooking = onCall(async (request) => {
  const { uid } = requireAuth(request);
  await rateLimit(uid, 'specialRidesBookingAction', 30, 3600);

  const { bookingId, reason } = parseOrInvalid(bookingRefSchema, request.data, invalid);

  const bookingSnap = await db.collection('specialRidesBookings').doc(bookingId).get();
  if (!bookingSnap.exists) {
    invalid('Booking not found');
  }

  const booking = bookingSnap.data() as SpecialRidesBooking;
  if (booking?.uid !== uid && booking?.hostUid !== uid) {
    invalid('You do not have permission to cancel this booking');
  }
  if (booking?.status === 'completed' || booking?.status === 'cancelled') {
    invalid('This booking cannot be cancelled');
  }

  await db
    .collection('specialRidesBookings')
    .doc(bookingId)
    .update({
      status: 'cancelled',
      cancelledAt: Date.now(),
      cancellationReason: reason ?? null,
    });

  return {
    ok: true,
    message: 'Booking cancelled',
  };
});
