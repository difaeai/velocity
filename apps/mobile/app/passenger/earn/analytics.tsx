/**
 * Earn with Velocity — analytics.
 *
 * Earnings and ride counts are different units, so they get separate charts
 * rather than a shared second y-axis. A dual-axis chart can be scaled to show
 * any correlation the author wants, which is exactly why it is never used here.
 */
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../../src/config';
import { usePartnerDashboard } from '../../../src/hooks/partner';
import {
  DashboardSkeleton,
  EarningsChart,
  LevelBadge,
  RideBars,
  SectionTitle,
  StatTile,
  formatPKR,
} from '../../../src/ui/partner';

export default function Analytics() {
  const { data, loading, reload } = usePartnerDashboard();
  const [refreshing, setRefreshing] = useState(false);

  const monthly = useMemo(() => {
    if (!data) return [];
    // Roll the 30 daily points into weeks — a month of daily bars on a phone is
    // 30 slivers nobody can read.
    const weeks: { date: string; value: number }[] = [];
    for (let i = 0; i < data.series.length; i += 7) {
      const chunk = data.series.slice(i, i + 7);
      const first = chunk[0];
      if (!first) continue;
      weeks.push({
        date: first.date,
        value: chunk.reduce((sum, p) => sum + p.rides, 0),
      });
    }
    return weeks;
  }, [data]);

  if (loading && !data) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.scroll}>
          <DashboardSkeleton />
        </View>
      </SafeAreaView>
    );
  }
  if (!data) return null;

  const { overview, partner, series } = data;
  const next = partner.nextLevel;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await reload();
              setRefreshing(false);
            }}
          />
        }
      >
        {/* Partner level + the honest distance to the next rung. */}
        <View style={s.levelCard}>
          <View style={s.levelTop}>
            <View>
              <Text style={s.levelLabel}>Partner level</Text>
              <View style={{ marginTop: 6 }}>
                <LevelBadge level={partner.level} />
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.levelStat}>{formatPKR(overview.lifetimeEarnings)}</Text>
              <Text style={s.levelStatLabel}>lifetime</Text>
            </View>
          </View>

          {next ? (
            <>
              <Text style={s.nextTitle}>To reach {next.level}</Text>
              <Progress
                label="Active members"
                value={overview.totalDrivers + overview.totalPassengers}
                target={next.minActiveMembers}
              />
              <Progress label="Completed rides" value={overview.completedRides} target={next.minCompletedRides} />
              <Progress
                label="Earnings"
                value={overview.lifetimeEarnings}
                target={next.minEarnings}
                money
              />
              <Text style={s.nextNote}>
                A low scam rate and steady month-on-month activity are also required — volume alone
                does not promote a partner.
              </Text>
            </>
          ) : (
            <Text style={s.nextNote}>You are at the top level. 💎</Text>
          )}
        </View>

        <View style={s.tiles}>
          <StatTile
            label="Avg commission / ride"
            value={formatPKR(overview.avgCommissionPerRide)}
          />
          <StatTile
            label="Scam rate"
            value={`${(overview.scamRate * 100).toFixed(1)}%`}
            accent={overview.scamRate > 0.05 ? colors.danger : undefined}
            hint={`${overview.flaggedRides} flagged`}
          />
          <StatTile label="Completed rides" value={String(overview.completedRides)} />
          <StatTile
            label="Active members"
            value={String(overview.totalDrivers + overview.totalPassengers)}
          />
        </View>

        <View style={s.card}>
          <SectionTitle>Daily earnings · 30 days</SectionTitle>
          <EarningsChart points={series.map((p) => ({ date: p.date, value: p.earnings }))} height={170} />
        </View>

        <View style={s.card}>
          <SectionTitle>Ride growth · weekly</SectionTitle>
          <RideBars points={monthly} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Progress({
  label,
  value,
  target,
  money,
}: {
  label: string;
  value: number;
  target: number;
  money?: boolean;
}) {
  const pct = target > 0 ? Math.min(1, value / target) : 1;
  const fmt = (n: number) => (money ? formatPKR(n) : String(n));

  return (
    <View style={s.progress}>
      <View style={s.progressTop}>
        <Text style={s.progressLabel}>{label}</Text>
        <Text style={s.progressValue}>
          {fmt(value)} / {fmt(target)}
        </Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 18, gap: 16, paddingBottom: 40 },

  levelCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  levelTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  levelLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  levelStat: { color: colors.text, fontSize: 20, fontWeight: '900' },
  levelStatLabel: { color: colors.muted, fontSize: 11 },

  nextTitle: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 6 },
  nextNote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },

  progress: { gap: 6 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { color: colors.muted, fontSize: 12 },
  progressValue: { color: colors.text, fontSize: 12, fontWeight: '800' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.glassChip, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
  },
});
