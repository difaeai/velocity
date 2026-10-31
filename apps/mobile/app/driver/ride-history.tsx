'use client';
/**
 * Your rides — the driver's own record of every trip they have driven.
 *
 * Earnings answers "how much did I make"; this answers "what did I drive". A
 * driver needed the second question answered far more often than the app let
 * them ask it: which ride was the one that ended in Bahria Town, how many did I
 * do on Friday, who was in the car when the bag was left behind. The wallet
 * ledger cannot answer any of those — it has an amount and a date and no idea
 * where anyone went, and a cancelled ride never reaches it at all.
 *
 * Grouped by day because that is the unit a driver thinks in. Commission is
 * charged by the day, the daily target resets at midnight, and "how did
 * Tuesday go" is the question behind almost every look at this screen.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { useDriverTrips, useRideHistoryDays, type RideHistoryDay } from '../../src/hooks/driverHistory';
import { RIDE_TYPE_LABELS, type Trip, type TripStatus } from '../../src/domain/types';
import { dashcamWatchable } from '../../src/domain/dashcam';
import { SkeletonRows } from '../../src/ui/states';

type Period = 'today' | 'week' | 'month' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: '7 days',
  month: '30 days',
  all: 'All time',
};

const STATUS_META: Record<TripStatus, { label: string; color: string }> = {
  requested: { label: 'Not taken', color: colors.muted },
  matched: { label: 'Assigned', color: '#ccff00' },
  arriving: { label: 'On the way', color: '#ccff00' },
  arrived: { label: 'At pickup', color: '#ccff00' },
  in_progress: { label: 'In progress', color: '#ccff00' },
  completed: { label: 'Completed', color: '#10b981' },
  cancelled: { label: 'Cancelled', color: '#ef4444' },
  merged: { label: 'Merged', color: colors.muted },
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Midnight, this many days back, in the driver's own time zone. */
function startOf(period: Period): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === 'today') return d.getTime();
  if (period === 'week') return d.getTime() - 6 * 86_400_000;
  if (period === 'month') return d.getTime() - 29 * 86_400_000;
  return 0;
}

/** "Today" / "Yesterday" / "Tuesday, 14 Oct" — whichever a driver would say. */
function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const label = `${DAY_NAMES[date.getDay()]}, ${d} ${MONTHS[m - 1]}`;
  return date.getFullYear() === today.getFullYear() ? label : `${label} ${y}`;
}

