/**
 * Special Rides (Rent-a-Car) — daily vehicle rental platform
 *
 * Users can post their cars for daily rental with or without drivers.
 * Admin reviews and approves applications. Bookings flow between hosts and renters.
 */
export {
  submitSpecialRidesApplication,
  adminReviewSpecialRidesApplication,
  getSpecialRidesDashboard,
  adminSuspendHost,
} from './applications';

export {
  getSpecialRidesListings,
  getSpecialRidesListingDetails,
  updateSpecialRidesApplication,
  deleteSpecialRidesListing,
  bookSpecialRidesCar,
  confirmSpecialRidesBooking,
  cancelSpecialRidesBooking,
} from './listings';
