/**
 * Earn with Velocity — the partner dashboard.
 *
 * The hub. Every number here comes from one server call: the client is never
 * allowed to compute its own revenue, because a partner screenshots this screen
 * and disputes it, and the only defensible number is one the backend produced.
 */
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../../src/config';
import { usePartnerDashboard } from '../../../src/hooks/partner';
import type { RevenueBuckets } from '../../../src/api/client';
import {
  DashboardSkeleton,
  EarningsChart,
  LevelBadge,
  SectionTitle,
  Segmented,
  StatTile,
  formatPKR,
} from '../../../src/ui/partner';

type Window = keyof RevenueBuckets;

const WINDOWS: { key: Window; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'lifetime', label: 'Lifetime' },
];

export default function PartnerDashboard() {
  const router = useRouter();
  const { data, loading, error, reload } = usePartnerDashboard();
  const [window, setWindow] = useState<Window>('today');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  if (loading && !data) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.scroll}>
          <DashboardSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.center}>
          <Text style={s.errorText}>{error ?? 'Could not load your dashboard.'}</Text>
          <Pressable onPress={reload} style={s.retry}>
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { partner, fleets, wallet, overview, revenue, series } = data;
  const noFleets = !fleets.driver && !fleets.passenger;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={s.back}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.hello}>Earn with Velocity</Text>
            <Text style={s.name} numberOfLines={1}>{partner.fullName}</Text>
          </View>
          <LevelBadge level={partner.level} size="sm" />
        </View>

        {partner.status === 'suspended' ? (
          <View style={s.suspended}>
            <Text style={s.suspendedText}>
              Your partner account is suspended. Your fleets are not earning. Contact support.
            </Text>
          </View>
        ) : null}

        {/* Hero: the number the partner opened the app to see. */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>Available to withdraw</Text>
          <Text style={s.heroValue}>{formatPKR(wallet.balance)}</Text>
          <View style={s.heroMetaRow}>
            <Text style={s.heroMeta}>{formatPKR(wallet.pending)} clearing</Text>
            <Text style={s.heroDot}>·</Text>
            <Text style={s.heroMeta}>{formatPKR(wallet.lifetimeEarnings)} lifetime</Text>
          </View>
          <Pressable style={s.heroBtn} onPress={() => router.push('/passenger/earn/withdraw')}>
            <Text style={s.heroBtnText}>Withdraw</Text>
          </Pressable>
        </View>

        {noFleets ? (
          <Pressable style={s.cta} onPress={() => router.push('/passenger/earn/referral')}>
            <Text style={s.ctaTitle}>Create your first fleet →</Text>
            <Text style={s.ctaBody}>
              You are approved, but you have no fleet yet. Create one to get a referral code and
              start recruiting.
            </Text>
          </Pressable>
        ) : null}

        {/* Revenue, windowed. */}
        <View style={s.card}>
          <SectionTitle
            action={
              <Pressable onPress={() => router.push('/passenger/earn/revenue')}>
                <Text style={s.link}>Details</Text>
              </Pressable>
            }
          >
            Revenue
          </SectionTitle>
          <Segmented options={WINDOWS} value={window} onChange={setWindow} />
          <View style={s.tilesRow}>
            <StatTile label="Total" value={formatPKR(revenue.combined[window])} accent={colors.primary} />
            <StatTile label="Driver fleet" value={formatPKR(revenue.driver[window])} />
            <StatTile label="Passenger fleet" value={formatPKR(revenue.passenger[window])} />
            <StatTile
              label="Avg / ride"
              value={formatPKR(overview.avgCommissionPerRide)}
              hint="of platform commission"
            />
          </View>
        </View>

        {/* Single series, so no legend — the title names it. */}
        <View style={s.card}>
          <SectionTitle
            action={
              <Pressable onPress={() => router.push('/passenger/earn/analytics')}>
                <Text style={s.link}>Analytics</Text>
              </Pressable>
            }
          >
            Daily earnings · 30 days
          </SectionTitle>
          <EarningsChart points={series.map((p) => ({ date: p.date, value: p.earnings }))} />
        </View>

        <SectionTitle>Your fleets</SectionTitle>
        <View style={{ gap: 12 }}>
          <FleetCard
            emoji="🚗"
            title="Driver Fleet"
            fleet={fleets.driver}
            members={overview.totalDrivers}
            earnings={revenue.driver.lifetime}
            onPress={() =>
              fleets.driver
                ? router.push({ pathname: '/passenger/earn/fleet', params: { type: 'driver' } })
                : router.push('/passenger/earn/referral')
            }
          />
          <FleetCard
            emoji="👤"
            title="Passenger Fleet"
            fleet={fleets.passenger}
            members={overview.totalPassengers}
            earnings={revenue.passenger.lifetime}
            onPress={() =>
              fleets.passenger
                ? router.push({ pathname: '/passenger/earn/fleet', params: { type: 'passenger' } })
                : router.push('/passenger/earn/referral')
            }
          />
        </View>

        <SectionTitle>Manage</SectionTitle>
        <View style={s.grid}>
          <Tile emoji="💳" label="Wallet" onPress={() => router.push('/passenger/earn/wallet')} />
          <Tile emoji="🔗" label="Referral centre" onPress={() => router.push('/passenger/earn/referral')} />
          <Tile emoji="📈" label="Analytics" onPress={() => router.push('/passenger/earn/analytics')} />
          <Tile emoji="💰" label="Revenue" onPress={() => router.push('/passenger/earn/revenue')} />
        </View>

        {/* The rule, restated where the money is — so it is never a surprise. */}
        <View style={s.ruleNote}>
          <Text style={s.ruleNoteText}>
            You earn {formatPKR(overview.avgCommissionPerRide)} on average per completed ride — a
            share of Velocity's commission, not of the fare. Cancelled, scam and fraud rides pay
            nothing.
            {overview.flaggedRides > 0
              ? ` ${overview.flaggedRides} ride${overview.flaggedRides === 1 ? '' : 's'} in your fleets ${overview.flaggedRides === 1 ? 'was' : 'were'} flagged and paid zero.`
              : ''}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FleetCard({
  emoji,
  title,
  fleet,
  members,
  earnings,
  onPress,
}: {
  emoji: string;
  title: string;
  fleet: { code: string; members: number } | null;
  members: number;
  earnings: number;
  onPress: () => void;
}) {
  return (
    <Pressable style={s.fleetCard} onPress={onPress}>
      <Text style={s.fleetEmoji}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.fleetTitle}>{title}</Text>
        {fleet ? (
          <Text style={s.fleetMeta}>
            {members} member{members === 1 ? '' : 's'} · {formatPKR(earnings)} lifetime
          </Text>
        ) : (
          <Text style={s.fleetMeta}>Not created yet — tap to create</Text>
        )}
      </View>
      {fleet ? (
        <View style={s.codeChip}>
          <Text style={s.codeChipText}>{fleet.code}</Text>
        </View>
      ) : (
        <Text style={s.fleetArrow}>＋</Text>
      )}
    </Pressable>
  );
}

