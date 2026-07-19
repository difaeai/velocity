/**
 * Earn with Velocity — combined revenue.
 *
 * Total first, then the two fleets that make it up. The split bar is the only
 * place in the app where driver and passenger series share an axis, so it is
 * legended and direct-labelled — the percentages are readable without colour.
 */
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RevenueBuckets } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { usePartnerDashboard } from '../../../src/hooks/partner';
import {
  DashboardSkeleton,
  ErrorState,
  FleetSplitBar,
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

export default function Revenue() {
  const { data, loading, error, reload } = usePartnerDashboard();
  const [window, setWindow] = useState<Window>('lifetime');
  const [refreshing, setRefreshing] = useState(false);

  if (loading && !data) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.scroll}>
          <DashboardSkeleton />
        </View>
      </SafeAreaView>
    );
  }
  if (error || !data) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <ErrorState message={error ?? 'Could not load your revenue.'} onRetry={reload} />
      </SafeAreaView>
    );
  }

  const { revenue, rides, overview } = data;

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
        <Segmented options={WINDOWS} value={window} onChange={setWindow} />

        <View style={s.totalCard}>
          <Text style={s.totalLabel}>Total revenue · {WINDOWS.find((w) => w.key === window)!.label}</Text>
          <Text style={s.total}>{formatPKR(revenue.combined[window])}</Text>
          <Text style={s.totalMeta}>
            from {rides.combined[window]} completed ride{rides.combined[window] === 1 ? '' : 's'}
          </Text>
        </View>

        <View style={s.card}>
          <SectionTitle>Where it came from</SectionTitle>
          <FleetSplitBar driver={revenue.driver[window]} passenger={revenue.passenger[window]} />
        </View>

        <SectionTitle>🚗 Driver fleet</SectionTitle>
        <View style={s.tiles}>
          <StatTile label="Revenue" value={formatPKR(revenue.driver[window])} accent={colors.primary} />
          <StatTile label="Completed rides" value={String(rides.driver[window])} />
          <StatTile label="Drivers" value={String(overview.totalDrivers)} />
        </View>

        <SectionTitle>👤 Passenger fleet</SectionTitle>
        <View style={s.tiles}>
          <StatTile label="Revenue" value={formatPKR(revenue.passenger[window])} accent={colors.primary} />
          <StatTile label="Completed trips" value={String(rides.passenger[window])} />
          <StatTile label="Passengers" value={String(overview.totalPassengers)} />
        </View>

        <View style={s.note}>
          <Text style={s.noteText}>
            Every figure here is a share of Velocity's platform commission on rides your members
            completed — never a share of the fare itself.
            {overview.flaggedRides > 0
              ? ` ${overview.flaggedRides} flagged ride${overview.flaggedRides === 1 ? '' : 's'} contributed nothing.`
              : ''}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 18, gap: 16, paddingBottom: 40 },

  totalCard: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 20,
    padding: 20,
    gap: 3,
  },
  totalLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  total: { color: colors.text, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  totalMeta: { color: colors.muted, fontSize: 12 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  note: { backgroundColor: colors.glassChip, borderRadius: 14, padding: 14 },
  noteText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
}));
