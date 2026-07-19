/**
 * Earn with Velocity — the partner wallet.
 *
 * Four numbers, and the difference between them is the thing partners ask
 * support about most: why can I not withdraw what I earned? Because a fresh
 * commission is `pending` until the fraud-hold window elapses. That is stated on
 * the screen rather than left to be discovered.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { db } from '../../../src/firebase';
import { usePartnerDashboard } from '../../../src/hooks/partner';
import type { PartnerRideStatus, PartnerTxnStatus } from '../../../src/api/client';
import { RideStatusPill, Skeleton, StatTile, formatPKR } from '../../../src/ui/partner';

interface Txn {
  id: string;
  tripId: string;
  memberUid: string;
  rideFare: number;
  platformCommission: number;
  fleetCommission: number;
  rideStatus: PartnerRideStatus;
  status: PartnerTxnStatus;
  fleetType: 'driver' | 'passenger';
  createdAt: { seconds: number } | null;
}

const PAYMENT_LABEL: Record<PartnerTxnStatus, string> = {
  pending: 'Clearing',
  available: 'Available',
  reversed: 'Reversed',
};

export default function PartnerWallet() {
  const router = useRouter();
  const { user } = useAuth();
  const { data, loading } = usePartnerDashboard();
  const [txns, setTxns] = useState<Txn[] | null>(null);

  useEffect(() => {
    if (!user) return;
    // Live: a commission maturing while the partner is looking at the screen
    // should move from Clearing to Available in front of them.
    const q = query(
      collection(db, 'partner_transactions'),
      where('partnerId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(
      q,
      (snap) => setTxns(snap.docs.map((d) => ({ ...(d.data() as Omit<Txn, 'id'>), id: d.id }))),
      () => setTxns([]),
    );
  }, [user]);

  const wallet = data?.wallet;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FlatList
        data={txns ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            {loading && !wallet ? (
              <Skeleton height={150} radius={20} />
            ) : (
              <>
                <View style={s.tiles}>
                  <StatTile
                    label="Current balance"
                    value={formatPKR(wallet?.balance ?? 0)}
                    accent={colors.primary}
                    hint="ready to withdraw"
                  />
                  <StatTile
                    label="Pending earnings"
                    value={formatPKR(wallet?.pending ?? 0)}
                    hint="still clearing"
                  />
                  <StatTile label="Withdrawn" value={formatPKR(wallet?.withdrawn ?? 0)} />
                  <StatTile label="Lifetime earnings" value={formatPKR(wallet?.lifetimeEarnings ?? 0)} />
                </View>

                <Pressable style={s.withdrawBtn} onPress={() => router.push('/passenger/earn/withdraw')}>
                  <Text style={s.withdrawText}>Withdraw</Text>
                </Pressable>

                {(wallet?.pending ?? 0) > 0 ? (
                  <Text style={s.note}>
                    {formatPKR(wallet!.pending)} is still clearing. New commission is held briefly so
                    that a ride later found to be fraudulent can be reversed before it is paid out.
                  </Text>
                ) : null}
              </>
            )}
            <Text style={s.sectionTitle}>Transactions</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.txn}>
            <View style={s.txnTop}>
              <RideStatusPill status={item.rideStatus} />
              <Text
                style={[
                  s.txnStatus,
                  item.status === 'reversed' && { color: colors.danger },
                  item.status === 'available' && { color: colors.primary },
                ]}
              >
                {PAYMENT_LABEL[item.status]}
              </Text>
            </View>

            <View style={s.txnRow}>
              <Text style={s.txnMeta}>
                {item.fleetType === 'driver' ? '🚗 Driver fleet' : '👤 Passenger fleet'} ·{' '}
                {item.createdAt
                  ? new Date(item.createdAt.seconds * 1000).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })
                  : ''}
              </Text>
              <Text
                style={[
                  s.txnAmount,
                  item.status === 'reversed' && s.txnAmountVoid,
                ]}
              >
                {item.status === 'reversed' ? formatPKR(0) : `+${formatPKR(item.fleetCommission)}`}
              </Text>
            </View>

            <Text style={s.txnDetail}>
              Fare {formatPKR(item.rideFare)} · platform commission {formatPKR(item.platformCommission)}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          txns === null ? (
            <View style={{ gap: 10 }}>
              <Skeleton height={86} radius={14} />
              <Skeleton height={86} radius={14} />
            </View>
          ) : (
            <Text style={s.empty}>
              No commission yet. It appears here the moment a member of your fleet completes a
              genuine ride.
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 18, gap: 10, paddingBottom: 40 },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  withdrawBtn: {
    backgroundColor: colors.btnBg,
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  withdrawText: { color: colors.btnText, fontWeight: '900', fontSize: 15 },

  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 6 },

  txn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  txnTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  txnStatus: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  txnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  txnMeta: { color: colors.muted, fontSize: 12, flex: 1 },
  txnAmount: { color: colors.primary, fontSize: 16, fontWeight: '900' },
  txnAmountVoid: { color: colors.muted, textDecorationLine: 'line-through' },
  txnDetail: { color: colors.muted, fontSize: 11 },

  empty: { color: colors.muted, fontSize: 13, textAlign: 'center', padding: 30, lineHeight: 20 },
}));
