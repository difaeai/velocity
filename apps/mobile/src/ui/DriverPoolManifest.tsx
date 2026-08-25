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
 * The in-ride half of this job belongs to `DropOffPanel`: this says who is
 * getting IN, that one says who is getting OUT and what to take from them.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { api, type PoolRiderView } from '../api/client';
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

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getPoolRiders({ tripId })
      .then((r) => { if (alive) setRiders(r.riders); })
      // A list we cannot read must not break the trip card it sits inside.
      .catch(() => { if (alive) setRiders(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tripId, refreshKey]);

  if (loading && !riders) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>Loading your passengers…</Text>
      </View>
    );
  }

  // One rider is not a shared car worth explaining — the trip card already
  // says everything there is to say about a single passenger.
  if (!riders || riders.length < 2) return null;

  const total = riders.reduce((sum, r) => sum + (r.fare ?? 0), 0);

  return (
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
