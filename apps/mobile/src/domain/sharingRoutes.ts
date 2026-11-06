/**
 * The twin cities' everyday routes, ready before anybody books one (owner,
 * 2026-11-02: "where people go from and to in Islamabad and Rawalpindi — make
 * a shared ride for every route in advance").
 *
 * Every route between a place people live and a place they go to every day —
 * universities, offices, hospitals, the big markets, the airport — both ways,
 * and between those places themselves. Nothing is written to the database for
 * them: the ride sharing screen shows each as an empty car, and the first
 * rider to Join creates the real shared ride (createSharedPool), which then
 * stands in for it for everyone after.
 *
 * Hand-entered coordinates, like traffic/gazetteer.ts: our own measurement,
 * checked against OpenStreetMap (2026-11-02), never copied from Google, whose
 * terms let nobody keep its coordinates. Gates and markaz centres, not doors —
 * a driver can find them and a rider can walk to them.
 */
import { distanceMeters } from '../lib/geo';

type Place = { lat: number; lng: number; address: string };

/** `go`: a place people travel TO every day; the rest are where they live. */
type Spot = Place & { name: string; go?: true };

const spot = (name: string, address: string, lat: number, lng: number, go?: true): Spot => ({ name, address, lat, lng, go });

const SPOTS: Spot[] = [
  // ── Islamabad sectors ──
  spot('G-6', 'Aabpara Market, G-6, Islamabad', 33.71, 73.0882),
  spot('G-7', 'G-7 Sitara Market, Islamabad', 33.706, 73.0671),
  spot('G-8', 'G-8 Markaz, Islamabad', 33.6989, 73.0471),
  spot('G-9', 'G-9 Markaz, Islamabad', 33.6895, 73.0302),
  spot('G-10', 'G-10 Markaz, Islamabad', 33.6767, 73.0145),
  spot('G-11', 'G-11 Markaz, Islamabad', 33.6688, 72.9989),
  spot('G-13', 'G-13, Islamabad', 33.6515, 72.9621),
  spot('G-15', 'G-15, Islamabad', 33.6326, 72.923),
  spot('F-6', 'F-6 Super Market, Islamabad', 33.729, 73.076),
  spot('F-7', 'Jinnah Super Market, F-7, Islamabad', 33.7205, 73.0563),
  spot('F-8', 'F-8 Markaz, Islamabad', 33.7115, 73.0396),
  spot('F-10', 'F-10 Markaz, Islamabad', 33.6959, 73.0125),
  spot('F-11', 'F-11 Markaz, Islamabad', 33.6845, 72.9887),
  spot('E-11', 'E-11, Islamabad', 33.6951, 72.9724),
  spot('I-8', 'I-8 Markaz, Islamabad', 33.6679, 73.0745),
  spot('I-9', 'I-9, Islamabad', 33.6562, 73.0631),
  spot('I-10', 'I-10 Markaz, Islamabad', 33.6477, 73.039),
  spot('B-17', 'B-17, Islamabad', 33.6904, 72.8286),
  spot('D-12', 'D-12, Islamabad', 33.7018, 72.9486),
  spot('E-7', 'E-7, Islamabad', 33.7253, 73.0454),
  spot('Faisal Town', 'Faisal Town, Islamabad', 33.608, 72.8673),
  // ── Islamabad's outskirts, along the Expressway and Park Road ──
  spot('Bani Gala', 'Bani Gala, Islamabad', 33.7101, 73.1536),
  spot('Bahria Enclave', 'Bahria Enclave, Islamabad', 33.6877, 73.214),
  spot('Shahzad Town', 'Shahzad Town, Islamabad', 33.672, 73.1406),
  spot('Tarlai', 'Tarlai, Islamabad', 33.6408, 73.1536),
  spot('Khanna Pul', 'Khanna Pul, Islamabad Expressway', 33.6293, 73.1136),
  spot('Ghauri Town', 'Ghauri Town, Islamabad', 33.6153, 73.1379),
  spot('Gulberg Greens', 'Gulberg Greens, Islamabad', 33.6002, 73.2119),
  spot('Police Foundation', 'Police Foundation, Islamabad', 33.5679, 73.1338),
  spot('PWD', 'PWD Housing Society, Islamabad', 33.5713, 73.1448),
  spot('CBR Town', 'CBR Town, Islamabad', 33.5574, 73.1409),
  spot('Jinnah Garden', 'Jinnah Garden, Islamabad', 33.568, 73.1749),
  spot('Naval Anchorage', 'Naval Anchorage, Islamabad', 33.5696, 73.1959),
  spot('Airport Housing Society', 'Airport Housing Society, Rawalpindi', 33.5941, 73.1307),
  spot('Media Town', 'Media Town, Rawalpindi', 33.564, 73.1222),
  spot('Soan Garden', 'Soan Garden, Islamabad', 33.5625, 73.1535),
  spot('Bahria Town', 'Bahria Town Phase 7, Rawalpindi', 33.5308, 73.118),
  spot('DHA Phase 1', 'DHA Phase 1, Islamabad', 33.5379, 73.1013),
  spot('DHA Phase 2', 'DHA Phase 2, Islamabad', 33.5273, 73.1609),
  // ── Rawalpindi ──
  spot('Satellite Town', 'Satellite Town, Rawalpindi', 33.6378, 73.0709),
  spot('6th Road', '6th Road, Rawalpindi', 33.6419, 73.0768),
  spot('Shamsabad', 'Shamsabad, Rawalpindi', 33.654, 73.08),
  spot('Chandni Chowk', 'Chandni Chowk, Rawalpindi', 33.627, 73.0713),
  spot('Pirwadhai', 'Pirwadhai, Rawalpindi', 33.6345, 73.0331),
  spot('Westridge', 'Westridge, Rawalpindi', 33.6112, 73.0154),
  spot('Chaklala Scheme 3', 'Chaklala Scheme 3, Rawalpindi', 33.5879, 73.0872),
  spot('Tench Bhatta', 'Tench Bhatta, Rawalpindi', 33.5807, 73.0274),
  spot('Adiala Road', 'Adiala Road, Rawalpindi', 33.5457, 73.0538),
  spot('Askari 14', 'Askari 14, Rawalpindi', 33.5422, 73.0661),

  // ── Where they go: universities ──
  spot('NUST', 'NUST, H-12, Islamabad', 33.6448, 72.9918, true),
  spot('COMSATS', 'COMSATS University, Park Road, Islamabad', 33.6498, 73.1549, true),
  spot('Quaid-i-Azam University', 'Quaid-i-Azam University, Islamabad', 33.7437, 73.1586, true),
  spot('IIUI', 'International Islamic University, H-10, Islamabad', 33.6636, 73.0266, true),
  spot('FAST', 'FAST University, H-11, Islamabad', 33.6565, 73.0164, true),
  spot('NUML', 'NUML, H-9, Islamabad', 33.6671, 73.0507, true),
  spot('Bahria University', 'Bahria University, E-8, Islamabad', 33.7158, 73.0283, true),
  spot('Air University', 'Air University, E-9, Islamabad', 33.7139, 73.0259, true),
  spot('SZABIST', 'SZABIST, H-8, Islamabad', 33.6773, 73.0681, true),
  spot('Riphah University', 'Riphah International University, I-14, Islamabad', 33.6169, 72.9723, true),
  spot('Capital University', 'Capital University (CUST), Islamabad Expressway', 33.5451, 73.1858, true),
  spot('Arid University', 'Arid Agriculture University, Murree Road, Rawalpindi', 33.6473, 73.0825, true),
  spot('Fatima Jinnah University', 'Fatima Jinnah Women University, The Mall, Rawalpindi', 33.5875, 73.0638, true),
  // ── offices and markets ──
  spot('Blue Area', 'Blue Area, Jinnah Avenue, Islamabad', 33.7121, 73.0624, true),
  spot('Pak Secretariat', 'Pak Secretariat, Islamabad', 33.7295, 73.0935, true),
  spot('Centaurus', 'Centaurus Mall, F-8, Islamabad', 33.7079, 73.0499, true),
  spot('Giga Mall', 'Giga Mall, DHA Phase 2, Islamabad', 33.5212, 73.158, true),
  spot('Saddar', 'Bank Road, Saddar, Rawalpindi', 33.5969, 73.0512, true),
  spot('Raja Bazaar', 'Raja Bazaar, Rawalpindi', 33.6123, 73.0563, true),
  spot('Committee Chowk', 'Committee Chowk, Rawalpindi', 33.6139, 73.065, true),
  spot('Faizabad', 'Faizabad, Islamabad Expressway', 33.6646, 73.0871, true),
  // ── hospitals and the airport ──
  spot('PIMS', 'PIMS Hospital, G-8, Islamabad', 33.7023, 73.0525, true),
  spot('Holy Family Hospital', 'Holy Family Hospital, Satellite Town, Rawalpindi', 33.6407, 73.057, true),
  spot('Islamabad Airport', 'Islamabad International Airport', 33.5515, 72.8256, true),
];

