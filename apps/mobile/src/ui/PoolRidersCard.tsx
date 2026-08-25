/**
 * Who else is in this car.
 * ---------------------------------------------------------------------------
 * A pool rider agreed to share a car with strangers — but agreeing to strangers
 * in the abstract is not the same as finding one in the back seat unannounced.
 * So everybody in the car appears here: their name, whether they are a man or a
 * woman, how they came to be aboard, and where they get in and out. The trip
 * document streams, so this updates the instant somebody joins, and a push
 * lands at the same time.
 *
 * If anything about it looks wrong, the call button is right there. That is the
 * point: the passenger finds out from us, before the car pulls over, and can
 * speak to the driver about it while there is still time to.
 *
 * TWO KINDS OF SHARED RIDE, ONE CARD
 * ----------------------------------
 * Velocity forms pools two ways and used to record them differently — the rich
 * `poolRiders` array for people picked up along the driver's route, and nothing
 * at all for a pool booked on the booking screen and joined by invite code. So
 * this card rendered for the first kind and silently never appeared for the
 * second, which is the kind most riders actually book: they shared a car with
 * two strangers and were never told. `sharedRidersFrom` flattens both into one
 * list, so whichever way the car filled up, everyone in it can see who is in it.
 *
 * Fares are shown for you and nobody else — what somebody else paid is theirs.
 * ---------------------------------------------------------------------------
 */
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colors } from '../config';
import { themed } from '../theme';
import type { PoolRider, PoolRosterEntry } from '../domain/types';

const GENDER_MARK: Record<string, string> = {
  male: '♂',
  female: '♀',
  unspecified: '',
};

const KIND_LABEL: Record<string, string> = {
  host: 'started this ride',
  share: 'joined this ride',
  enroute: 'picked up on the way',
};

/** One person in the car, however the ride came to have them in it. */
export interface SharedRider {
  uid: string;
  /** First name — that is all a co-rider is shown, and all we store. */
  name: string;
  gender: string;
  kind: 'host' | 'share' | 'enroute';
  pickupAddress: string | null;
  dropoffAddress: string | null;
  /** Only ever your own; null for everyone else. */
  fare: number | null;
  soloFare: number | null;
  /** True once the driver has let them out. */
  droppedOff: boolean;
}

/**
 * Everyone in the car, read off the trip document.
 *
 * `poolRiders` wins when it exists — an en-route trip has already priced each
 * rider against their own slice of the road, and that array is the full story.
 * Otherwise the destination-pool roster is used, where everyone shares one route
 * and one flat tier fare.
 */
export function sharedRidersFrom(
  trip: {
    poolRiders?: PoolRider[];
    poolRoster?: PoolRosterEntry[];
    poolMembers?: string[];
    poolPerSeatFare?: number;
    pickup?: { address?: string };
    dropoff?: { address?: string };
  },
  youUid?: string,
): SharedRider[] {
  const enRoute = trip.poolRiders ?? [];
  if (enRoute.length > 0) {
    return enRoute.map((r) => ({
      uid: r.uid,
      name: r.name?.split(' ')[0] ?? 'Rider',
      gender: r.gender,
      kind: r.kind,
      pickupAddress: (r.pickup as { address?: string } | undefined)?.address ?? null,
      dropoffAddress: (r.dropoff as { address?: string } | undefined)?.address ?? null,
      fare: r.uid === youUid ? r.fare : null,
      soloFare: r.uid === youUid ? r.soloFare : null,
      droppedOff: false,
    }));
  }

  const roster = trip.poolRoster ?? [];
  if (roster.length > 0) {
    return roster.map((r) => ({
      uid: r.uid,
      name: r.firstName || 'Rider',
      gender: String(r.gender ?? 'unspecified'),
      kind: r.kind,
      pickupAddress: r.pickupAddress,
      dropoffAddress: r.dropoffAddress,
      // One route, one tier — so your share is the pool fare on the trip.
      fare: r.uid === youUid ? (trip.poolPerSeatFare ?? null) : null,
      soloFare: null,
      droppedOff: !!r.droppedAt,
    }));
  }

  // A pool booked before the roster existed. We know the count and nothing
  // else, and saying "3 riders, names unknown" beats saying nothing at all.
  return (trip.poolMembers ?? []).map((uid, i) => ({
    uid,
    name: 'Rider',
    gender: 'unspecified',
    kind: (i === 0 ? 'host' : 'share') as SharedRider['kind'],
    pickupAddress: trip.pickup?.address ?? null,
    dropoffAddress: trip.dropoff?.address ?? null,
    fare: uid === youUid ? (trip.poolPerSeatFare ?? null) : null,
    soloFare: null,
    droppedOff: false,
  }));
}

export function PoolRidersCard({
  riders,
  youUid,
  driverPhone,
  seatsLeft,
}: {
  riders: SharedRider[];
  youUid?: string;
  driverPhone?: string | null;
  /** Seats still open, so the card can say the car may yet fill up further. */
  seatsLeft?: number;
}) {
  // A single rider is not a pool anyone needs telling about — that is just a ride.
  if (!riders || riders.length < 2) return null;

  const you = riders.find((r) => r.uid === youUid);
  const others = riders.filter((r) => r.uid !== youUid);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Sharing this car</Text>
        <Text style={styles.count}>
          {riders.length} rider{riders.length === 1 ? '' : 's'}
          {seatsLeft && seatsLeft > 0
            ? ` · ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} free`
            : ''}
        </Text>
      </View>

      {others.map((r) => (
        <View key={r.uid} style={styles.row}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(r.name?.[0] ?? '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {r.name} {GENDER_MARK[r.gender] ?? ''}
              {r.droppedOff ? '  · dropped off' : ''}
            </Text>
            <Text style={styles.detail} numberOfLines={1}>
              {r.pickupAddress ?? 'Pickup'} → {r.dropoffAddress ?? 'Drop-off'}
            </Text>
            <Text style={styles.kind}>{KIND_LABEL[r.kind] ?? 'in this car'}</Text>
          </View>
        </View>
      ))}

      {you && you.fare !== null && (
        <View style={styles.yourFare}>
          <Text style={styles.yourFareLabel}>Your fare</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.yourFareValue}>PKR {you.fare}</Text>
            {you.soloFare !== null && you.soloFare > you.fare && (
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

const styles = themed(() => StyleSheet.create({
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
}));
