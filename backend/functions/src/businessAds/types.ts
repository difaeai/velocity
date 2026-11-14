/**
 * "Find your Customers" — business proximity advertising.
 * ----------------------------------------------------------------------------
 * A shop owner pays for the right to push one offer to Velocity users who come
 * within a few kilometres of their door. Everything here is either money or a
 * push notification aimed at real people, so nothing in this module is
 * client-writable and every quantity a client could lie about (radius, slots,
 * price, expiry, notification counts) is re-derived server-side.
 * ----------------------------------------------------------------------------
 */

/** Where the application sits in the review queue. */
export type BusinessAdApplicationStatus = 'pending' | 'approved' | 'rejected' | 'resubmit';

/** The advertiser account minted at approval. */
export type BusinessAdvertiserStatus = 'active' | 'suspended' | 'expired';

/** A single ad creative. `removed` is a soft delete — the stats outlive the ad. */
export type BusinessAdStatus = 'active' | 'paused' | 'removed';

/** How the advertiser sent the money. Mirrors the partner-program rails. */
export type BusinessAdPaymentMethod = 'bank' | 'easypaisa' | 'jazzcash';

export interface GeoCenter {
  lat: number;
  lng: number;
  /** Precision-5 cell (~4.9 km), the coarse prefilter for the nearby query. */
  geohash: string;
  address: string | null;
}

/**
 * What one ad was sold for: the radius it reaches, the dollar price that radius
 * came to, and the rupees asked for at the day's rate (see businessAds/config).
 */
export interface BusinessAdQuote {
  radiusKm: number;
  priceUsd: number;
  pricePkr: number;
  /** Days the ad runs from approval. */
  planDays: number;
}
