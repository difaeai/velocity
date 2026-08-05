/**
 * Special Rides (Rent-a-Car) types and interfaces
 */

export type ListingStatus = 'pending' | 'approved' | 'active' | 'suspended';
export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

export interface CarDetails {
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  color: string;
  seatsCount: number;
  transmissionType: 'manual' | 'automatic';
  mileage: number;
  features: string[];
}

export interface Location {
  lat: number;
  lng: number;
  geohash?: string;
  address: string;
  city: string;
}

export interface SpecialRidesListing {
  listingId: string;
  uid: string;
  status: ListingStatus;
  carDetails: CarDetails;
  location: Location;
  pricePerDay: number;
  availableSince: number;
  availableUntil: number;
  photos: { url: string; uploadedAt: number }[];
  insuranceProofUrl: string;
  vehicleRegistrationUrl: string;
  ownerName: string;
  ownerPhone: string;
  instructions?: string;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  approvedBy?: string;
  suspendedAt?: number;
  suspensionReason?: string;
  totalBookings?: number;
  totalRating?: number;
  avgRating?: number;
}

export interface SpecialRidesApplication {
  applicationId: string;
  uid: string;
  status: 'pending' | 'approved' | 'rejected' | 'resubmit';
  carDetails: CarDetails;
  location: Location;
  pricePerDay: number;
  photos: { url: string; uploadedAt: number }[];
  documentUrls: {
    insuranceProof: string;
    vehicleRegistration: string;
  };
  ownerName: string;
  ownerPhone: string;
  instructions?: string;
  submittedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  rejectionReason?: string;
}

export interface SpecialRidesBooking {
  bookingId: string;
  uid: string;
  hostUid: string;
  listingId: string;
  status: BookingStatus;
  pickupDate: number;
  returnDate: number;
  totalPrice: number;
  includeDriver: boolean;
  driverPrice?: number;
  passengerDetails?: {
    name: string;
    phone: string;
  };
  createdAt: number;
  confirmedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  cancellationReason?: string;
}

export interface SpecialRidesDashboard {
  stage: 'none' | 'pending' | 'rejected' | 'active' | 'suspended';
  applications: SpecialRidesApplication[];
  activeListings: SpecialRidesListing[];
  rejectionReasons?: string[];
  totalBookings?: number;
  totalEarnings?: number;
}
