/**
 * The driver's passenger list, before the ride starts.
 * ---------------------------------------------------------------------------
 * A driver who accepts a shared ride is agreeing to carry several people, and
 * until now the app told them almost nothing about that: the trip card showed
 * one fare, one pickup and one "passenger", and every rider who joined after
 * the driver accepted arrived as a surprise at the kerb. They could not say how
 * many people they were waiting for, who any of them were, or what each one
 * owed — so they could not tell a waiting passenger from a passer-by, and they
 * could not collect the right cash from the right person.
 *
 * This is that list. Names, so the driver can call out the right one; genders,
 * because a driver carrying a lone woman at night is running a different trip
 * and knows it; the fare each person owes, because the driver is the one
 * collecting it; and a phone number for the one who is not where they said.
 *
 * It streams nothing — the roster only changes when somebody joins, and a join
 * already sends the driver a push. `refreshKey` lets the parent re-read it when
 * one lands.
 *
 * It also carries the queue of riders ASKING for a seat. Once a driver has
 * agreed to carry a shared ride, nobody else is put in their car without them:
 * a rider who taps Join on a confirmed pool lands here, with their name and
 * what they would pay, and the driver says yes or no. That decision is the
 * driver's alone — and the fare attached to it is not negotiable by either of
 * them, because the rider who started the pool set it when they booked.
 *
 * The in-ride half of this job belongs to `DropOffPanel`: this says who is
 * getting IN, that one says who is getting OUT and what to take from them.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { api, type PoolJoinRequest, type PoolRiderView } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';

const GENDER_MARK: Record<string, string> = { male: '♂', female: '♀' };

const KIND_LABEL: Record<string, string> = {
  host: 'booked this ride',
  share: 'joined this ride',
  enroute: 'picked up on the way',
};

export function DriverPoolManifest({
  tripId,
  paymentMethod,
  seatsFree,
  refreshKey,
}: {
  tripId: string;
  paymentMethod: 'cash' | 'wallet';
  /** Seats still open, so the driver knows the car may yet fill up further. */
  seatsFree: number;
  /** Bump to re-read the list — e.g. when a "rider joined" push arrives. */
  refreshKey?: number;
}) {
  const [riders, setRiders] = useState<PoolRiderView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PoolJoinRequest[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);
  /** Bumped by an accept or reject, so both lists re-read together. */
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getPoolRiders({ tripId })
      .then((r) => { if (alive) setRiders(r.riders); })
      // A list we cannot read must not break the trip card it sits inside.
      .catch(() => { if (alive) setRiders(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tripId, refreshKey, localKey]);

  // The people waiting on this driver's answer. Polled rather than streamed:
  // a request arrives with a push anyway, and this driver is looking at a road.
  useEffect(() => {
    let alive = true;
    const read = () => {
      api.getPoolJoinRequests({ tripId })
        .then((r) => { if (alive) setPending(r.requests); })
        .catch(() => { if (alive) setPending([]); });
    };
    read();
    const t = setInterval(read, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [tripId, refreshKey, localKey]);

  async function decide(riderId: string, action: 'accept' | 'reject') {
    setDeciding(riderId);
    try {
      await api.driverRespondToPoolJoin({ tripId, riderId, action });
      setPending((p) => p.filter((r) => r.riderId !== riderId));
      setLocalKey((k) => k + 1);
    } catch (e) {
      Alert.alert(
        'Could not answer that request',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setDeciding(null);
    }
  }

  /**
   * The ask-for-a-seat queue.
   *
   * Rendered above the manifest AND outside the "two or more riders" gate
   * below, because an unanswered request is a person standing on a road waiting
   * for this driver — whether or not the car is shared yet.
   */
  const requestQueue = pending.length > 0 ? (
    <View style={styles.requestCard}>
      <Text style={styles.requestTitle}>
        {pending.length === 1 ? 'A rider wants to join' : `${pending.length} riders want to join`}
      </Text>
      <Text style={styles.requestSub}>
        Your call. Taking someone on adds their fare to this ride; turning them down costs you
        nothing and they are told straight away.
      </Text>
      {pending.map((r) => (
        <View key={r.riderId} style={styles.requestRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {r.riderName} {GENDER_MARK[r.riderGender] ?? ''}
            </Text>
            <Text style={styles.requestFare}>
              {paymentMethod === 'cash'
                ? `+ PKR ${r.farePerSeat} in cash`
                : `+ PKR ${r.farePerSeat} from wallet`}
              {r.dropoffAreaName ? ` · drops at ${r.dropoffAreaName}` : ''}
            </Text>
          </View>
          <Pressable
            style={[styles.rejectBtn, deciding !== null && { opacity: 0.5 }]}
            onPress={() => void decide(r.riderId, 'reject')}
            disabled={deciding !== null}
          >
            <Text style={styles.rejectBtnText}>No</Text>
          </Pressable>
          <Pressable
            style={[styles.acceptBtn, deciding !== null && { opacity: 0.5 }]}
            onPress={() => void decide(r.riderId, 'accept')}
            disabled={deciding !== null}
          >
            <Text style={styles.acceptBtnText}>Take them</Text>
          </Pressable>
        </View>
      ))}
    </View>
  ) : null;

  if (loading && !riders) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>Loading your passengers…</Text>
      </View>
    );
  }

  // One rider is not a shared car worth explaining — the trip card already
  // says everything there is to say about a single passenger. A rider asking
  // to get in is a different matter, and still has to be answerable.
  if (!riders || riders.length < 2) return requestQueue;

  const total = riders.reduce((sum, r) => sum + (r.fare ?? 0), 0);

  return (
    <>
    {requestQueue}
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>
          {riders.length} passengers in this car
        </Text>
        {seatsFree > 0 ? (
          <Text style={styles.headSub}>{seatsFree} seat{seatsFree === 1 ? '' : 's'} free</Text>
        ) : (
          <Text style={styles.headSub}>full</Text>
        )}
      </View>

      {riders.map((r, i) => (
        <View key={r.uid} style={styles.row}>
          <View style={styles.seatNo}>
            <Text style={styles.seatNoText}>{i + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {r.name} {GENDER_MARK[r.gender] ?? ''}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {KIND_LABEL[r.kind] ?? 'in this car'}
              {r.pickupAddress ? ` · ${r.pickupAddress}` : ''}
            </Text>
            <Text style={styles.fare}>
              {paymentMethod === 'cash'
                ? `Collect PKR ${r.fare ?? 0} in cash`
                : `PKR ${r.fare ?? 0} from wallet`}
            </Text>
          </View>
          {r.phone ? (
            <Pressable
              style={styles.callBtn}
              onPress={() => Linking.openURL(`tel:${r.phone}`)}
              hitSlop={8}
            >
              <Text style={styles.callBtnText}>📞</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>
          {paymentMethod === 'cash' ? 'Total to collect' : 'Total for this ride'}
        </Text>
        <Text style={styles.totalValue}>PKR {total}</Text>
      </View>
      <Text style={styles.note}>
        Everyone rides to the same drop-off. You let them out one at a time and take each
        person&apos;s fare from them — the ride only ends when the last one is out.
      </Text>
    </View>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  loadingText: { color: colors.muted, fontSize: 12, fontWeight: '600' },

  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 14,
    gap: 10,
    marginTop: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 15, fontWeight: '900' },
  headSub: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seatNo: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.glassLime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatNoText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  name: { color: colors.text, fontSize: 14, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 11, marginTop: 1 },
  fare: { color: colors.primary, fontSize: 12, fontWeight: '800', marginTop: 2 },
  callBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtnText: { fontSize: 15 },

  /* The ask-for-a-seat queue. Deliberately louder than the manifest under it:
     somebody is standing still waiting on this tap. */
  requestCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 14,
    gap: 8,
    marginTop: 10,
  },
  requestTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  requestSub: { color: colors.muted, fontSize: 11.5, lineHeight: 16 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  requestFare: { color: colors.primary, fontSize: 12, fontWeight: '800', marginTop: 2 },
  acceptBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  acceptBtnText: { color: '#0b0d0c', fontSize: 12.5, fontWeight: '900' },
  rejectBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  rejectBtnText: { color: colors.muted, fontSize: 12.5, fontWeight: '800' },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  totalLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '700' },
  totalValue: { color: colors.text, fontSize: 17, fontWeight: '900' },
  note: { color: colors.muted, fontSize: 11, lineHeight: 16 },
}));
