/**
 * "This ride is yours for 18s." The clock on an exclusive shared-ride offer.
 * ----------------------------------------------------------------------------
 * A shared ride is now offered to one driver at a time rather than shown to
 * everybody at once (backend: poolRideRequests/dispatchLadder.ts). That is
 * worth nothing to the driver unless they can SEE it, for two reasons:
 *
 *  · A card with no clock reads as the old feed, where the right move was to
 *    tap faster than everybody else. The whole point of the ladder is that
 *    tapping fast is no longer the skill — waiting your turn is — and the
 *    countdown is what communicates that.
 *  · Without it, a card vanishing mid-decision looks like a bug. With it, the
 *    driver watched it run out.
 *
 * Counts in whole seconds from the server's `offerExpiresAt`, never from a
 * duration the client started timing itself: the server decides when the offer
 * lapses, and a clock that drifted would show time remaining on an offer that
 * had already moved on.
 *
 * Renders nothing once the hold is over, and nothing at all for a ride that is
 * open to every driver — there is no hold to describe.
 * ----------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';

export interface OfferCountdownProps {
  /** `NearbyPoolRequest.offerExpiresAt` — epoch ms, or null when open to all. */
  offerExpiresAt?: number | null;
  /** `NearbyPoolRequest.exclusive`. */
  exclusive?: boolean;
}

export function OfferCountdown({ offerExpiresAt, exclusive }: OfferCountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!exclusive || !offerExpiresAt) return;
    // One second is the resolution the label shows; a faster tick would re-render
    // the whole feed for nothing.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [exclusive, offerExpiresAt]);

  if (!exclusive || !offerExpiresAt) return null;

  const seconds = Math.max(0, Math.ceil((offerExpiresAt - now) / 1000));
  if (seconds === 0) return null;

  // Under five seconds the bar turns urgent rather than growing a second label:
  // a driver glancing at a card has to read the state from colour, not text.
  const urgent = seconds <= 5;

  return (
    <View style={[styles.wrap, urgent && styles.wrapUrgent]}>
      <Text style={[styles.badge, urgent && styles.badgeUrgent]}>{seconds}s</Text>
      <Text style={styles.label} numberOfLines={1}>
        Yours first — pass and it goes to the next driver
      </Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: `${colors.primary}1A`,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
  },
  wrapUrgent: {
    backgroundColor: '#ef44441A',
    borderColor: '#ef444455',
  },
  badge: {
    color: colors.primary,
    fontWeight: '900',
    fontSize: 13,
    minWidth: 28,
  },
  badgeUrgent: { color: '#ef4444' },
  label: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: '700' },
}));
