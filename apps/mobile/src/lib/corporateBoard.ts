/**
 * Driver home, "Corporate & Students": every corporate and student ride near
 * the driver, sorted by when it leaves (owner, 2026-11-05).
 *
 *   Right now       (green)  leaving within half an hour, or as soon as a driver takes it.
 *   Coming up next  (red)    later, earliest first, the fullest first at the same time —
 *                            minus shared rides within an hour of one this driver already
 *                            holds, which the backend would not give them (assertFreeAt).
 *
 * Commute demand (saved routes and WhatsApp QR leads, getCommuteDemand) sits
 * beside the bookings: people who travel at that time and have not booked yet.
 */
import type { CommuteDemandSlot, DriverPoolView } from '../api/client';
import type { OpenRequest } from '../hooks/driver';
import { areaLabel } from './areaLabel';
import { fromHHMM } from './dailyRouteTime';

/** Leaving within this long is "right now". */
export const NOW_WINDOW_MS = 30 * 60_000;
const HOUR_MS = 60 * 60_000;
/** A demand time this far past is over for today. */
const DEMAND_GONE_MS = 15 * 60_000;

export interface BoardBox {
  key: string;
  /** When it leaves; null = as soon as a driver takes it. */
  atMs: number | null;
  from: string;
  to: string;
  people: number;
  /** What the car pays now; null for people who travel then but have not booked. */
  earn: number | null;
  /** Where a tap goes. */
  open: { tripId: string } | 'shared-pools' | 'demand';
  mine: boolean;
}

export function corporateBoard(
  { requests, pools, demand }: { requests: OpenRequest[]; pools: DriverPoolView[]; demand: CommuteDemandSlot[] },
  nowMs: number,
): { now: BoardBox[]; next: BoardBox[] } {
  const corporate = requests.filter((r) => r.commute);
  const inFeed = new Set(corporate.map((r) => r.tripId));
  const held = pools.filter((p) => p.mine).map((p) => p.departsAtMs ?? nowMs);
  const clashes = (at: number) => held.some((h) => Math.abs(h - at) < HOUR_MS);

  const boxes: BoardBox[] = [
    ...corporate.map((r) => ({
      key: `r-${r.tripId}`,
      atMs: null,
      from: areaLabel(r.pickup?.address ?? ''),
      to: areaLabel(r.dropoff?.address ?? ''),
      people: r.poolRiders ?? 1,
      earn: r.offeredFare,
      open: { tripId: r.tripId },
      mine: false,
    })),
    ...pools
      // A car already out is in the request feed too; show it once.
      .filter((p) => !(p.liveTripId && inFeed.has(p.liveTripId)))
      .filter((p) => p.mine || !clashes(p.departsAtMs ?? nowMs))
      .map((p) => ({
        key: `p-${p.id}`,
        atMs: p.liveTripId ? null : p.departsAtMs,
        from: areaLabel(p.pickup.address),
        to: areaLabel(p.dropoff.address),
        people: p.riders,
        earn: p.earnNow,
        open: 'shared-pools' as const,
        mine: p.mine,
      })),
    ...demand.flatMap((d) => {
      const at = fromHHMM(d.time, new Date(nowMs)).getTime();
      return at < nowMs - DEMAND_GONE_MS
        ? []
        : [{
            key: `d-${d.time}-${d.destinationAreaName}`,
            atMs: at,
            from: 'Near you',
            to: d.destinationAreaName,
            people: d.count,
            earn: null,
            open: 'demand' as const,
            mine: false,
          }];
    }),
  ];

  const isNow = (b: BoardBox) => b.atMs === null || b.atMs <= nowMs + NOW_WINDOW_MS;
  const byTime = (a: BoardBox, b: BoardBox) => (a.atMs ?? 0) - (b.atMs ?? 0) || b.people - a.people;
  return { now: boxes.filter(isNow).sort(byTime), next: boxes.filter((b) => !isNow(b)).sort(byTime) };
}
