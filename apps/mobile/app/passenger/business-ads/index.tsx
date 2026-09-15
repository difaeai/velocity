/**
 * Find your Customers — the one screen that knows where the business stands.
 *
 * Five states, one route, because a business owner should be able to tap the
 * same thing every time and be shown whatever is true right now:
 *
 *   none      → the pitch and the price list
 *   pending   → what they submitted and what it cost, while a human looks
 *   rejected  → why, and the way back in
 *   active    → the results, who saw it, what they asked, and the offers
 *   expired   → the results they got, and renew
 *
 * The numbers sit ABOVE the offers on purpose. Someone paying 5,500 a month is
 * buying reach; the first thing they want on opening this screen is whether they
 * got any, not a list of what they wrote. Then, in order: how many people
 * actually looked ("Seen by"), and the customers waiting on an answer
 * ("Queries") — the one section that asks the owner to do something.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEMO_OFFER, demoPreview } from '../../../src/ads/demoOffer';
import { api } from '../../../src/api/client';
import type { BusinessAd, BusinessAdDashboard } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { useBusinessAdDashboard, useBusinessAdQueries } from '../../../src/hooks/businessAds';
import {
  registerForPushNotifications,
  useNotificationPermission,
} from '../../../src/lib/notifications';
import { themed } from '../../../src/theme';
import { Text } from '../../../src/ui/Text';
import { QueriesSection, ResultsFunnel, SeenBySection } from '../../../src/ui/businessAds';
import { PrimaryButton } from '../../../src/ui/components';
import { formatPKR, ErrorState, SectionTitle, Skeleton } from '../../../src/ui/partner';

export default function BusinessAdsHome() {
  const router = useRouter();
  const { data, loading, refreshing, error, reload } = useBusinessAdDashboard();
  const [busyAdId, setBusyAdId] = useState<string | null>(null);

  // Coming back from the composer or the payment flow must not show stale
  // numbers — the whole screen is a status report. This is a revalidation
  // behind whatever is already on screen, not a reason to blank it.
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
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
          style={styles.headerBtn}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Find my Customers</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing && !!data} onRefresh={reload} tintColor={colors.primary} />}
      >
        {/* The stage block is the only part of this screen that needs the server.
            On every open after the first it comes out of the cache and renders
            on the first frame; `loading` now means "first open, fresh install",
            and even then it is one slim strip rather than a screenful of grey. */}
        {loading ? (
          <PlanPlaceholder />
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
            onAllQueries={() => router.push('/passenger/business-ads/queries')}
            onOpenQuery={(id) => router.push(`/passenger/offer-query/${id}`)}
          />
        )}

        {/* Outside the state switch on purpose: a business owner wants to see the
            notification before they pay, while they wait for approval, and again
            when they are writing their third offer. It is the same demo in all
            five states, so it lives in one place.

            It is also rendered while the stage is still loading, because none of
            it comes from the server — holding back content we already have just
            to keep a spinner company is what made this screen feel dead. */}
        <DemoNotificationCard />
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * First open on a fresh install, and nothing else.
 *
 * Deliberately small. The old version stacked three big grey blocks down the
 * whole screen, which reads as "this app is broken" rather than "one number is
 * on its way" — and it hid the demo card underneath it, which needed no server
 * at all. One strip, one honest line of text, and the real content below it.
 */
function PlanPlaceholder() {
  return (
    <View style={styles.placeholderCard}>
      <Skeleton height={13} width="55%" radius={6} />
      <Skeleton height={11} width="35%" radius={6} />
      <Text style={styles.placeholderNote}>Checking your advertising plan…</Text>
    </View>
  );
}

// ── State: never advertised, or turned down ──────────────────────────────────

const FEATURES = [
  { icon: '📍', title: 'On phones near your door', body: 'Your picture and offer, sent to people inside your radius.' },
  { icon: '👁', title: 'Seen by', body: 'Know exactly how many people opened your offer, day by day.' },
  { icon: '💬', title: 'Queries', body: 'Customers ask about the offer and you reply from here.' },
];

