/**
 * Where a notification leads, from the `data` it was sent with.
 *
 * One table for both ways of tapping a notification: the phone's own tray
 * (app/_layout.tsx) and the in-app Notifications list, which stores the same
 * fields on each item. Before this the in-app list only marked things read, so
 * a business reply opened from there went nowhere.
 *
 * Returns null for a notification that has nowhere to go.
 */
export function routeForNotification(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const str = (k: string) => (typeof data[k] === 'string' && data[k] ? (data[k] as string) : null);
  const screen = str('screen');

  if (screen === 'request-detail' && str('tripId')) return `/driver/request-detail/${str('tripId')}`;
  // Daily-route pool alert → straight to the join screen for that pool.
  if (screen === 'pool-join' && str('code')) return `/passenger/pool-join/${str('code')}`;
  // The "see it on your phone" demo. No adId, no click to record — it is the
  // sample offer, rendered from a constant.
  if (screen === 'business-offer-demo') return '/passenger/offer/demo';
  // A nearby business offer. Opening this screen is the tap the advertiser is
  // paying to measure, so it must land on the offer and nowhere else.
  if (screen === 'business-offer' && str('adId')) return `/passenger/offer/${str('adId')}`;
  // A question about an offer (to the business) or its answer (to the
  // customer). The same conversation screen serves both sides.
  if (screen === 'business-query' && str('queryId')) return `/passenger/offer-query/${str('queryId')}`;
  if (screen === 'business-ads') return '/passenger/business-ads';
  // A scheduled ride that has just gone looking for a driver. The rider's whole
  // reason for tapping is to watch it get picked up, and until now the tap did
  // nothing at all — the notification was sent with a screen this table had
  // never been told about (backend: scheduledRides/index.ts).
  if (screen === 'trip' && str('tripId')) return `/passenger/trip/${str('tripId')}`;
  // "Booking Confirmed 🎉" for a city-to-city seat. The id in the payload is the
  // BOOKING id, which is what /passenger/intercity-trip/[id] takes — the same
  // id city-to-city.tsx pushes on after booking (backend: intercity/index.ts).
  if (screen === 'intercityTrip' && str('bookingId')) {
    return `/passenger/intercity-trip/${str('bookingId')}`;
  }
  return null;
}
