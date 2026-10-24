/**
 * "📞 Call" on a ride — a free call over the internet instead of the SIM.
 *
 * Opens the call screen, which rings the other side through the startCall
 * callable (backend: calls/index.ts). The phone number goes along only as the
 * fallback the call screen offers when the internet call cannot get through.
 */
import { router } from 'expo-router';

import { api } from '../api/client';
import { useForegroundInterval } from '../hooks/useForegroundInterval';

/** Calls a screen is handling right now, so a tapped notification never opens a second one. */
export const openCalls = new Set<string>();

type RideFunction = Parameters<typeof api.warmRide>[0];

/** Every button a driver presses on a ride, from Accept to End ride. */
const DRIVER_LINE: RideFunction[] = [
  'startCall', 'sendTripMessage', 'placeBid', 'updateTripStatus', 'cancelTrip',
  'completeTrip', 'dropOffRider', 'boardPoolRider',
];
const RIDER_LINE: RideFunction[] = ['startCall', 'sendTripMessage', 'cancelTrip'];

/**
 * Keeps a ride's functions awake while they may be needed. Cold, they took
 * 8–15 s (prod logs, Oct 2026): a call rang for ten seconds before the other
 * phone heard anything, Accept spun for fifteen, and Cancel looked dead.
 * `live` is a trip for a rider; for a driver it is simply being online, since
 * Accept is the first button they press.
 */
export function useWarmRideLine(live: boolean, role: 'driver' | 'passenger' = 'passenger') {
  useForegroundInterval(
    live
      ? () => {
          for (const fn of role === 'driver' ? DRIVER_LINE : RIDER_LINE) {
            api.warmRide(fn).catch(() => {});
          }
        }
      : null,
    5 * 60_000,
  );
}

export function callInApp(p: {
  rideKind: 'trip' | 'poolRide';
  rideId: string;
  /** Who, when a driver calls one rider of a shared ride. Riders always reach the driver. */
  calleeId?: string;
  /** Shown while it rings, before the call document arrives. */
  name?: string;
  phone?: string | null;
}) {
  router.push({
    pathname: '/call/[id]',
    params: {
      id: 'new',
      rideKind: p.rideKind,
      rideId: p.rideId,
      calleeId: p.calleeId ?? '',
      name: p.name ?? '',
      phone: p.phone ?? '',
    },
  });
}