/** The cities these routes are in — the two are one place to the people who live there. */
export const TWIN_CITIES = new Set(['islamabad', 'rawalpindi']);

/** Too short to share a car for, and too long to be an everyday route. */
const MIN_KM = 3;
const MAX_KM = 35;

export type SharingRoute = {
  id: string;
  /** The place it goes to — the + box's "institution or location" name. */
  label: string;
  pickup: Place;
  dropoff: Place;
};

const placeOf = ({ lat, lng, address }: Spot): Place => ({ lat, lng, address });

/** Every route with a daily destination at one end or both, each way. */
export const SHARING_ROUTES: SharingRoute[] = SPOTS.flatMap((a) =>
  SPOTS.filter((b) => b !== a && (a.go || b.go))
    .filter((b) => {
      const km = distanceMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
      return km >= MIN_KM && km <= MAX_KM;
    })
    .map((b) => ({ id: `route:${a.name}>${b.name}`, label: b.name, pickup: placeOf(a), dropoff: placeOf(b) })),
);

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  distanceMeters(a.lat, a.lng, b.lat, b.lng);

/**
 * How far a ride is from the rider's own route: their pickup to its pickup plus
 * their drop-off to its drop-off. Lists sort on it — closest first, then the next.
 */
export const routeGap = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  r: { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } },
) => metres(from, r.pickup) + metres(to, r.dropoff);