const STEPS = [
  { title: 'Choose your reach', body: 'Up to 3 km or up to 5 km, for 3, 6 or 12 months.' },
  { title: 'Publish your offer', body: 'Picture, business name and the deal — live after approval.' },
  { title: 'Get seen and asked', body: 'Watch who opened it and answer their questions.' },
];

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
        <View style={styles.kicker}>
          <Text style={styles.kickerTxt}>FOR BUSINESSES</Text>
        </View>
        <Text style={styles.heroTitle}>Reach the people who pass your door</Text>
        <Text style={styles.heroBody}>
          Every Velocity user inside your radius gets your offer as a notification —
          then you see who looked and answer what they ask.
        </Text>
        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Text style={styles.featureEmoji}>{f.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureBody}>{f.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <SectionTitle>Choose your reach</SectionTitle>
      <View style={styles.priceRow}>
        <View style={styles.priceCard}>
          <Text style={styles.priceRadius}>UP TO 3 KM</Text>
          <Text style={styles.priceAmount}>{formatPKR(5500)}</Text>
          <Text style={styles.priceMeta}>per month</Text>
          <View style={styles.priceChip}>
            <Text style={styles.priceChipTxt}>1 offer running</Text>
          </View>
        </View>
        <View style={[styles.priceCard, styles.priceCardFeatured]}>
          <View style={styles.priceBadge}>
            <Text style={styles.priceBadgeTxt}>MORE REACH</Text>
          </View>
          <Text style={styles.priceRadius}>3–5 KM</Text>
          <Text style={styles.priceAmount}>{formatPKR(7000)}</Text>
          <Text style={styles.priceMeta}>per month</Text>
          <View style={styles.priceChip}>
            <Text style={styles.priceChipTxt}>3 offers running</Text>
          </View>
        </View>
      </View>
      <Text style={styles.priceNote}>
        Live prices are confirmed on the next screen. Pay for 3, 6 or 12 months in
        one transfer.
      </Text>

      <PrimaryButton label="Get started" onPress={onStart} />

      <View style={styles.stepsCard}>
        <Text style={styles.stepsTitle}>How it works</Text>
        {STEPS.map((step, i) => (
          <View key={step.title} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumTxt}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepBody}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>
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
  onAllQueries,
  onOpenQuery,
}: {
  data: BusinessAdDashboard;
  busyAdId: string | null;
  onToggle: (ad: BusinessAd) => void;
  onDelete: (ad: BusinessAd) => void;
  onNewAd: () => void;
  onEditAd: (ad: BusinessAd) => void;
  onAnalytics: () => void;
  onRenew: () => void;
  onAllQueries: () => void;
  onOpenQuery: (queryId: string) => void;
}) {
  const queries = useBusinessAdQueries(!!data.advertiser);
  const a = data.advertiser;
  if (!a) return null;
  const expired = data.stage === 'expired';
  const suspended = data.stage === 'suspended';
  const slotsFull = a.liveAds >= a.adSlots;
  const planDays = Math.max(1, a.months * 30);
  const daysLeftPct = a.daysLeft === null ? 0 : Math.min(100, Math.round((a.daysLeft / planDays) * 100));
  const stateLabel = suspended ? 'PAUSED' : expired ? 'ENDED' : a.liveAds > 0 ? 'LIVE' : 'READY';

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
        <View style={styles.planTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.planStateRow}>
              <View style={[styles.stateDot, stateLabel === 'LIVE' ? styles.stateDotLive : null]} />
              <Text style={[styles.stateTxt, stateLabel === 'LIVE' ? { color: colors.primary } : null]}>
                {stateLabel}
              </Text>
            </View>
            <Text style={styles.planBiz} numberOfLines={1}>{a.businessName}</Text>
            <Text style={styles.planMeta}>
              {a.radiusKm} km radius · {a.liveAds}/{a.adSlots} offer{a.adSlots === 1 ? '' : 's'} running
            </Text>
          </View>
          <Pressable style={styles.renewBtn} onPress={onRenew}>
            <Text style={styles.renewTxt}>{expired ? 'Renew' : 'Extend'}</Text>
          </Pressable>
        </View>
        {a.daysLeft !== null && !expired ? (
          <View style={{ gap: 6 }}>
            <View style={styles.planTrack}>
              <View style={[styles.planFill, { width: `${daysLeftPct}%` }]} />
            </View>
            <Text style={styles.planDays}>{a.daysLeft} days left on this plan</Text>
          </View>
        ) : null}
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
      <ResultsFunnel data={data} />

      <SectionTitle>Seen by</SectionTitle>
      <SeenBySection data={data} ads={data.ads} />

      <SectionTitle
        action={
          queries.threads.length > 0 ? (
            <Pressable onPress={onAllQueries} hitSlop={8}>
              <Text style={styles.linkTxt}>See all ›</Text>
            </Pressable>
          ) : undefined
        }
      >
        {queries.unread > 0 ? `Queries · ${queries.unread} new` : 'Queries'}
      </SectionTitle>
      <QueriesSection
        threads={queries.threads}
        loading={queries.loading}
        onOpen={(t) => onOpenQuery(t.queryId)}
      />

      <SectionTitle
        action={
          !expired && !suspended ? (
            <Pressable onPress={onNewAd} hitSlop={8}>
              <Text style={styles.linkTxt}>+ New offer</Text>
            </Pressable>
          ) : undefined
        }
      >
        Your offers
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
        data.ads.map((ad) => {
          const live = ad.status === 'active';
          return (
            <View key={ad.adId} style={styles.adCard}>
              {ad.imageUrl ? (
                <View>
                  <Image source={{ uri: ad.imageUrl }} style={styles.adImage} />
                  <View style={[styles.statusPill, live ? styles.statusLive : null]}>
                    <Text style={[styles.statusTxt, live ? { color: '#000' } : null]}>
                      {live ? '● LIVE' : 'PAUSED'}
                    </Text>
                  </View>
                </View>
              ) : null}
              <View style={{ padding: 14, gap: 8 }}>
                <View>
                  <Text style={styles.previewBiz}>{ad.businessName}</Text>
                  <Text style={styles.previewTitle}>{ad.title}</Text>
                </View>
                <Text style={styles.previewBody} numberOfLines={2}>{ad.offerDetails}</Text>

                {ad.moderationReason ? (
                  <Text style={styles.modNote}>Taken down by Velocity: {ad.moderationReason}</Text>
                ) : null}

                <View style={styles.adStatsRow}>
                  <AdStat label="Reached" value={ad.reach} />
                  <AdStat label="Seen by" value={ad.viewers ?? 0} accent />
                  <AdStat label="Queries" value={ad.queries ?? 0} />
                </View>

                <View style={styles.adActions}>
                  <Pressable style={styles.adAction} onPress={() => onEditAd(ad)}>
                    <Text style={styles.adActionTxt}>Edit</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.adAction, busyAdId === ad.adId && { opacity: 0.5 }]}
                    disabled={busyAdId === ad.adId || expired || suspended || (!live && slotsFull)}
                    onPress={() => onToggle(ad)}
                  >
                    <Text style={styles.adActionTxt}>{live ? 'Pause' : 'Resume'}</Text>
                  </Pressable>
                  <Pressable style={styles.adAction} onPress={() => onDelete(ad)}>
                    <Text style={[styles.adActionTxt, { color: colors.danger }]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

// ── The demo: the notification, on the owner's own phone ─────────────────────

/**
 * "See it on your phone". Two ways to send, because they answer two different
 * questions:
 *
 *   Send now        → what does it look like? (arrives while you are watching)
 *   Send in 10 secs → does it reach me with Velocity closed? (lock the phone and
 *                     wait — this is the one that proves the point, because the
 *                     notification is delivered by the phone, not by the app)
 *
 * Pressable as many times as anyone likes; the server sends only to the caller's
 * own phone and counts it in nobody's advertising results.
 */
function DemoNotificationCard() {
  const router = useRouter();
  const [busy, setBusy] = useState<'now' | 'later' | null>(null);
  const [sent, setSent] = useState<{ title: string; body: string; pushed: boolean } | null>(null);
  const { permission, ready, ask, openSettings } = useNotificationPermission();
  const preview = sent ?? demoPreview();

  /**
   * Get permission BEFORE sending, and say why we want it in our own words
   * first. Firing the demo at a phone with notifications switched off and then
   * explaining the silence afterwards taught the user nothing except that the
   * button does not work.
   *
   * Returns false when there is no way to deliver, so `send` can stop rather
   * than burn a push nobody will ever see.
   */
  async function ensurePermission(): Promise<boolean> {
    if (permission === 'granted' || permission === 'unsupported') return true;

    if (permission === 'askable') {
      const next = await ask();
      if (next === 'granted' || next === 'unsupported') return true;
    }

    // Denied once already — Android will not show its dialog a second time, so
    // the switch has to be flipped in settings and there is no point pretending
    // otherwise.
    Alert.alert(
      'Allow notifications first',
      'Velocity needs permission to put the offer on your phone. Open Settings › Notifications and switch Velocity on, then come back and press send.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void openSettings() },
      ],
    );
    return false;
  }

  async function send(delaySeconds: number) {
    if (!(await ensurePermission())) return;

    setBusy(delaySeconds > 0 ? 'later' : 'now');
    try {
      // Belt and braces: re-registers the push token, which a first grant will
      // have just produced and a reinstall may have invalidated.
      await registerForPushNotifications();

      const res = await api.sendBusinessAdDemoNotification(
        delaySeconds > 0 ? { delaySeconds } : {},
      );
      setSent({ title: res.title, body: res.body, pushed: res.pushed });

      if (!res.pushed) {
        Alert.alert(
          'It could not reach your phone',
          'The offer is saved in your Velocity notifications. If notifications for Velocity are switched off in your phone settings, switch them on and send it again.',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Open settings', onPress: () => void openSettings() },
          ],
        );
      }
    } catch (e) {
      Alert.alert('Could not send the demo', (e as { message?: string }).message ?? 'Try again.');
    } finally {
      setBusy(null);
    }
  }

  const needsPermission = ready && permission !== 'granted' && permission !== 'unsupported';

  return (
    <View style={styles.demoCard}>
      <View style={styles.demoHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.demoTitle}>See it on your phone</Text>
          <Text style={styles.demoBody}>
            A sample offer from a made-up KFC branch — exactly how customers get
            yours. Only this phone is notified.
          </Text>
        </View>
        <View style={styles.demoChip}>
          <Text style={styles.demoChipTxt}>PREVIEW</Text>
        </View>
      </View>

      {needsPermission ? <PermissionAsk blocked={permission === 'blocked'} onAsk={ask} onOpenSettings={openSettings} /> : null}

      {/* A mock of the tray card, so the button is not a leap of faith. It sits
          on a strip styled like the top of a phone, so it reads as "the shade",
          not as another card on this screen. */}
      <View style={styles.shade}>
        <View style={styles.shadeBar}>
          <View style={styles.shadeNotch} />
        </View>
        <View style={styles.trayCard}>
          <View style={styles.trayHead}>
            <View style={styles.trayIcon}>
              <Text style={styles.trayIconTxt}>V</Text>
            </View>
            <Text style={styles.trayApp}>Velocity</Text>
            <Text style={styles.trayNow}>· now</Text>
          </View>
          <Text style={styles.trayTitle} numberOfLines={2}>{preview.title}</Text>
          <Text style={styles.trayBody} numberOfLines={2}>{preview.body}</Text>
          <Image source={{ uri: DEMO_OFFER.imageUrl }} style={styles.trayImage} resizeMode="cover" />
        </View>
      </View>

      <PrimaryButton
        label={busy === 'now' ? 'Sending…' : 'Send it to my phone now'}
        onPress={() => send(0)}
        loading={busy === 'now'}
        disabled={busy === 'later'}
      />
      <Pressable
        style={({ pressed }) => [styles.demoLater, (busy || pressed) ? { opacity: busy ? 0.5 : 0.8 } : null]}
        disabled={!!busy}
        onPress={() => send(10)}
      >
        <Text style={styles.demoLaterTxt}>
          {busy === 'later' ? 'Close Velocity now — it arrives in a few seconds' : '⏱  Send in 10 seconds'}
        </Text>
      </Pressable>
      {busy !== 'later' ? (
        <Text style={styles.demoHint}>
          Tap it, then close the app — proves the offer arrives with Velocity closed.
        </Text>
      ) : null}

      {/* The other half of what they are buying: customers asking about it. */}
      <Pressable style={styles.demoAsk} onPress={() => router.push('/passenger/offer-query/demo')}>
        <Text style={styles.demoAskIcon}>💬</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.demoAskTitle}>Try a customer question</Text>
          <Text style={styles.demoAskBody}>Ask the sample KFC branch something, or answer one as the business.</Text>
        </View>
        <Text style={styles.demoAskArrow}>›</Text>
      </Pressable>

      {sent && sent.pushed ? (
        <View style={styles.demoSent}>
          <Text style={styles.demoSentNote}>
            ✓ Sent. Pull your notification shade down to see it — it stays there until
            you swipe it away, even with Velocity closed. Tap it to open the offer.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The ask, in the screen, before anything is sent.
 *
 * It is written for someone who has never thought about what a notification
 * permission is: it names the button they are about to be shown ("Allow"), and
 * it describes where the offer lands — swipe down from the top — because "you
 * will get a notification" means nothing to a shopkeeper who has never gone
 * looking for their notification shade.
 *
 * Two shapes, because they are two different problems. `askable` still has the
 * OS dialog available, so the button triggers it. `blocked` does not — Android
 * refuses to ask twice — so the only honest button sends them to settings.
 */
function PermissionAsk({
  blocked,
  onAsk,
  onOpenSettings,
}: {
  blocked: boolean;
  onAsk: () => Promise<unknown>;
  onOpenSettings: () => Promise<void>;
}) {
  return (
    <View style={styles.permCard}>
      <Text style={styles.permTitle}>🔔 Turn on notifications</Text>
      <Text style={styles.permBody}>
        {blocked
          ? 'Notifications for Velocity are switched off on this phone, so nothing can arrive. Open your phone settings, switch Velocity notifications on, and come back — the offer will land on your screen.'
          : 'Your phone will ask for permission — press Allow. Then the offer arrives on your screen, and swiping down from the top of the screen shows it any time, even with Velocity closed. This is exactly how your customers will see your own offer.'}
      </Text>
      <Pressable style={styles.permBtn} onPress={() => void (blocked ? onOpenSettings() : onAsk())}>
        <Text style={styles.permBtnTxt}>
          {blocked ? 'Open phone settings' : 'Allow notifications'}
        </Text>
      </Pressable>
    </View>
  );
}

function AdStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <View style={styles.adStat}>
      <Text style={[styles.adStatValue, accent ? { color: colors.primary } : null]}>{value.toLocaleString()}</Text>
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  back: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { padding: 16, paddingBottom: 40, gap: 14 },

  // ── Pitch
  heroCard: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 24,
    padding: 18,
    gap: 10,
  },
  kicker: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: colors.btnBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  kickerTxt: { fontSize: 10, fontWeight: '900', color: colors.btnText, letterSpacing: 1 },
  heroTitle: { fontSize: 24, fontWeight: '900', color: colors.text, lineHeight: 30 },
  heroBody: { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 19 },
  featureList: { gap: 10, marginTop: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureEmoji: { fontSize: 18 },
  featureTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  featureBody: { fontSize: 12, fontWeight: '600', color: colors.muted, lineHeight: 17 },

  priceRow: { flexDirection: 'row', gap: 10 },
  priceCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 2,
  },
  priceCardFeatured: { borderColor: colors.primary, borderWidth: 1.5 },
  priceBadge: {
    position: 'absolute',
    top: -9,
    right: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  priceBadgeTxt: { fontSize: 9, fontWeight: '900', color: colors.background, letterSpacing: 0.6 },
  priceRadius: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.6 },
  priceAmount: { fontSize: 21, fontWeight: '900', color: colors.text, marginTop: 4 },
  priceMeta: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  priceChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: colors.glassChip,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priceChipTxt: { fontSize: 10, fontWeight: '800', color: colors.text },
  priceNote: { fontSize: 11, color: colors.muted, fontWeight: '600', lineHeight: 16 },

  stepsCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  stepsTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumTxt: { fontSize: 12, fontWeight: '900', color: colors.primary },
  stepTitle: { fontSize: 13, fontWeight: '900', color: colors.text },
  stepBody: { fontSize: 12, fontWeight: '600', color: colors.muted, lineHeight: 17 },

  // ── Pending
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

  // ── Live
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planStateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  stateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
  stateDotLive: { backgroundColor: colors.primary },
  stateTxt: { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 1 },
  planBiz: { fontSize: 19, fontWeight: '900', color: colors.text },
  planMeta: { fontSize: 12, color: colors.muted, fontWeight: '600', marginTop: 2 },
  planTrack: { height: 6, borderRadius: 3, backgroundColor: colors.glassChip, overflow: 'hidden' },
  planFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  planDays: { fontSize: 11, color: colors.muted, fontWeight: '800' },
  renewBtn: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  renewTxt: { fontSize: 13, fontWeight: '900', color: colors.primary },

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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  adImage: { width: '100%', height: 150, backgroundColor: colors.background },
  statusPill: {
    position: 'absolute',
    top: 10,
    left: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusLive: { backgroundColor: '#ccff00' },
  statusTxt: { fontSize: 10, fontWeight: '900', color: '#ffffff', letterSpacing: 0.8 },
  modNote: { fontSize: 11, fontWeight: '700', color: colors.danger },

  adStatsRow: {
    flexDirection: 'row',
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
  },
  adStat: { flex: 1, alignItems: 'center' },
  adStatValue: { fontSize: 17, fontWeight: '900', color: colors.text },
  adStatLabel: { fontSize: 10, fontWeight: '700', color: colors.muted, letterSpacing: 0.3 },

  adActions: { flexDirection: 'row', gap: 8 },
  adAction: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  adActionTxt: { fontSize: 12, fontWeight: '800', color: colors.text },

  // ── Demo
  demoCard: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  demoHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  demoTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  demoBody: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 18, marginTop: 4 },
  demoChip: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    backgroundColor: colors.glassLime,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  demoChipTxt: { fontSize: 9, fontWeight: '900', color: colors.primary, letterSpacing: 0.8 },

  // Lime-bordered rather than red: this is a thing to switch on, not a failure.
  permCard: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  permTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  permBody: { fontSize: 12, color: colors.text, fontWeight: '600', lineHeight: 18 },
  permBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  permBtnTxt: { fontSize: 13, fontWeight: '900', color: colors.btnText },

  placeholderCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  placeholderNote: { fontSize: 12, color: colors.muted, fontWeight: '700', marginTop: 2 },

  // The mock shade. Deliberately flat grey-on-black rather than themed lime: it
  // is imitating the phone's notification shade, not the rest of this screen.
  shade: {
    backgroundColor: colors.glassChip,
    borderRadius: 18,
    padding: 8,
    paddingTop: 0,
    gap: 6,
  },
  shadeBar: { alignItems: 'center', paddingVertical: 6 },
  shadeNotch: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
  trayCard: {
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  trayHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trayIcon: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayIconTxt: { fontSize: 10, fontWeight: '900', color: '#000' },
  trayApp: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.3 },
  trayNow: { fontSize: 11, fontWeight: '700', color: colors.muted },
  trayTitle: { fontSize: 14, fontWeight: '900', color: colors.text, marginTop: 2 },
  trayBody: { fontSize: 12, fontWeight: '600', color: colors.muted, lineHeight: 17 },
  trayImage: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    marginTop: 6,
    backgroundColor: colors.surface,
  },

  demoLater: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  demoLaterTxt: { fontSize: 14, fontWeight: '900', color: colors.primary },
  demoHint: { fontSize: 11, fontWeight: '600', color: colors.muted, textAlign: 'center', marginTop: -4 },
  demoAsk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: 12,
  },
  demoAskIcon: { fontSize: 20 },
  demoAskTitle: { fontSize: 13, fontWeight: '900', color: colors.text },
  demoAskBody: { fontSize: 11, fontWeight: '600', color: colors.muted, lineHeight: 16, marginTop: 1 },
  demoAskArrow: { fontSize: 22, fontWeight: '900', color: colors.primary },
  demoSent: {
    borderRadius: 12,
    backgroundColor: colors.glassLime,
    padding: 12,
  },
  demoSentNote: { fontSize: 12, fontWeight: '700', color: colors.text, lineHeight: 18 },
}));
