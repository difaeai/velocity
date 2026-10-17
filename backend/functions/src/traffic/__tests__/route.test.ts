/**
 * Matching an alert to a journey, and collapsing three papers into one fact.
 *
 * The route maths is the driver's whole feature: "is anything on MY way" is
 * only worth asking if the answer is about their road and not about their city.
 */
import { describe, expect, it } from 'vitest';

import { alertsOnRoute, dedupe } from '../functions';
import { alertIdFor, fingerprintFor } from '../ingest';
import type { TrafficAlert } from '../types';

/** Islamabad: roughly Zero Point → Faizabad, as a handful of points. */
const ISB_ROUTE = [
  { lat: 33.6840, lng: 73.0580 },
  { lat: 33.6750, lng: 73.0650 },
  { lat: 33.6680, lng: 73.0720 },
  { lat: 33.6601, lng: 73.0790 },
];

function alert(over: Partial<TrafficAlert> = {}): TrafficAlert {
  return {
    id: 'a',
    scope: 'city',
    cityCode: 'ISB',
    cityName: 'Islamabad · Rawalpindi',
    kind: 'closure',
    severity: 'high',
    headline: 'Something closed',
    detail: null,
    roads: ['Faizabad Interchange'],
    places: [{ name: 'Faizabad Interchange', lat: 33.6601, lng: 73.0790, radiusM: 2000 }],
    source: { id: 'dawn', name: 'Dawn', url: 'https://www.dawn.com/news/1' },
    publishedAt: 1_760_000_000_000,
    // No stated hours, so the kind's own lifetime is the window — see
    // `window.ts`. The route maths below does not care when an alert runs, only
    // where it is, so every fixture here uses the plain fallback.
    window: {
      startsAt: 1_760_000_000_000,
      endsAt: 1_760_086_400_000,
      basis: 'kind',
      phrase: null,
    },
    expiresAt: 1_760_086_400_000,
    createdAt: 1_760_000_000_000,
    ...over,
  };
}

describe('alertsOnRoute', () => {
  it('finds an alert sitting on the route, and says how far in', () => {
    const [hit] = alertsOnRoute([alert()], ISB_ROUTE);
    expect(hit).toBeDefined();
    expect(hit!.offsetM).toBeLessThan(500);
    // Faizabad is the far end of this route, so it is most of the way along.
    expect(hit!.alongM).toBeGreaterThan(1000);
  });

  it('ignores an alert in the same city but nowhere near the route', () => {
    const karachiFar = alert({
      places: [{ name: 'Shahrah-e-Faisal', lat: 24.8650, lng: 67.0750, radiusM: 9000 }],
    });
    expect(alertsOnRoute([karachiFar], ISB_ROUTE)).toHaveLength(0);
  });

  it('never matches an alert that carries no coordinates', () => {
    // "Roads blocked across Lahore" has nothing to be near. It belongs on the
    // city strip, not pinned to a kilometre of somebody's journey.
    expect(alertsOnRoute([alert({ places: [], roads: [] })], ISB_ROUTE)).toHaveLength(0);
  });

  it('returns them in driving order, not by how bad they are', () => {
    const near = alert({
      id: 'near',
      severity: 'low',
      places: [{ name: 'Zero Point', lat: 33.6840, lng: 73.0580, radiusM: 2000 }],
    });
    const far = alert({ id: 'far', severity: 'high' });
    expect(alertsOnRoute([far, near], ISB_ROUTE).map((a) => a.id)).toEqual(['near', 'far']);
  });

  it('honours the alert’s own radius, because a road is a line we store as a circle', () => {
    // Same centre, but a radius so small the route no longer reaches it.
    const pinpoint = alert({
      places: [{ name: 'Somewhere', lat: 33.72, lng: 73.14, radiusM: 10 }],
    });
    const wide = alert({
      places: [{ name: 'Somewhere', lat: 33.72, lng: 73.14, radiusM: 9000 }],
    });
    expect(alertsOnRoute([pinpoint], ISB_ROUTE)).toHaveLength(0);
    expect(alertsOnRoute([wide], ISB_ROUTE)).toHaveLength(1);
  });
});

describe('dedupe', () => {
  const sameEvent = (over: Partial<TrafficAlert> & { fingerprint: string }) => ({
    ...alert(over),
    fingerprint: over.fingerprint,
  });

  it('keeps the most severe telling of one event', () => {
    const kept = dedupe([
      sameEvent({ id: 'geo', severity: 'low', fingerprint: 'f' }),
      sameEvent({ id: 'dawn', severity: 'high', fingerprint: 'f' }),
      sameEvent({ id: 'tribune', severity: 'medium', fingerprint: 'f' }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe('dawn');
  });

  it('breaks a severity tie on the later story — a newer telling is a newer state', () => {
    const kept = dedupe([
      sameEvent({ id: 'old', publishedAt: 1_000, fingerprint: 'f' }),
      sameEvent({ id: 'new', publishedAt: 2_000, fingerprint: 'f' }),
    ]);
    expect(kept[0]!.id).toBe('new');
  });

  it('leaves genuinely different events alone', () => {
    expect(
      dedupe([sameEvent({ id: 'a', fingerprint: 'f1' }), sameEvent({ id: 'b', fingerprint: 'f2' })]),
    ).toHaveLength(2);
  });
});

describe('identity', () => {
  it('gives one story one id however its URL is cased or padded', () => {
    expect(alertIdFor('https://www.dawn.com/news/1')).toBe(
      alertIdFor('  HTTPS://WWW.DAWN.COM/news/1 '),
    );
  });

  it('gives two papers reporting one closure the same fingerprint', () => {
    const dawn = alert({ source: { id: 'dawn', name: 'Dawn', url: 'x' } });
    const geo = alert({ source: { id: 'geo', name: 'Geo News', url: 'y' } });
    expect(fingerprintFor(dawn)).toBe(fingerprintFor(geo));
  });

  it('separates the same road closing again on another day', () => {
    const monday = alert({ publishedAt: Date.parse('2026-10-13T09:00:00Z') });
    const friday = alert({ publishedAt: Date.parse('2026-10-17T09:00:00Z') });
    expect(fingerprintFor(monday)).not.toBe(fingerprintFor(friday));
  });
});
