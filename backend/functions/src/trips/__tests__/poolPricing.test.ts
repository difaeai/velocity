/**
 * The maths of a shared car whose riders have their own stops: on the route or
 * not, the order of the stops, and what each rider pays (trips/poolPricing).
 */
import { describe, it, expect } from 'vitest';

import { orderStops, priceCar, priceInOrder, priceJoin, routeFit } from '../poolPricing';

// An east-west route, ~9.3 km: (33.70, 73.00) → (33.70, 73.10).
const ROUTE = { pickup: { lat: 33.7, lng: 73.0 }, dropoff: { lat: 33.7, lng: 73.1 } };

describe('routeFit — on the route, going the same way, over half of it', () => {
  it('takes a rider who boards 550 m off the line, mid-way, and gets out near the end', () => {
    const fit = routeFit(ROUTE, { lat: 33.705, lng: 73.03 }, { lat: 33.698, lng: 73.09 }, 1000);
    expect(fit).not.toBeNull();
    expect(fit!.pickupOffsetM).toBeGreaterThan(500);
    expect(fit!.pickupOffsetM).toBeLessThan(600);
    expect(fit!.alightM).toBeGreaterThan(fit!.boardM);
  });
  it('refuses a rider going the other way, however close they stand', () => {
    expect(routeFit(ROUTE, { lat: 33.7, lng: 73.09 }, { lat: 33.7, lng: 73.01 }, 1000)).toBeNull();
  });
  it('refuses a pickup 1.5 km off the route', () => {
    expect(routeFit(ROUTE, { lat: 33.7135, lng: 73.03 }, { lat: 33.7, lng: 73.09 }, 1000)).toBeNull();
  });
  it('refuses a short hop over a fifth of the route — unless only the direction is asked', () => {
    const hop = [{ lat: 33.7, lng: 73.02 }, { lat: 33.7, lng: 73.04 }] as const;
    expect(routeFit(ROUTE, hop[0], hop[1], 1000)).toBeNull();
    expect(routeFit(ROUTE, hop[0], hop[1], 1000, 0)).not.toBeNull();
  });
});

describe('orderStops — the shortest order, everyone in before they are out', () => {
  const at = (km: number) => ({ lat: 33.7, lng: 73 + km / 92.6 }); // ~1 km per 0.0108°
  it('puts everyone in first when they all go the whole way', () => {
    const order = orderStops([
      { uid: 'b', pickup: at(0.5), dropoff: at(8.5) },
      { uid: 'a', pickup: at(0), dropoff: at(9) },
    ]);
    expect(order.map((s) => `${s.kind[0]}${s.uid}`)).toEqual(['pa', 'pb', 'db', 'da']);
  });
  it('drops a rider before collecting the next when that is shorter', () => {
    const order = orderStops([
      { uid: 'a', pickup: at(0), dropoff: at(3) },
      { uid: 'b', pickup: at(5), dropoff: at(9) },
    ]);
    expect(order.map((s) => `${s.kind[0]}${s.uid}`)).toEqual(['pa', 'da', 'pb', 'db']);
  });
  it('starts from wherever the driver is', () => {
    // a waits south of the route, b north of it; the driver is north, beside b.
    const end = { lat: 33.7, lng: 73.1 };
    const order = orderStops(
      [{ uid: 'a', pickup: { lat: 33.69, lng: 73.0 }, dropoff: end }, { uid: 'b', pickup: { lat: 33.71, lng: 73.0 }, dropoff: end }],
      { lat: 33.715, lng: 73.0 },
    );
    expect(order[0]).toEqual({ uid: 'b', kind: 'pickup' });
  });
});

describe('priceJoin — your own route at the car’s tier, and a join never costs the driver', () => {
  it('splits a PKR 1,000 route 550 / 450 / 350 as riders join', () => {
    const one = priceInOrder([{ uid: 'a', soloFare: 1000 }]);
    expect(one).toEqual({ fares: { a: 1000 }, gross: 1000 });
    const three = priceInOrder(['a', 'b', 'c'].map((uid) => ({ uid, soloFare: 1000 })));
    expect(three).toEqual({ fares: { a: 450, b: 450, c: 450 }, gross: 1350 });
    const four = priceInOrder(['a', 'b', 'c', 'd'].map((uid) => ({ uid, soloFare: 1000 })));
    expect(four.gross).toBe(1400);
  });
  it('charges each rider their own route: a shorter one pays less', () => {
    const { fares } = priceInOrder([{ uid: 'a', soloFare: 1000 }, { uid: 'b', soloFare: 900 }]);
    expect(fares).toEqual({ a: 550, b: 495 });
  });
  it('has a shorter-route joiner top up what the driver would lose — never past their solo fare', () => {
    // 550 + 330 would leave the car at 880 after earning 1,000 alone.
    const joined = priceJoin([{ uid: 'a', soloFare: 1000 }], { uid: 'b', soloFare: 600 }, 1000);
    expect(joined.fares).toEqual({ a: 550, b: 450 });
    expect(joined.gross).toBe(1000);
    const capped = priceJoin([{ uid: 'a', soloFare: 1000 }], { uid: 'b', soloFare: 300 }, 1000);
    expect(capped.joinerFare).toBe(300);
  });
});

describe('priceCar — after someone leaves, the rest move back up, never past riding alone', () => {
  it('returns a lone rider to their own solo fare', () => {
    expect(priceCar([{ uid: 'a', soloFare: 1000 }])).toEqual({ fares: { a: 1000 }, gross: 1000 });
    expect(priceCar([{ uid: 'a', soloFare: 1000 }, { uid: 'b', soloFare: 800 }]).fares).toEqual({ a: 550, b: 440 });
  });
});
