/**
 * Who else is in this car.
 *
 * A pool rider agreed to share a car with strangers — but agreeing to strangers
 * in the abstract is not the same as finding one in the back seat unannounced. So
 * the moment the driver picks somebody up along the route, they appear here: their
 * name, whether they are a man or a woman, and where they get in and out. The
 * trip document streams, so this updates the instant it happens, and a push lands
 * at the same time.
 *
 * If anything about it looks wrong, the call button is right there. That is the
 * point: the passenger finds out from us, before the car pulls over, and can
 * speak to the driver about it while there is still time to.
 *
 * Fares are shown for you and nobody else — everyone in a pool rides a different
 * slice of the road and pays for their own, and what somebody else paid is theirs.
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../config';
import type { PoolRider } from '../domain/types';

const GENDER_MARK: Record<string, string> = {
  male: '♂',
  female: '♀',
  unspecified: '',
};

const KIND_LABEL: Record<PoolRider['kind'], string> = {
  host: 'started this ride',
  share: 'joined by invite',
  enroute: 'picked up on the way',
};

export function PoolRidersCard({
  riders,
  youUid,
  driverPhone,
}: {
  riders: PoolRider[];
  youUid?: string;
  driverPhone?: string | null;
}) {
  // A single rider is not a pool anyone needs telling about — that is just a ride.
  if (!riders || riders.length < 2) return null;

  const you = riders.find((r) => r.uid === youUid);
  const others = riders.filter((r) => r.uid !== youUid);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Sharing this car</Text>
        <Text style={styles.count}>{riders.length} riders</Text>
      </View>

      {others.map((r) => (
        <View key={r.uid} style={styles.row}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(r.name?.[0] ?? '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {r.name?.split(' ')[0] ?? 'Rider'} {GENDER_MARK[r.gender] ?? ''}
            </Text>
            <Text style={styles.detail} numberOfLines={1}>
              {r.pickup?.address ?? 'Pickup'} → {r.dropoff?.address ?? 'Drop-off'}
            </Text>
            <Text style={styles.kind}>{KIND_LABEL[r.kind]}</Text>
          </View>
        </View>
      ))}

      {you && (
        <View style={styles.yourFare}>
          <Text style={styles.yourFareLabel}>Your fare</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.yourFareValue}>PKR {you.fare}</Text>
            {you.soloFare > you.fare && (
              <Text style={styles.yourFareSaving}>
                saved PKR {you.soloFare - you.fare} by sharing
              </Text>
            )}
          </View>
        </View>
      )}

      {driverPhone ? (
        <Pressable
          style={styles.callBtn}
          onPress={() => Linking.openURL(`tel:${driverPhone}`)}
        >
          <Text style={styles.callBtnText}>📞 Something not right? Call the driver</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  count: { color: colors.muted, fontSize: 12 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${colors.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '800', fontSize: 15 },
  name: { color: colors.text, fontSize: 14, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 12, marginTop: 1 },
  kind: { color: colors.muted, fontSize: 11, marginTop: 1, fontStyle: 'italic' },

  yourFare: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  yourFareLabel: { color: colors.muted, fontSize: 13 },
  yourFareValue: { color: colors.text, fontSize: 17, fontWeight: '800' },
  yourFareSaving: { color: colors.primary, fontSize: 11, marginTop: 1 },

  callBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  callBtnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
