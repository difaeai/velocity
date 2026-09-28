import { onCall } from 'firebase-functions/v2/https';

import { db } from '../lib/firebase';
import { invalid, requireAdmin, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { applicationSchema, parseOrInvalid, reviewSchema, suspendSchema } from './schemas';
import { SpecialRidesApplication, SpecialRidesListing } from './types';

/**
 * Submit a new car for rent listing (goes to pending approval)
 */
export const submitSpecialRidesApplication = onCall(
  async (request) => {
    const { uid } = requireAuth(request);
    await rateLimit(uid, 'specialRidesSubmit', 5, 3600);

    const {
      carDetails,
      location,
      pricePerDay,
      photos,
      documentUrls,
      ownerName,
      ownerPhone,
      instructions,
    } = parseOrInvalid(applicationSchema, request.data, invalid);

    if (!documentUrls.insuranceProof || !documentUrls.vehicleRegistration) {
      invalid('Insurance proof and vehicle registration are required');
    }

    const applicationId = db.collection('specialRidesApplications').doc().id;
    const now = Date.now();

    const application: SpecialRidesApplication = {
      applicationId,
      uid,
      status: 'pending',
      carDetails: carDetails as SpecialRidesApplication['carDetails'],
      location: location as SpecialRidesApplication['location'],
      pricePerDay,
      photos,
      documentUrls,
      ownerName,
      ownerPhone,
      ...(instructions ? { instructions } : {}),
      submittedAt: now,
    };

    await db
      .collection('specialRidesApplications')
      .doc(uid)
      .set(application, { merge: true });

    return {
      ok: true,
      applicationId,
      message: 'Application submitted. Admin review pending.',
    };
  }
);

/**
 * Admin reviews and approves/rejects a special rides application
 */
export const adminReviewSpecialRidesApplication = onCall(
  async (request) => {
    // Admin is a custom claim, set only by the backend (users/setUserRole) and
    // read from the ID token — the same thing `isAdmin()` checks in the
    // Firestore rules and every other admin callable uses.
    //
    // This used to look for a document in an `admins` collection. No code has
    // ever written to that collection and the rules deny every client write to
    // it, so it is always empty: a real admin, holding the claim the console
    // signs them in with, was refused here every single time. Approving a car
    // listing was unreachable.
    const { uid: adminUid } = requireAdmin(request);

    const { uid, decision, rejectionReason, maxDailyRate } = parseOrInvalid(reviewSchema, request.data, invalid);

    // Get the application
    const appSnap = await db.collection('specialRidesApplications').doc(uid).get();
    if (!appSnap.exists) invalid('Application not found');

    const app = appSnap.data() as SpecialRidesApplication;
    const now = Date.now();

    if (decision === 'approve') {
      // Create active listing
      // The insurance and registration papers stay on the application, which
      // only the owner and admins can read. The listing is readable by every
      // signed-in user, so it must not carry them.
      const { documentUrls: _privateDocs, ...publicApp } = app;
      const listingId = db.collection('specialRidesListings').doc().id;
      const listing = {
        ...publicApp,
        listingId,
        status: 'active',
        approvedAt: now,
        approvedBy: adminUid,
        availableSince: now,
        availableUntil: now + 365 * 24 * 60 * 60 * 1000, // 1 year
        pricePerDay: maxDailyRate || app.pricePerDay,
      };

      await db
        .collection('specialRidesListings')
        .doc(uid)
        .set(listing, { merge: true });

      // Update application status
      await db
        .collection('specialRidesApplications')
        .doc(uid)
        .update({
          status: 'approved',
          reviewedAt: now,
          reviewedBy: adminUid,
        });

      return {
        ok: true,
        status: 'approved',
        message: 'Listing approved and activated',
      };
    } else if (decision === 'reject') {
      await db
        .collection('specialRidesApplications')
        .doc(uid)
        .update({
          status: 'rejected',
          reviewedAt: now,
          reviewedBy: adminUid,
          rejectionReason: rejectionReason ?? null,
        });

      return {
        ok: true,
        status: 'rejected',
        message: 'Application rejected',
      };
    } else if (decision === 'resubmit') {
      await db
        .collection('specialRidesApplications')
        .doc(uid)
        .update({
          status: 'resubmit',
          reviewedAt: now,
          reviewedBy: adminUid,
          rejectionReason: rejectionReason ?? null,
        });

      return {
        ok: true,
        status: 'resubmit',
        message: 'Application marked for resubmission',
      };
    }

    return { ok: false };
  }
);

/**
 * Get dashboard data for a host (user who posted cars)
 */
export const getSpecialRidesDashboard = onCall(async (request) => {
  const { uid } = requireAuth(request);

  // Check for pending applications
  const appSnap = await db.collection('specialRidesApplications').doc(uid).get();
  if (appSnap.exists) {
    const app = appSnap.data() as SpecialRidesApplication;
    const stage = app.status === 'pending'
      ? 'pending'
      : app.status === 'rejected' || app.status === 'resubmit'
      ? 'rejected'
      : 'none';

    return {
      ok: true,
      stage,
      applications: appSnap.exists ? [app] : [],
      activeListings: [],
    };
  }

  // Check for active listings
  const listingSnap = await db.collection('specialRidesListings').doc(uid).get();
  if (listingSnap.exists) {
    const listing = listingSnap.data() as SpecialRidesListing;
    const stage =
      listing.status === 'suspended'
        ? 'suspended'
        : listing.status === 'active'
        ? 'active'
        : 'none';

    // Get bookings stats
    const bookingsSnap = await db
      .collection('specialRidesBookings')
      .where('hostUid', '==', uid)
      .get();

    const totalBookings = bookingsSnap.size;
    let totalEarnings = 0;
    bookingsSnap.forEach((doc) => {
      const booking = doc.data();
      if (booking.status === 'completed') {
        totalEarnings += booking.totalPrice || 0;
      }
    });

    return {
      ok: true,
      stage,
      applications: [],
      activeListings: [listing],
      totalBookings,
      totalEarnings,
    };
  }

  return {
    ok: true,
    stage: 'none',
    applications: [],
    activeListings: [],
  };
});

/**
 * Admin can suspend a host's listing
 */
export const adminSuspendHost = onCall(async (request) => {
  // Same claim-based check as the review callable above — see the note there
  // about the `admins` collection this used to consult.
  requireAdmin(request);

  const { uid, suspended, reason } = parseOrInvalid(suspendSchema, request.data, invalid);
  const now = Date.now();

  if (suspended) {
    await db
      .collection('specialRidesListings')
      .doc(uid)
      .update({
        status: 'suspended',
        suspendedAt: now,
        suspensionReason: reason ?? null,
      });
  } else {
    await db
      .collection('specialRidesListings')
      .doc(uid)
      .update({
        status: 'active',
        suspendedAt: null,
        suspensionReason: null,
      });
  }

  return {
    ok: true,
    message: suspended ? 'Listing suspended' : 'Listing reactivated',
  };
});
