/**
 * Somebody wants a seat in this car. The people already in it get a say.
 * ---------------------------------------------------------------------------
 * The driver decides who rides in their car, and that has not changed. But the
 * driver is not the person who will be sitting in the back seat, and there is
 * one case where they know least and the riders know most: a seat booked by one
 * person on another person's behalf.
 *
 * A woman books a shared ride for her brother. His seat is correctly recorded
 * as a man's, and the app matches him against men's rides — but the reverse
 * also happens, and the gender attached to such a seat is the booker's word
 * rather than a verified profile. The one thing stopping that word from being
 * enough is the people who would be sharing the car with it.
 *
 * So this card does two jobs, and which one a rider sees depends on who they
 * are on this ride:
 *
 *   • THE HOST of a ride with no driver yet is the one who answers. A driverless
 *     ride has nobody else to ask, and these requests only exist at all because
 *     the seat needed vetting.
 *   • ANY RIDER aboard can refuse, and a refusal is final — not a vote, not
 *     advice for the driver to weigh. A woman who will not share a back seat
 *     with this passenger does not need three other people to agree with her,
 *     and asking her to argue it with a driver over the phone is asking for
 *     something she will not do: she will cancel her own ride instead, and we
 *     will never learn why.
 *
 * The passenger being refused is never told who refused or why. An objection
 * with a name on it is an invitation to argue about it at the kerb.
 *
 * It renders nothing at all when there is nothing pending, which is almost
 * always — this is an exception-handling card, not a permanent fixture.
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { api, type PoolJoinRequest } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { useForegroundInterval } from '../hooks/useForegroundInterval';

const GENDER_MARK: Record<string, string> = { male: '♂', female: '♀' };

export function PoolJoinRequestsCard({
  tripId,
  /** True when this rider is the host AND the ride has no driver to ask. */
  canDecide,
  /** Bump to re-read — e.g. when a "someone wants to join" push lands. */
  refreshKey,
}: {
  tripId: string;
  canDecide: boolean;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<PoolJoinRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getPoolJoinRequests({ tripId })
      .then((r) => setRows(r.requests))
      // A rider who is not aboard any more is simply shown nothing, which is
      // the correct answer and not worth an error box on a live trip screen.
      .catch(() => setRows([]));
  }, [tripId]);

  useEffect(() => { load(); }, [load, refreshKey]);
  // Requests arrive while this screen is open and each one sends a push, but a
  // rider looking at the screen should not have to wait for one to notice.
  useForegroundInterval(load, 20_000);

  if (!rows || rows.length === 0) return null;

  async function decide(riderId: string, action: 'accept' | 'reject') {
    setBusy(riderId);
    try {
      await api.driverRespondToPoolJoin({ tripId, riderId, action });
      load();
    } catch (e) {
      Alert.alert('Could not answer', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function refuse(riderId: string, name: string) {
    Alert.alert(
      `Not share with ${name}?`,
      'They will not be given the seat. They are not told who declined.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setBusy(riderId);
            try {
              await api.coRiderObjectToPoolJoin({ tripId, riderId });
              load();
            } catch (e) {
              Alert.alert('Could not decline', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {rows.length === 1 ? 'Someone wants a seat' : `${rows.length} people want a seat`}
      </Text>

      {rows.map((r) => (
        <View key={r.riderId} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {r.riderName} {GENDER_MARK[r.riderGender] ?? ''}
            </Text>
            <Text style={styles.fare}>PKR {r.farePerSeat} for their seat</Text>
            {/* The one fact that makes this decision different from any other,
                and the reason riders are shown this card at all. */}
            {r.bookedForOther ? (
              <Text style={styles.warn}>
                Booked by someone else on this passenger’s behalf — we cannot confirm
                their gender from a profile.
              </Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            {busy === r.riderId ? (
              <ActivityIndicator color={colors.primary} />
            ) : canDecide ? (
              <>
                <Pressable
                  style={[styles.btn, styles.btnYes]}
                  onPress={() => decide(r.riderId, 'accept')}
                  accessibilityRole="button"
                  accessibilityLabel={`Accept ${r.riderName}`}
                >
                  <Text style={styles.btnYesTxt}>Accept</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnNo]}
                  onPress={() => decide(r.riderId, 'reject')}
                  accessibilityRole="button"
                  accessibilityLabel={`Decline ${r.riderName}`}
                >
                  <Text style={styles.btnNoTxt}>Decline</Text>
                </Pressable>
              </>
            ) : (
              /* Not this rider's decision to make — but still theirs to refuse,
                 and the wording says exactly that rather than implying a vote. */
              <Pressable
                style={[styles.btn, styles.btnNo]}
                onPress={() => refuse(r.riderId, r.riderName)}
                accessibilityRole="button"
                accessibilityLabel={`Decline sharing with ${r.riderName}`}
              >
                <Text style={styles.btnNoTxt}>Not with me</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}

      <Text style={styles.foot}>
        {canDecide
          ? 'This ride has no driver yet, so it is yours to answer. Anyone already in the car can also decline.'
          : 'If you decline, the seat is not given — your answer is final.'}
      </Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  name: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  fare: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    marginTop: 1,
  },
  warn: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnYes: {
    backgroundColor: colors.glassLime,
    borderColor: colors.primary,
  },
  btnYesTxt: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.primary,
  },
  btnNo: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  btnNoTxt: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.muted,
  },
  foot: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: colors.muted,
  },
}));
