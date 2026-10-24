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

/**
 * Keeps startCall and sendTripMessage awake while a ride is live. Cold, they
 * took 8–12 s (prod logs, Oct 2026): a call rang for ten seconds before the
 * other phone heard anything, and a chat message sat in the box as long.
 */
export function useWarmRideLine(live: boolean) {
  useForegroundInterval(
    live
      ? () => {
          api.warmRide('startCall').catch(() => {});
          api.warmRide('sendTripMessage').catch(() => {});
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
