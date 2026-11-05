import { describe, expect, it } from 'vitest';

import type { CommuteDemandSlot, DriverPoolView } from '../../api/client';
import type { OpenRequest } from '../../hooks/driver';
import { corporateBoard } from '../corporateBoard';

const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m).getTime();
const NOW = at(7, 40);

const pool = (id: string, departsAtMs: number | null, extra: Partial<DriverPoolView> = {}): DriverPoolView => ({
  id,
  label: null,
  rideType: 'mini',
  pickup: { lat: 33.7, lng: 73.0, address: 'F-10 Markaz, Islamabad' },
  dropoff: { lat: 33.69, lng: 73.05, address: 'PIMS, G-8, Islamabad' },
  routeKm: 6,
  toPickupKm: 1,
  departTime: null,
  departsAtMs,
  riders: 2,
  seatsLeft: 2,
  earnNow: 600,
  earnIfFull: 1000,
  stops: [],
  mine: false,
  liveTripId: null,
  ...extra,
});

const request = (tripId: string, commute: boolean): OpenRequest =>
  ({ id: tripId, tripId, rideType: 'mini', offeredFare: 400, seats: 1, passengerGender: 'male', commute }) as OpenRequest;

const slot = (time: string, count: number): CommuteDemandSlot => ({
  time,
  destinationAreaName: 'Blue Area',
  count,
  genderBreakdown: { male: 0, female: 0, any: count },
});

describe('corporateBoard', () => {
  it('puts what leaves within half an hour in Right now, the rest in Coming up next by time', () => {
    const board = corporateBoard({
      requests: [request('solo', false), request('corp', true)],
      pools: [pool('soon', at(8, 0)), pool('later', at(9, 30)), pool('asap', null)],
      demand: [slot('08:00', 3), slot('17:00', 1)],
    }, NOW);
    expect(board.now.map((b) => b.key)).toEqual(['p-asap', 'r-corp', 'd-08:00-Blue Area', 'p-soon']);
    expect(board.next.map((b) => b.key)).toEqual(['p-later', 'd-17:00-Blue Area']);
  });

  it('puts the fuller ride first at the same time', () => {
    const board = corporateBoard({
      requests: [],
      pools: [pool('two', at(10, 0)), pool('four', at(10, 0), { riders: 4 })],
      demand: [],
    }, NOW);
    expect(board.next.map((b) => b.key)).toEqual(['p-four', 'p-two']);
  });

  it('hides rides within an hour of one the driver holds, never their own', () => {
    const board = corporateBoard({
      requests: [],
      pools: [pool('mine', at(9, 0), { mine: true }), pool('clash', at(9, 30)), pool('free', at(11, 0))],
      demand: [],
    }, NOW);
    expect(board.next.map((b) => b.key)).toEqual(['p-mine', 'p-free']);
  });

  it('drops demand that is over for today and a car already in the request feed', () => {
    const board = corporateBoard({
      requests: [request('car', true)],
      pools: [pool('out', null, { liveTripId: 'car' })],
      demand: [slot('07:00', 2)],
    }, NOW);
    expect(board.now.map((b) => b.key)).toEqual(['r-car']);
    expect(board.next).toEqual([]);
  });
});
