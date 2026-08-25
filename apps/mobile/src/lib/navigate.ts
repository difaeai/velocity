import { Linking, Platform } from 'react-native';

/**
 * Hand a destination to the phone's real navigator.
 *
 * Velocity draws a map so you can see where a ride is going. It does not do
 * turn-by-turn, and should not try: a driver already trusts Google Maps with
 * live traffic, lane guidance and voice, and none of that is worth rebuilding
 * badly inside a ride-hailing app.
 *
 * Three URLs, in falling order of how well they work:
 *
 *  1. `google.navigation:` — opens Google Maps already navigating, which is the
 *     one tap a driver actually wants. Android only, Google Maps only.
 *  2. `geo:` — the Android standard. Any installed map app can answer it, so a
 *     driver without Google Maps still gets directions. Carries the address as
 *     a label so the pin is named rather than a bare coordinate.
 *  3. The maps.google.com web URL — works on iOS, and on a device where no map
 *     app claims either scheme above.
 *
 * Every step is attempted in order and failure falls through, because
 * `canOpenURL` lies often enough on Android (package visibility rules) that
 * trusting it would strand drivers who do have Maps installed.
 */
export interface NavTarget {
  lat: number;
  lng: number;
  address?: string | null;
}

export async function openNavigation(target: NavTarget): Promise<void> {
  const { lat, lng } = target;
  const label = encodeURIComponent((target.address ?? '').trim() || 'Destination');

  const candidates =
    Platform.OS === 'android'
      ? [
          `google.navigation:q=${lat},${lng}&mode=d`,
          `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
          `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
        ]
      : [
          `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`,
          `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
          `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
        ];

  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // No handler for this scheme — try the next, more universal one.
    }
  }
}

/** True when a point carries usable coordinates rather than a bare address. */
export function hasCoords(p?: { lat?: number; lng?: number } | null): p is { lat: number; lng: number } {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number';
}