function Tile({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={s.gridTile} onPress={onPress}>
      <Text style={s.gridEmoji}>{emoji}</Text>
      <Text style={s.gridLabel}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 18, gap: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 },
  errorText: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  retryText: { color: colors.btnText, fontWeight: '800' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: colors.text, fontSize: 24, fontWeight: '700' },
  hello: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  name: { color: colors.text, fontSize: 19, fontWeight: '900' },

  suspended: {
    backgroundColor: `${colors.danger}1A`,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 14,
    padding: 14,
  },
  suspendedText: { color: colors.danger, fontSize: 13, fontWeight: '700', lineHeight: 19 },

  hero: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 22,
    padding: 20,
    gap: 4,
  },
  heroLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  heroValue: { color: colors.text, fontSize: 38, fontWeight: '900', letterSpacing: -1 },
  heroMetaRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 },
  heroMeta: { color: colors.muted, fontSize: 12 },
  heroDot: { color: colors.muted, fontSize: 12 },
  heroBtn: {
    marginTop: 14,
    backgroundColor: colors.btnBg,
    borderRadius: 12,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBtnText: { color: colors.btnText, fontWeight: '900', fontSize: 15 },

  cta: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 16,
    padding: 16,
    gap: 5,
  },
  ctaTitle: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  ctaBody: { color: colors.muted, fontSize: 13, lineHeight: 19 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  link: { color: colors.primary, fontSize: 13, fontWeight: '800' },

  tilesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  fleetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
  },
  fleetEmoji: { fontSize: 26 },
  fleetTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  fleetMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  fleetArrow: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  codeChip: {
    backgroundColor: colors.glassChip,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  codeChipText: { color: colors.text, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridTile: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 6,
  },
  gridEmoji: { fontSize: 22 },
  gridLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },

  ruleNote: {
    backgroundColor: colors.glassChip,
    borderRadius: 14,
    padding: 14,
  },
  ruleNoteText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
