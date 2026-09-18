import { describe, expect, it } from 'vitest';

import { routeForNotification } from '../notificationRoute';

describe('routeForNotification', () => {
  it('opens a Queries conversation for both the question and the reply', () => {
    expect(routeForNotification({ screen: 'business-query', queryId: 'ad1_uid9' })).toBe(
      '/passenger/offer-query/ad1_uid9',
    );
  });

  it('keeps the existing routes', () => {
    expect(routeForNotification({ screen: 'business-offer', adId: 'ad1' })).toBe('/passenger/offer/ad1');
    expect(routeForNotification({ screen: 'business-offer-demo' })).toBe('/passenger/offer/demo');
    expect(routeForNotification({ screen: 'pool-join', code: 'ABC' })).toBe('/passenger/pool-join/ABC');
    expect(routeForNotification({ screen: 'request-detail', tripId: 't1' })).toBe('/driver/request-detail/t1');
    expect(routeForNotification({ screen: 'business-ads' })).toBe('/passenger/business-ads');
  });

  /**
   * These two were sent by the backend and handled by nobody: tapping either
   * notification did nothing at all. The payload shapes below are copied from
   * the call sites, so a rename on either side fails here rather than in a
   * user's notification shade.
   */
  it('opens a scheduled ride that has gone looking for a driver', () => {
    // backend/functions/src/scheduledRides/index.ts → { tripId, screen: 'trip' }
    expect(routeForNotification({ screen: 'trip', tripId: 't7' })).toBe('/passenger/trip/t7');
  });

  it('opens the city-to-city booking a confirmation belongs to', () => {
    // backend/functions/src/intercity/index.ts → { bookingId, screen: 'intercityTrip' }
    expect(routeForNotification({ screen: 'intercityTrip', bookingId: 'b3' })).toBe(
      '/passenger/intercity-trip/b3',
    );
  });

  it('goes nowhere when the id it needs is missing', () => {
    expect(routeForNotification({ screen: 'business-query' })).toBeNull();
    expect(routeForNotification({ screen: 'trip' })).toBeNull();
    expect(routeForNotification({ screen: 'intercityTrip' })).toBeNull();
    expect(routeForNotification({ screen: 'business-offer', adId: '' })).toBeNull();
    expect(routeForNotification({ title: 'Welcome' })).toBeNull();
    expect(routeForNotification(null)).toBeNull();
  });

  it('ignores non-string fields from a Firestore notification item', () => {
    expect(routeForNotification({ screen: 'business-query', queryId: 42, read: false })).toBeNull();
  });
});