/** How far a rider may be from a route's pickup and still be leaving from it. */
export const NEAR_PICKUP_M = 3000;

/**
 * Where a route ranks for a rider who has only said where they are (owner,
 * 2026-11-02: at PWD, "it shows me NUST, far far away"): its pickup near them
 * counts double, then the trip itself — the places around them before the far ones.
 */
export const pickupFit = (
  from: { lat: number; lng: number },
  r: { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } },
) => 2 * metres(from, r.pickup) + metres(r.pickup, r.dropoff);

type Ends = { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } };

/**
 * The boxes in order for a rider who has only said where they are: what leaves
 * from around them first — real rides, then `ready` routes, each by pickupFit —
 * then what leaves from further away, the rider's own rides included (owner,
 * 2026-11-05: at I-8, their own rides from PWD, 15 km off, came first). `top`
 * boxes lead the lot (All's favourites).
 */
export function pickupOrder<T extends Ends & { ready?: boolean }>(
  from: { lat: number; lng: number } | null,
  boxes: T[],
  top: (b: T) => boolean = () => false,
): T[] {
  const rank = (b: T) =>
    (top(b) ? 0 : 4e9) +
    (from && metres(from, b.pickup) > NEAR_PICKUP_M ? 2e9 : 0) +
    (b.ready ? 1e9 : 0) +
    (from ? pickupFit(from, b) : 0);
  return boxes
    .map((b) => ({ b, r: rank(b) }))
    .sort((x, y) => x.r - y.r)
    .map(({ b }) => b);
}

/** The nearest known place's name within `maxM`, for an address that names no area. */
export function nearestSpotName(p: { lat: number; lng: number }, maxM = NEAR_PICKUP_M): string | null {
  let best: string | null = null;
  let bestM = maxM;
  for (const s of SPOTS) {
    const m = metres(p, s);
    if (m <= bestM) {
      best = s.name;
      bestM = m;
    }
  }
  return best;
}

/** Whether a real shared ride already runs this route (both ends within `radiusM`, same way). */
export function sameRoute(
  r: { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } },
  p: { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } },
  radiusM = 700,
): boolean {
  return metres(r.pickup, p.pickup) <= radiusM && metres(r.dropoff, p.dropoff) <= radiusM;
}