function timeOf(trip: Trip): string {
  const seconds = trip.createdAt?.seconds;
  if (!seconds) return '';
  const d = new Date(seconds * 1000);
  const h = d.getHours();
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`;
}

export default function DriverRideHistory() {
  const router = useRouter();
  const { user } = useAuth();
  const { trips, loading } = useDriverTrips(user?.uid);

  const [period, setPeriod] = useState<Period>('week');
  const [openId, setOpenId] = useState<string | null>(null);

  const since = useMemo(() => startOf(period), [period]);
  const inPeriod = useMemo(
    () => trips.filter((t) => (t.createdAt?.seconds ?? 0) * 1000 >= since),
    [trips, since],
  );
  const days = useRideHistoryDays(inPeriod);

  const totals = useMemo(
    () =>
      days.reduce(
        (acc, d) => ({
          rides: acc.rides + d.trips.length,
          completed: acc.completed + d.completed,
          cancelled: acc.cancelled + d.cancelled,
          earned: acc.earned + d.earned,
        }),
        { rides: 0, completed: 0, cancelled: 0, earned: 0 },
      ),
    [days],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/driver/home'))}
          hitSlop={12}
        >
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Your rides</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={styles.periodRow}>
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <Pressable
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodBtnText, period === p && styles.periodBtnTextActive]}>
              {PERIOD_LABELS[p]}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <SkeletonRows />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statRow}>
            <Stat label="Rides" value={String(totals.rides)} />
            <Stat label="Completed" value={String(totals.completed)} accent />
            <Stat label="Cancelled" value={String(totals.cancelled)} />
            <Stat label="You earned" value={`${totals.earned.toLocaleString()}`} accent />
          </View>

          {days.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No rides in this period</Text>
              <Text style={styles.emptySub}>
                {period === 'all'
                  ? 'Rides you drive will be listed here, day by day.'
                  : 'Try a longer period, or go online to start taking rides.'}
              </Text>
            </View>
          ) : (
            days.map((day) => (
              <DaySection
                key={day.date}
                day={day}
                openId={openId}
                onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
              />
            ))
          )}

          {/* The record is the driver's own. Anything beyond it — a dispute, a
              lost bag, a police request — goes through Velocity Rides, which is
              the only party that can see the other side of the ride. */}
          <Text style={styles.footNote}>
            Need details Velocity Rides holds — a receipt, a dispute, something left in your car?
            Open Help &amp; complaints and quote the ride&apos;s date and time.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function DaySection({
  day,
  openId,
  onToggle,
}: {
  day: RideHistoryDay;
  openId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <View style={styles.daySection}>
      <View style={styles.dayHeader}>
        <Text style={styles.dayLabel}>{dayLabel(day.date)}</Text>
        <Text style={styles.daySummary}>
          {day.trips.length} {day.trips.length === 1 ? 'ride' : 'rides'}
          {day.earned > 0 ? ` · ${day.earned.toLocaleString()} PKR` : ''}
        </Text>
      </View>

      {day.trips.map((t) => (
        <RideRow key={t.id} trip={t} open={openId === t.id} onToggle={() => onToggle(t.id)} />
      ))}
    </View>
  );
}

function RideRow({ trip, open, onToggle }: { trip: Trip; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  // Read once: the clock is not something a render may call.
  const [now] = useState(Date.now);
  const meta = STATUS_META[trip.status] ?? { label: trip.status, color: colors.muted };
  const roster = trip.poolRoster ?? [];
  const shared = trip.pool === true;
  const fare = trip.settlement?.driverPayout ?? trip.fare ?? trip.offeredFare;

  return (
    <Pressable style={styles.card} onPress={onToggle}>
      <View style={styles.cardTop}>
        <Text style={styles.time}>{timeOf(trip)}</Text>
        <Text style={styles.rideType}>
          {RIDE_TYPE_LABELS[trip.rideType] ?? trip.rideType}
          {shared ? ' · Ride sharing' : ''}
        </Text>
        <View style={[styles.statusPill, { borderColor: meta.color }]}>
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.routeRow}>
        <Text style={styles.routeDot}>●</Text>
        <Text style={styles.routeText} numberOfLines={1}>
          {trip.pickup?.address ?? 'Pickup'}
        </Text>
      </View>
      <View style={styles.routeRow}>
        <Text style={[styles.routeDot, { color: colors.primary }]}>◆</Text>
        <Text style={styles.routeText} numberOfLines={1}>
          {trip.dropoff?.address ?? 'Drop-off'}
        </Text>
      </View>

      <View style={styles.cardBottom}>
        <Text style={styles.fare}>
          {typeof fare === 'number' ? `${fare.toLocaleString()} PKR` : '—'}
          {trip.paymentMethod ? ` · ${trip.paymentMethod === 'cash' ? 'Cash' : 'Wallet'}` : ''}
        </Text>
        <Text style={styles.expand}>{open ? 'Hide details' : 'Details'}</Text>
      </View>

      {open ? (
        <View style={styles.details}>
          {shared && roster.length > 0 ? (
            <>
              <Text style={styles.detailsHeading}>Who was in the car</Text>
              {roster.map((r) => (
                <View key={r.uid} style={styles.riderRow}>
                  <Text style={styles.riderName}>{r.firstName}</Text>
                  <Text style={styles.riderMeta}>
                    {r.dropoffAddress ?? trip.dropoff?.address ?? '—'}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          <DetailLine label="Ride ID" value={trip.id} />
          {trip.settlement ? (
            <>
              <DetailLine
                label="Fare collected"
                value={`${trip.settlement.grossFare.toLocaleString()} PKR`}
              />
              <DetailLine
                label="Velocity Rides commission"
                value={`${trip.settlement.commission.toLocaleString()} PKR`}
              />
              <DetailLine
                label="Your share"
                value={`${trip.settlement.driverPayout.toLocaleString()} PKR`}
              />
            </>
          ) : null}
          {trip.status === 'cancelled' ? (
            <DetailLine
              label="Cancelled by"
              value={trip.cancelledByRole === 'driver' ? 'You' : 'The passenger'}
            />
          ) : null}
          {/* The driver's proof of the ride, for the day it exists. */}
          {dashcamWatchable(trip, now) ? (
            <Pressable style={styles.dashcamBtn} onPress={() => router.push(`/dashcam/${trip.id}`)}>
              <Text style={styles.dashcamBtnText}>🎥 Watch the dash cam video — kept for 24 hours</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, accent && { color: colors.primary }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  title: { color: colors.text, fontSize: 18, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  periodRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  // Matched to the Earnings screen's chips deliberately — the two screens sit
  // next to each other in the drawer and read as one pair.
  periodBtnActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  periodBtnText: { color: colors.muted, fontSize: 12.5, fontWeight: '800' },
  periodBtnTextActive: { color: colors.primary },

  content: { padding: 16, paddingTop: 4, gap: 18, paddingBottom: 40 },

  statRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { color: colors.text, fontSize: 17, fontWeight: '900' },
  statLabel: { color: colors.muted, fontSize: 10.5, fontWeight: '700', textAlign: 'center' },

  empty: { alignItems: 'center', gap: 6, paddingVertical: 48 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  emptySub: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },

  daySection: { gap: 8 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  dayLabel: { color: colors.text, fontSize: 15, fontWeight: '900' },
  daySummary: { color: colors.muted, fontSize: 12, fontWeight: '700' },

  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 13,
    gap: 5,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { color: colors.text, fontSize: 13, fontWeight: '900' },
  rideType: { color: colors.muted, fontSize: 12, fontWeight: '700', flex: 1 },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 10.5, fontWeight: '800' },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeDot: { color: colors.muted, fontSize: 10 },
  routeText: { color: colors.text, fontSize: 13, flex: 1 },

  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  fare: { color: colors.text, fontSize: 14, fontWeight: '900' },
  expand: { color: colors.primary, fontSize: 12, fontWeight: '800' },

  details: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 6,
  },
  detailsHeading: {
    color: colors.muted,
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  riderRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  riderName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  riderMeta: { color: colors.muted, fontSize: 12, flex: 1, textAlign: 'right' },

  detailLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  detailLabel: { color: colors.muted, fontSize: 12 },
  detailValue: { color: colors.text, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  dashcamBtn: {
    marginTop: 4,
    backgroundColor: `${colors.primary}18`,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  dashcamBtnText: { color: colors.primary, fontSize: 12.5, fontWeight: '800' },

  footNote: {
    color: colors.muted,
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
}));
