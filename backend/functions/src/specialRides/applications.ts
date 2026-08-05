import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  query,
  where,
  getDocs,
  updateDoc,
  serverTimestamp,
  FieldValue,
} from 'firebase-admin/firestore';

import { db, auth } from '../lib/firebase';
import { invalid } from '../lib/errors';
import { SpecialRidesApplication, SpecialRidesListing } from './types';

/**
 * Submit a new car for rent listing (goes to pending approval)
 */
export const submitSpecialRidesApplication = onCall(
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) invalid('Not authenticated');

    const {
      carDetails,
      location,
      pricePerDay,
      photos,
      documentUrls,
      ownerName,
      ownerPhone,
      instructions,
    } = request.data;

    if (!carDetails?.make || !carDetails?.model) {
      invalid('Car details (make, model) are required');
    }
    if (!documentUrls?.insuranceProof || !documentUrls?.vehicleRegistration) {
      invalid('Insurance proof and vehicle registration are required');
    }
    if (!location?.address || !location?.city) {
      invalid('Location and city are required');
    }
    if (pricePerDay < 500 || pricePerDay > 10000) {
      invalid('Price per day must be between 500 and 10,000 PKR');
    }
    if (!photos || photos.length === 0) {
      invalid('At least one photo is required');
    }

    const applicationId = doc(collection(db, 'specialRidesApplications')).id;
    const now = Date.now();

    const application: SpecialRidesApplication = {
      applicationId,
      uid,
      status: 'pending',
      carDetails,
      location,
      pricePerDay,
      photos,
      documentUrls,
      ownerName,
      ownerPhone,
      instructions,
      submittedAt: now,
    };

    await setDoc(
      doc(db, 'specialRidesApplications', uid),
      application,
      { merge: true }
    );

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
    const adminUid = request.auth?.uid;
    if (!adminUid) invalid('Not authenticated');

    // Check if user is admin
    const adminSnap = await getDoc(doc(db, 'admins', adminUid));
    if (!adminSnap.exists()) invalid('Not authorized to review applications');

    const { uid, decision, rejectionReason, maxDailyRate } = request.data;

    if (!['approve', 'reject', 'resubmit'].includes(decision)) {
      invalid('Invalid decision');
    }

    // Get the application
    const appSnap = await getDoc(
      doc(db, 'specialRidesApplications', uid)
    );
    if (!appSnap.exists()) invalid('Application not found');

    const app = appSnap.data() as SpecialRidesApplication;
    const now = Date.now();

    if (decision === 'approve') {
      // Create active listing
      const listingId = doc(collection(db, 'specialRidesListings')).id;
      const listing: SpecialRidesListing = {
        ...app,
        listingId,
        status: 'active',
        approvedAt: now,
        approvedBy: adminUid,
        availableSince: now,
        availableUntil: now + 365 * 24 * 60 * 60 * 1000, // 1 year
        pricePerDay: maxDailyRate || app.pricePerDay,
      };

      await setDoc(doc(db, 'specialRidesListings', uid), listing, {
        merge: true,
      });

      // Update application status
      await updateDoc(doc(db, 'specialRidesApplications', uid), {
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
      await updateDoc(doc(db, 'specialRidesApplications', uid), {
        status: 'rejected',
        reviewedAt: now,
        reviewedBy: adminUid,
        rejectionReason,
      });

      return {
        ok: true,
        status: 'rejected',
        message: 'Application rejected',
      };
    } else if (decision === 'resubmit') {
      await updateDoc(doc(db, 'specialRidesApplications', uid), {
        status: 'resubmit',
        reviewedAt: now,
        reviewedBy: adminUid,
        rejectionReason,
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
  const uid = request.auth?.uid;
  if (!uid) invalid('Not authenticated');

  // Check for pending applications
  const appSnap = await getDoc(doc(db, 'specialRidesApplications', uid));
  if (appSnap.exists()) {
    const app = appSnap.data() as SpecialRidesApplication;
    const stage = app.status === 'pending'
      ? 'pending'
      : app.status === 'rejected' || app.status === 'resubmit'
      ? 'rejected'
      : 'none';

    return {
      ok: true,
      stage,
      applications: appSnap.exists() ? [app] : [],
      activeListings: [],
    };
  }

  // Check for active listings
  const listingSnap = await getDoc(doc(db, 'specialRidesListings', uid));
  if (listingSnap.exists()) {
    const listing = listingSnap.data() as SpecialRidesListing;
    const stage =
      listing.status === 'suspended'
        ? 'suspended'
        : listing.status === 'active'
        ? 'active'
        : 'none';

    // Get bookings stats
    const bookingsSnap = await getDocs(
      query(
        collection(db, 'specialRidesBookings'),
        where('hostUid', '==', uid)
      )
    );

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
  const adminUid = request.auth?.uid;
  if (!adminUid) invalid('Not authenticated');

  // Check if user is admin
  const adminSnap = await getDoc(doc(db, 'admins', adminUid));
  if (!adminSnap.exists()) invalid('Not authorized');

  const { uid, suspended, reason } = request.data;
  const now = Date.now();

  if (suspended) {
    await updateDoc(doc(db, 'specialRidesListings', uid), {
      status: 'suspended',
      suspendedAt: now,
      suspensionReason: reason,
    });
  } else {
    await updateDoc(doc(db, 'specialRidesListings', uid), {
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
