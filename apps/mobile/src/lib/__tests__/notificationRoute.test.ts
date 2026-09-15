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

  it('goes nowhere when the id it needs is missing', () => {
    expect(routeForNotification({ screen: 'business-query' })).toBeNull();
    expect(routeForNotification({ screen: 'business-offer', adId: '' })).toBeNull();
    expect(routeForNotification({ title: 'Welcome' })).toBeNull();
    expect(routeForNotification(null)).toBeNull();
  });

  it('ignores non-string fields from a Firestore notification item', () => {
    expect(routeForNotification({ screen: 'business-query', queryId: 42, read: false })).toBeNull();
  });
});
