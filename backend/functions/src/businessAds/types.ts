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

/** Plans are sold in whole-month blocks. */
export type BusinessAdPlanMonths = 3 | 6 | 12;

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
 * One pricing band. `maxRadiusKm` is inclusive: a band of 3 covers 1–3 km, and
 * the next band up covers everything above 3 to its own ceiling.
 */
export interface BusinessAdTier {
  key: string;
  maxRadiusKm: number;
  monthlyFee: number;
  /** How many ads may be live at once on this band. */
  adSlots: number;
}
