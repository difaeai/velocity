/**
 * Riders on your way — what the wait is actually worth.
 * ---------------------------------------------------------------------------
 * A rider books a shared ride and nobody joins. The old screen gave them one
 * thing to look at: a countdown, and a fare that was never going to move. What
 * it never said was that two people were standing on the road they were about
 * to drive down, either of whom would cut their fare if the driver took them —
 * even though the backend has known exactly who those people are since the day
 * en-route pickups shipped. It was only ever shown to the driver.
 *
 * So this is that same search, from the rider's seat. "You are on your own, but
 * Bilal is waiting at F-10 Markaz and Sana at Faizabad, and your PKR 520 becomes
 * PKR 340 if the driver picks them up on the way."
 *
 * HONEST ABOUT BEING CONDITIONAL
 * Nothing here promises a fare. Every figure is "what it becomes IF the driver
 * takes them", and the copy says so in those words, because the pricing of
 * record happens when the driver accepts and not a moment sooner. A card that
 * implied a lower fare and then did not deliver one would cost more trust than
 * the feature could ever earn.
 *
 * NEVER A DOORSTEP
 * Areas only — "F-10 Markaz", not a house number or a gate. A waiting rider has
 * no business knowing where a stranger is standing, and the backend sends
 * nothing finer than that.
 *
 * IT DISAPPEARS RATHER THAN SHOWING A ZERO
 * On a quiet road, in a full car, or with the feature switched off, this renders
 * nothing at all. Most of the time there is nobody to show, and a card that
 * said "0 riders on your way, your fare stays the same" would be a worse screen
 * than the one that existed before.
 *
 * ASKING
 * Before a driver exists there is nobody to ask, so the card only informs. Once
 * a driver is on the trip, each row can nudge them — and it is only ever a
 * nudge: the driver's own screen re-runs every gate (seats, the gender rules,
 * the corridor, their own earnings) before anybody is added to the car.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { api, type EnRouteCandidateView } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { useForegroundInterval } from '../hooks/useForegroundInterval';

/** The road fills and empties; check it often enough to be worth believing. */
const REFRESH_MS = 45_000;

interface Props {
  tripId: string;
  /** Only shown while the ride is still going somewhere. */
  status: string;
  /** Shared rides only — a solo rider never gets co-riders sprung on them. */
  pool: boolean;
  /** Our own drawn route, as a fallback for when the server has no Maps key. */
  polyline?: string;
}

const LIVE = new Set(['requested', 'matched', 'arriving', 'arrived', 'in_progress']);

/** 1200 → "1.2 km into the ride". Coarse on purpose; it is a hint, not a map. */
function alongLabel(m: number): string {
  if (m < 900) return 'right at the start';
  return `${Math.round(m / 100) / 10} km in`;
}

export function EnRouteSavingsCard({ tripId, status, pool, polyline }: Props) {
  const [candidates, setCandidates] = useState<EnRouteCandidateView[]>([]);
  const [fareNow, setFareNow] = useState<number | null>(null);
  const [fareBest, setFareBest] = useState<number | null>(null);
  const [aboard, setAboard] = useState(1);
  const [canAsk, setCanAsk] = useState(false);
  const [asked, setAsked] = useState<Record<string, boolean>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = pool && LIVE.has(status);

  const look = useCallback(() => {
    if (!active) return;
    api
      .getEnRouteSavings({ tripId, polyline })
      .then((res) => {
        setCandidates(res.candidates ?? []);
        setFareNow(res.myFareNow);
        setFareBest(res.myFareBest);
        setCanAsk(res.canAsk === true);
        setAboard(res.ridersAboard ?? 1);
      })
      // Silent: this card is a bonus. A rider waiting for a driver must never
      // be shown an error about a search they did not ask us to run.
      .catch(() => {});
  }, [active, tripId, polyline]);

  useForegroundInterval(active ? look : null, REFRESH_MS, `${tripId}:${status}`);

  async function ask(candidate: EnRouteCandidateView) {
    setAsking(candidate.tripId);
    setError(null);
    try {
      await api.askDriverEnRoutePickup({ tripId, candidateTripId: candidate.tripId });
      setAsked((a) => ({ ...a, [candidate.tripId]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the driver just now.');
    } finally {
      setAsking(null);
    }
  }

  if (!active || candidates.length === 0) return null;

  const saving = fareNow != null && fareBest != null && fareBest < fareNow ? fareNow - fareBest : null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>
          {candidates.length === 1
            ? 'Someone is waiting on your way'
            : `${candidates.length} riders are waiting on your way`}
        </Text>
        {aboard <= 1 && <Text style={styles.alone}>You are on your own so far</Text>}
      </View>

      <Text style={styles.lede}>
        They are not going to exactly where you are going — they get in and out along your road. If
        the driver picks them up, you pay for less of the journey.
      </Text>

      {saving != null && (
        <View style={styles.fareRow}>
          <View>
            <Text style={styles.fareLabel}>Your fare now</Text>
            <Text style={styles.fareNow}>PKR {fareNow}</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
          <View>
            <Text style={styles.fareLabel}>
              {candidates.length === 1 ? 'If the driver takes them' : 'If the driver takes them all'}
            </Text>
            <Text style={styles.fareBest}>PKR {fareBest}</Text>
          </View>
          <View style={styles.savePill}>
            <Text style={styles.savePillText}>−PKR {saving}</Text>
          </View>
        </View>
      )}

      {candidates.map((c) => (
        <View key={c.tripId} style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name}>
              {c.firstName}
              {c.seats > 1 ? ` · ${c.seats} seats` : ''}
            </Text>
            <Text style={styles.where} numberOfLines={2}>
              {c.pickupArea ?? 'on your road'} → {c.dropoffArea ?? 'near where you are going'} ·{' '}
              {alongLabel(c.alongM)}
            </Text>
            <Text style={styles.youPay}>Your fare with them: PKR {c.myFareIfTaken}</Text>
          </View>
          {canAsk ? (
            asked[c.tripId] ? (
              <Text style={styles.askedText}>Driver asked</Text>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.askBtn, pressed && { opacity: 0.85 }]}
                onPress={() => ask(c)}
                disabled={asking === c.tripId}
              >
                {asking === c.tripId ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.askBtnText}>Ask driver</Text>
                )}
              </Pressable>
            )
          ) : null}
        </View>
      ))}

      <Text style={styles.footnote}>
        {canAsk
          ? 'Asking sends your driver a notification. It is their car and their road, so the decision stays theirs — and your fare only changes once they actually pick someone up.'
          : 'Once a driver takes your ride you can ask them to pick these riders up. Drivers are shown them anyway, because it earns them more.'}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  head: { gap: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  alone: { color: colors.muted, fontSize: 12 },
  lede: { color: colors.muted, fontSize: 13, lineHeight: 19 },

  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
  },
  fareLabel: { color: colors.muted, fontSize: 11 },
  fareNow: { color: colors.text, fontSize: 16, fontWeight: '700', textDecorationLine: 'line-through' },
  fareBest: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  arrow: { color: colors.muted, fontSize: 16 },
  savePill: {
    marginLeft: 'auto',
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  savePillText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  where: { color: colors.muted, fontSize: 12, marginTop: 2 },
  youPay: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 3 },

  askBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 92,
    alignItems: 'center',
  },
  askBtnText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  askedText: { color: colors.muted, fontSize: 12, fontWeight: '600' },

  footnote: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.danger, fontSize: 12 },
}));
