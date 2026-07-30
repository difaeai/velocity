/**
 * Find your Customers — the one screen that knows where the business stands.
 *
 * Five states, one route, because a business owner should be able to tap the
 * same thing every time and be shown whatever is true right now:
 *
 *   none      → the pitch and the price list
 *   pending   → what they submitted and what it cost, while a human looks
 *   rejected  → why, and the way back in
 *   active    → the results, the offers, and the buttons that change them
 *   expired   → the results they got, and renew
 *
 * The numbers sit ABOVE the offers on purpose. Someone paying 5,500 a month is
 * buying reach; the first thing they want on opening this screen is whether they
 * got any, not a list of what they wrote.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../src/api/client';
import type { BusinessAd, BusinessAdDashboard } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { useBusinessAdDashboard } from '../../../src/hooks/businessAds';
import { themed } from '../../../src/theme';
import { Text } from '../../../src/ui/Text';
import { PrimaryButton } from '../../../src/ui/components';
import { formatPKR, ErrorState, SectionTitle, Skeleton, StatTile } from '../../../src/ui/partner';

export default function BusinessAdsHome() {
  const router = useRouter();
  const { data, loading, error, reload } = useBusinessAdDashboard();
  const [busyAdId, setBusyAdId] = useState<string | null>(null);

  // Coming back from the composer or the payment flow must not show stale
  // numbers — the whole screen is a status report.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function toggleAd(ad: BusinessAd) {
    const next = ad.status === 'active' ? 'paused' : 'active';
    setBusyAdId(ad.adId);
    try {
      await api.setBusinessAdStatus({ adId: ad.adId, status: next });
      await reload();
    } catch (e) {
      Alert.alert('Could not change that', (e as { message?: string }).message ?? 'Try again.');
    } finally {
      setBusyAdId(null);
    }
  }

  function confirmDelete(ad: BusinessAd) {
    Alert.alert('Delete this offer?', 'Its results stay in your totals, but it stops running.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyAdId(ad.adId);
          try {
            await api.setBusinessAdStatus({ adId: ad.adId, status: 'removed' });
            await reload();
          } catch (e) {
            Alert.alert('Could not delete', (e as { message?: string }).message ?? 'Try again.');
          } finally {
            setBusyAdId(null);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/business'))}
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Find your Customers</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.primary} />}
      >
        {loading && !data ? (
          <View style={{ gap: 12 }}>
            <Skeleton height={120} />
            <Skeleton height={90} />
            <Skeleton height={160} />
          </View>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? null : data.stage === 'none' || data.stage === 'rejected' || data.stage === 'resubmit' ? (
          <Pitch data={data} onStart={() => router.push('/passenger/business-ads/subscribe')} />
        ) : data.stage === 'pending' ? (
          <Pending data={data} />
        ) : (
          <Live
            data={data}
            busyAdId={busyAdId}
            onToggle={toggleAd}
            onDelete={confirmDelete}
            onNewAd={() => router.push('/passenger/business-ads/compose')}
            onEditAd={(ad) => router.push(`/passenger/business-ads/compose?adId=${ad.adId}`)}
            onAnalytics={() => router.push('/passenger/business-ads/analytics')}
            onRenew={() => router.push('/passenger/business-ads/subscribe')}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── State: never advertised, or turned down ──────────────────────────────────

function Pitch({ data, onStart }: { data: BusinessAdDashboard; onStart: () => void }) {
  const reason = data.application?.rejectionReason;
  return (
    <View style={{ gap: 14 }}>
      {reason ? (
        <View style={styles.alertCard}>
          <Text style={styles.alertTitle}>
            {data.stage === 'resubmit' ? 'We need another look' : 'Not approved'}
          </Text>
          <Text style={styles.alertBody}>{reason}</Text>
        </View>
      ) : null}

      <View style={styles.heroCard}>
        <Text style={styles.heroEmoji}>📣</Text>
        <Text style={styles.heroTitle}>Reach the people who pass your door</Text>
        <Text style={styles.heroBody}>
          Publish your offer and every Velocity user inside your radius gets it as
          a notification on their phone — with your picture, your business name and
          your offer. You see how many were reached and how many opened it.
        </Text>
      </View>

      <SectionTitle>What it costs</SectionTitle>
      <View style={styles.priceRow}>
        <View style={styles.priceCard}>
          <Text style={styles.priceRadius}>Up to 3 km</Text>
          <Text style={styles.priceAmount}>{formatPKR(5500)}</Text>
          <Text style={styles.priceMeta}>per month · 1 offer running</Text>
        </View>
        <View style={styles.priceCard}>
          <Text style={styles.priceRadius}>3–5 km</Text>
          <Text style={styles.priceAmount}>{formatPKR(7000)}</Text>
          <Text style={styles.priceMeta}>per month · 3 offers running</Text>
        </View>
      </View>
      <Text style={styles.priceNote}>
        Live prices are confirmed on the next screen. Pay for 3, 6 or 12 months in
        one transfer.
      </Text>

      <PrimaryButton label="Get started" onPress={onStart} />
    </View>
  );
}

// ── State: waiting on a human ────────────────────────────────────────────────

function Pending({ data }: { data: BusinessAdDashboard }) {
  const app = data.application;
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.waitCard}>
        <Text style={styles.waitEmoji}>⏳</Text>
        <Text style={styles.waitTitle}>Waiting for approval</Text>
        <Text style={styles.waitBody}>
          Our team is checking your payment. You&apos;ll get a notification the moment
          it&apos;s approved — then you publish your offer and it starts going out.
        </Text>
      </View>

      {app ? (
        <View style={styles.summaryCard}>
          <Row label="Radius" value={`${app.radiusKm} km`} />
          <Row label="Plan" value={`${app.months} months`} />
          <Row label="Monthly" value={formatPKR(app.monthlyFee)} />
          <Row label="Paid" value={formatPKR(app.totalFee)} strong />
        </View>
      ) : null}

      {app?.draft ? (
        <>
          <SectionTitle>The offer you submitted</SectionTitle>
          <View style={styles.previewCard}>
            {app.draft.imageUrl ? (
              <Image source={{ uri: app.draft.imageUrl }} style={styles.previewImage} />
            ) : null}
            <View style={{ padding: 14, gap: 4 }}>
              <Text style={styles.previewBiz}>{app.draft.businessName}</Text>
              <Text style={styles.previewTitle}>{app.draft.title}</Text>
              <Text style={styles.previewBody}>{app.draft.offerDetails}</Text>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

// ── State: running, suspended, or lapsed ─────────────────────────────────────

function Live({
  data,
  busyAdId,
  onToggle,
  onDelete,
  onNewAd,
  onEditAd,
  onAnalytics,
  onRenew,
}: {
  data: BusinessAdDashboard;
  busyAdId: string | null;
  onToggle: (ad: BusinessAd) => void;
  onDelete: (ad: BusinessAd) => void;
  onNewAd: () => void;
  onEditAd: (ad: BusinessAd) => void;
  onAnalytics: () => void;
  onRenew: () => void;
}) {
  const a = data.advertiser;
  if (!a) return null;
  const expired = data.stage === 'expired';
  const suspended = data.stage === 'suspended';
  const slotsFull = a.liveAds >= a.adSlots;

  return (
    <View style={{ gap: 14 }}>
      {suspended ? (
        <View style={styles.alertCard}>
          <Text style={styles.alertTitle}>Advertising paused by Velocity</Text>
          <Text style={styles.alertBody}>
            {a.suspensionReason ?? 'Contact support to get your offers running again.'}
          </Text>
        </View>
      ) : null}
      {expired ? (
        <View style={styles.alertCard}>
          <Text style={styles.alertTitle}>Your plan has ended</Text>
          <Text style={styles.alertBody}>
            Your offers stopped going out. Renew and they start again — your
            results below are kept.
          </Text>
        </View>
      ) : null}

      <View style={styles.planCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planBiz} numberOfLines={1}>{a.businessName}</Text>
          <Text style={styles.planMeta}>
            {a.radiusKm} km radius · {a.adSlots} offer{a.adSlots === 1 ? '' : 's'} at a time
          </Text>
          {a.daysLeft !== null && !expired ? (
            <Text style={styles.planDays}>{a.daysLeft} days left on this plan</Text>
          ) : null}
        </View>
        <Pressable style={styles.renewBtn} onPress={onRenew}>
          <Text style={styles.renewTxt}>{expired ? 'Renew' : 'Extend'}</Text>
        </Pressable>
      </View>

      <SectionTitle
        action={
          <Pressable onPress={onAnalytics} hitSlop={8}>
            <Text style={styles.linkTxt}>Details ›</Text>
          </Pressable>
        }
      >
        Your results
      </SectionTitle>
      <View style={styles.tileRow}>
        <StatTile label="People reached" value={String(data.totals.reach)} hint="unique users" />
        <StatTile label="Notifications" value={String(data.totals.notified)} hint="sent" />
      </View>
      <View style={styles.tileRow}>
        <StatTile
          label="Opened"
          value={String(data.totals.clicks)}
          hint="tapped your offer"
          accent={colors.primary}
        />
        <StatTile label="Open rate" value={`${data.totals.ctr}%`} hint="of people reached" />
      </View>

      <SectionTitle
        action={
          !expired && !suspended ? (
            <Pressable onPress={onNewAd} hitSlop={8}>
              <Text style={styles.linkTxt}>+ New offer</Text>
            </Pressable>
          ) : undefined
        }
      >
        Your offers ({a.liveAds}/{a.adSlots} running)
      </SectionTitle>

      {data.ads.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No offer published yet</Text>
          <Text style={styles.emptyBody}>
            Publish one and it starts reaching people inside your {a.radiusKm} km radius.
          </Text>
          <PrimaryButton label="Publish your offer" onPress={onNewAd} />
        </View>
      ) : (
        data.ads.map((ad) => (
          <View key={ad.adId} style={styles.adCard}>
            {ad.imageUrl ? <Image source={{ uri: ad.imageUrl }} style={styles.adImage} /> : null}
            <View style={{ padding: 14, gap: 8 }}>
              <View style={styles.adTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.previewBiz}>{ad.businessName}</Text>
                  <Text style={styles.previewTitle}>{ad.title}</Text>
                </View>
                <View style={[styles.statusPill, ad.status === 'active' ? styles.statusLive : null]}>
                  <Text
                    style={[
                      styles.statusTxt,
                      ad.status === 'active' ? { color: colors.primary } : null,
                    ]}
                  >
                    {ad.status === 'active' ? 'LIVE' : 'PAUSED'}
                  </Text>
                </View>
              </View>
              <Text style={styles.previewBody} numberOfLines={3}>{ad.offerDetails}</Text>

              {ad.moderationReason ? (
                <Text style={styles.modNote}>Taken down by Velocity: {ad.moderationReason}</Text>
              ) : null}

              <View style={styles.adStatsRow}>
                <AdStat label="Reached" value={ad.reach} />
                <AdStat label="Sent" value={ad.notified} />
                <AdStat label="Opened" value={ad.clicks} />
              </View>

              <View style={styles.adActions}>
                <Pressable style={styles.adAction} onPress={() => onEditAd(ad)}>
                  <Text style={styles.adActionTxt}>Edit</Text>
                </Pressable>
                <Pressable
                  style={[styles.adAction, busyAdId === ad.adId && { opacity: 0.5 }]}
                  disabled={busyAdId === ad.adId || expired || suspended || (ad.status !== 'active' && slotsFull)}
                  onPress={() => onToggle(ad)}
                >
                  <Text style={styles.adActionTxt}>
                    {ad.status === 'active' ? 'Pause' : 'Resume'}
                  </Text>
                </Pressable>
                <Pressable style={styles.adAction} onPress={() => onDelete(ad)}>
                  <Text style={[styles.adActionTxt, { color: colors.danger }]}>Delete</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function AdStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.adStat}>
      <Text style={styles.adStatValue}>{value}</Text>
      <Text style={styles.adStatLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong ? { color: colors.primary, fontWeight: '900' } : null]}>
        {value}
      </Text>
    </View>
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

  heroCard: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 20,
    padding: 18,
    gap: 8,
  },
  heroEmoji: { fontSize: 30 },
  heroTitle: { fontSize: 19, fontWeight: '900', color: colors.text },
  heroBody: { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 19 },

  priceRow: { flexDirection: 'row', gap: 10 },
  priceCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 3,
  },
  priceRadius: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.5 },
  priceAmount: { fontSize: 19, fontWeight: '900', color: colors.text },
  priceMeta: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  priceNote: { fontSize: 11, color: colors.muted, fontWeight: '600', lineHeight: 16 },

  waitCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 8,
    alignItems: 'center',
  },
  waitEmoji: { fontSize: 34 },
  waitTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  waitBody: { fontSize: 13, color: colors.muted, fontWeight: '600', textAlign: 'center', lineHeight: 19 },

  alertCard: {
    backgroundColor: `${colors.danger}14`,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  alertTitle: { fontSize: 14, fontWeight: '900', color: colors.danger },
  alertBody: { fontSize: 12, color: colors.text, fontWeight: '600', lineHeight: 18 },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rowLabel: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '800' },

  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  planBiz: { fontSize: 16, fontWeight: '900', color: colors.text },
  planMeta: { fontSize: 12, color: colors.muted, fontWeight: '600', marginTop: 2 },
  planDays: { fontSize: 11, color: colors.primary, fontWeight: '800', marginTop: 4 },
  renewBtn: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  renewTxt: { fontSize: 13, fontWeight: '900', color: colors.primary },

  tileRow: { flexDirection: 'row', gap: 10 },
  linkTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    padding: 18,
    gap: 10,
  },
  emptyTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
  emptyBody: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 18 },

  previewCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  previewImage: { width: '100%', height: 170, backgroundColor: colors.background },
  previewBiz: { fontSize: 11, fontWeight: '900', color: colors.primary, letterSpacing: 0.4 },
  previewTitle: { fontSize: 16, fontWeight: '900', color: colors.text, marginTop: 1 },
  previewBody: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 18 },

  adCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  adImage: { width: '100%', height: 150, backgroundColor: colors.background },
  adTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  statusPill: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusLive: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  statusTxt: { fontSize: 9, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  modNote: { fontSize: 11, fontWeight: '700', color: colors.danger },

  adStatsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  adStat: { flex: 1 },
  adStatValue: { fontSize: 16, fontWeight: '900', color: colors.text },
  adStatLabel: { fontSize: 10, fontWeight: '700', color: colors.muted, letterSpacing: 0.3 },

  adActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  adAction: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  adActionTxt: { fontSize: 12, fontWeight: '800', color: colors.text },
}));
