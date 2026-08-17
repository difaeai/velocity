/**
 * Find your Customers — the analytics the advertiser is really buying.
 *
 * Four numbers matter and they are not interchangeable:
 *
 *   Sent      — notifications delivered. Grows every 12-hour window.
 *   Reached   — DISTINCT people. This is the audience size they paid for.
 *   Opened    — taps that landed on the offer screen. The only proof of interest.
 *   Open rate — Opened ÷ Reached, deliberately not Opened ÷ Sent. Dividing by
 *               sends would punish an advertiser for the repeat delivery WE
 *               chose to give them, and make a good campaign look mediocre.
 *
 * The 7-day bars are per day, all offers combined, because the question this
 * screen answers is "is my advertising working" — the per-offer split lives
 * underneath for when the answer is "one of them is".
 */
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../../src/config';
import { useBusinessAdDashboard } from '../../../src/hooks/businessAds';
import { themed } from '../../../src/theme';
import { Text } from '../../../src/ui/Text';
import { ErrorState, RideBars, SectionTitle, Skeleton, StatTile } from '../../../src/ui/partner';

export default function BusinessAdAnalytics() {
  const router = useRouter();
  // Shares the cached dashboard payload with the screen that linked here, so
  // arriving on it costs nothing — the numbers are already in memory.
  const { data, loading, refreshing, error, reload } = useBusinessAdDashboard();

  const reachPoints = (data?.series ?? []).map((row) => ({ date: row.day, value: row.reach }));
  const clickPoints = (data?.series ?? []).map((row) => ({ date: row.day, value: row.clicks }));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Your results</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing && !!data} onRefresh={reload} tintColor={colors.primary} />
        }
      >
        {loading ? (
          <View style={{ gap: 12 }}>
            <Skeleton height={80} />
            <Skeleton height={160} />
            <Skeleton height={160} />
          </View>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || !data.advertiser ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No results yet</Text>
            <Text style={styles.emptyBody}>
              Buy a plan and publish an offer — the numbers appear here as soon as it
              starts reaching people.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.tileRow}>
              <StatTile
                label="People reached"
                value={String(data.totals.reach)}
                hint="unique users near you"
                accent={colors.primary}
              />
              <StatTile label="Opened" value={String(data.totals.clicks)} hint="tapped your offer" />
            </View>
            <View style={styles.tileRow}>
              <StatTile label="Notifications sent" value={String(data.totals.notified)} hint="incl. repeats" />
              <StatTile label="Open rate" value={`${data.totals.ctr}%`} hint="of people reached" />
            </View>

            <View style={styles.explainCard}>
              <Text style={styles.explainTxt}>
                &quot;Sent&quot; is higher than &quot;reached&quot; because anyone still inside your
                {' '}{data.advertiser.radiusKm} km radius gets your offer again every 12 hours. Open
                rate is measured against people, not sends.
              </Text>
            </View>

            <SectionTitle>New people reached, last 7 days</SectionTitle>
            <View style={styles.chartCard}>
              <RideBars points={reachPoints} />
            </View>

            <SectionTitle>Offers opened, last 7 days</SectionTitle>
            <View style={styles.chartCard}>
              <RideBars points={clickPoints} />
            </View>

            <SectionTitle>By offer</SectionTitle>
            {data.ads.length === 0 ? (
              <Text style={styles.emptyBody}>No offers published yet.</Text>
            ) : (
              data.ads.map((ad) => {
                const rate = ad.reach > 0 ? Math.round((ad.clicks / ad.reach) * 1000) / 10 : 0;
                return (
                  <View key={ad.adId} style={styles.adRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.adTitle} numberOfLines={1}>{ad.title}</Text>
                      <Text style={styles.adMeta}>
                        {ad.status === 'active' ? 'Running' : 'Paused'} · {ad.notified} sent
                      </Text>
                    </View>
                    <View style={styles.adNums}>
                      <Text style={styles.adNum}>{ad.reach}</Text>
                      <Text style={styles.adNumLabel}>reached</Text>
                    </View>
                    <View style={styles.adNums}>
                      <Text style={[styles.adNum, { color: colors.primary }]}>{ad.clicks}</Text>
                      <Text style={styles.adNumLabel}>opened</Text>
                    </View>
                    <View style={styles.adNums}>
                      <Text style={styles.adNum}>{rate}%</Text>
                      <Text style={styles.adNumLabel}>rate</Text>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { padding: 16, paddingBottom: 40, gap: 12 },

  tileRow: { flexDirection: 'row', gap: 10 },
  explainCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  explainTxt: { fontSize: 11, fontWeight: '600', color: colors.muted, lineHeight: 17 },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },

  adRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  adTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  adMeta: { fontSize: 10, fontWeight: '600', color: colors.muted, marginTop: 2 },
  adNums: { alignItems: 'center', minWidth: 48 },
  adNum: { fontSize: 15, fontWeight: '900', color: colors.text },
  adNumLabel: { fontSize: 9, fontWeight: '700', color: colors.muted },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
  emptyBody: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 18 },
}));
