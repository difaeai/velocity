'use client';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  collection,
  orderBy,
  query,
  Timestamp,
  where,
  getDocs,
} from 'firebase/firestore';

import { useAuth } from '../../src/auth/AuthContext';
import { db } from '../../src/firebase';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { DriverTabBar, DRIVER_TAB_BAR_HEIGHT } from '../../src/ui/DriverTabBar';
import { DailyTargetCard } from '../../src/ui/DailyTargetCard';
import {
  useCommissionCredits,
  useCommissionStatus,
  useDailyTarget,
  useDriverProfile,
  type CreditRow,
} from '../../src/hooks/driver';

type Period = 'today' | 'week' | 'month' | 'all';

interface TxRow {
  id: string;
  type: string;
  amount: number;
  grossFare?: number;
  paymentMethod?: string;
  createdAt: Timestamp;
}

interface Summary {
  trips: number;
  cashTrips: number;
  walletTrips: number;
  grossFare: number;
  walletEarned: number;
}

function startOf(period: Period): Date {
  const now = new Date();
  if (period === 'today') {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === 'month') {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d;
  }
  return new Date(0); // all time
}

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week:  'Last 7 days',
  month: 'Last 30 days',
  all:   'All time',
};

export default function DriverEarnings() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid;

  const profile = useDriverProfile(uid);
  const commission = useCommissionStatus(profile);
  const dailyTarget = useDailyTarget(uid);
  const credits = useCommissionCredits(uid);

  const [period, setPeriod]       = useState<Period>('week');
  const [rows, setRows]           = useState<TxRow[]>([]);
  const [summary, setSummary]     = useState<Summary>({ trips: 0, cashTrips: 0, walletTrips: 0, grossFare: 0, walletEarned: 0 });
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const since = startOf(period);
    const txRef = collection(db, 'wallets', uid, 'transactions');
    const q = query(
      txRef,
      where('createdAt', '>=', Timestamp.fromDate(since)),
      orderBy('createdAt', 'desc'),
    );
    getDocs(q).then((snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }) as TxRow);
      setRows(data);

      const tripTxs = data.filter(r => r.type === 'trip_payout' || r.type === 'trip_cash');
      setSummary({
        trips:        tripTxs.length,
        cashTrips:    tripTxs.filter(r => r.paymentMethod === 'cash' || r.type === 'trip_cash').length,
        walletTrips:  tripTxs.filter(r => r.paymentMethod === 'wallet' || r.type === 'trip_payout').length,
        grossFare:    tripTxs.reduce((s, r) => s + (r.grossFare ?? 0), 0),
        walletEarned: tripTxs.filter(r => r.type === 'trip_payout').reduce((s, r) => s + r.amount, 0),
      });
    }).finally(() => setLoading(false));
  }, [uid, period]);

  const avgPerTrip = summary.trips > 0 ? Math.round(summary.grossFare / summary.trips) : 0;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Earnings</Text>
        <View style={{ width: 48 }} />
      </View>

      {/* Period selector */}
      <View style={styles.periodRow}>
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
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

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Today's target ── The driver's reason to take one more ride, at the
            top of the screen they open to ask "how am I doing". */}
        <DailyTargetCard
          progress={dailyTarget.progress}
          bonusBalance={commission.bonus}
          todayCashFare={commission.todayCashFare}
          rate={commission.rate}
        />

        {/* ── Commission ── Charged by the day. Today's fares are shown apart
            from what has actually become due, because the difference between
            them is the whole rule: today is not payable yet, and it is free
            altogether if the target lands. */}
        <View style={styles.commissionCard}>
          <Text style={styles.commissionTitle}>Commission</Text>
          <Row
            label="Fares you took today"
            value={`${commission.todayGrossFare.toLocaleString()} PKR`}
          />
          {commission.settleableGrossFare > 0 ? (
            <Row
              label="Unpaid from earlier days"
              value={`${commission.settleableGrossFare.toLocaleString()} PKR`}
            />
          ) : null}
          <Row
            label={`Commission due at ${Math.round(commission.rate * 100)}%`}
            value={`${commission.grossDue.toLocaleString()} PKR`}
          />
          {commission.bonusApplied > 0 ? (
            <Row
              label="Paid by your bonus"
              value={`− ${commission.bonusApplied.toLocaleString()} PKR`}
              accent
            />
          ) : null}
          <View style={styles.commissionDivider} />
          <Row
            label={commission.bonusApplied > 0 ? 'Still to pay' : 'You owe'}
            value={`${commission.due.toLocaleString()} PKR`}
            bold
          />
          <Text style={styles.commissionNote}>
            {commission.due > 0
              ? 'Clear this to start taking rides again.'
              : dailyTarget.progress.commissionWaived
                ? "Today's rides are commission-free — you hit the target."
                : commission.dailyTargetEnabled
                  ? `Nothing to pay right now. Finish ${commission.dailyTargetRides} ${commission.dailyTargetPoolOnly ? 'pool rides' : 'rides'} today and the day stays free; otherwise ${Math.round(commission.rate * 100)}% of today's cash is due at midnight.`
                  : `Today's commission becomes due at midnight.`}
          </Text>
        </View>

        {/* ── Credit statement ── */}
        {credits.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Bonus history</Text>
            {credits.map((c) => (
              <CreditRowView key={c.id} row={c} />
            ))}
          </>
        ) : null}

        {/* Summary cards */}
        <View style={styles.statsGrid}>
          <StatCard label="Total trips"     value={String(summary.trips)} />
          <StatCard label="Gross fare"      value={`${summary.grossFare.toLocaleString()} PKR`} accent />
          <StatCard label="Wallet earned"   value={`${summary.walletEarned.toLocaleString()} PKR`} />
          <StatCard label="Avg per trip"    value={`${avgPerTrip} PKR`} />
          <StatCard label="Cash trips"      value={String(summary.cashTrips)} />
          <StatCard label="Wallet trips"    value={String(summary.walletTrips)} />
        </View>

        {/* Simple bar chart — daily totals for the week */}
        {period === 'week' && <WeekChart rows={rows} />}

        {/* Transaction list */}
        <Text style={styles.sectionTitle}>Transaction history</Text>
        {loading && <Text style={styles.muted}>Loading…</Text>}
        {!loading && rows.length === 0 && (
          <Text style={styles.muted}>No transactions in this period.</Text>
        )}
        {rows.map((r) => (
          <View key={r.id} style={styles.txRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.txType}>{txLabel(r.type)}</Text>
              <Text style={styles.txDate}>{formatDate(r.createdAt)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.txAmount, r.amount < 0 && styles.txNeg]}>
                {r.amount >= 0 ? '+' : ''}{r.amount} PKR
              </Text>
              {r.paymentMethod === 'cash' || r.type === 'trip_cash' ? (
                <Text style={styles.cashTag}>💵 cash</Text>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      <DriverTabBar active="performance" />
    </SafeAreaView>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** One label/value line inside the commission card. */
function Row({
  label,
  value,
  bold,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          bold && styles.rowBold,
          accent && { color: colors.primary },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const CREDIT_LABELS: Record<CreditRow['type'], string> = {
  daily_target: '🎯 Daily target bonus',
  spent: 'Bonus used against commission',
  admin_grant: 'Bonus added by Velocity Rides',
  admin_clawback: 'Bonus removed by Velocity Rides',
};

function CreditRowView({ row }: { row: CreditRow }) {
  return (
    <View style={styles.txRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.txType}>{CREDIT_LABELS[row.type]}</Text>
        <Text style={styles.txDate}>
          {row.day ?? (row.createdAt ? formatDate(Timestamp.fromMillis(row.createdAt.seconds * 1000)) : '')}
          {row.reason ? ` · ${row.reason}` : ''}
        </Text>
      </View>
      <Text style={[styles.txAmount, row.amount < 0 && styles.txNeg]}>
        {row.amount >= 0 ? '+' : ''}{row.amount.toLocaleString()} PKR
      </Text>
    </View>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, accent && { color: colors.primary }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function WeekChart({ rows }: { rows: TxRow[] }) {
  // Build daily gross fare for last 7 days
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const dayTotals = days.map(day => {
    const next = new Date(day); next.setDate(next.getDate() + 1);
    const total = rows
      .filter(r => {
        const ts = r.createdAt?.toDate?.();
        return ts && ts >= day && ts < next && (r.type === 'trip_payout' || r.type === 'trip_cash');
      })
      .reduce((s, r) => s + (r.grossFare ?? 0), 0);
    return { day, total };
  });

  const max = Math.max(...dayTotals.map(d => d.total), 1);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionTitle}>Daily earnings (PKR)</Text>
      <View style={styles.chartBars}>
        {dayTotals.map(({ day, total }) => (
          <View key={day.toISOString()} style={styles.chartBarCol}>
            <Text style={styles.chartBarValue}>{total > 0 ? total : ''}</Text>
            <View style={styles.chartBarTrack}>
              <View style={[styles.chartBarFill, { height: `${(total / max) * 100}%` }]} />
            </View>
            <Text style={styles.chartBarLabel}>{dayNames[day.getDay()]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function txLabel(type: string) {
  const map: Record<string, string> = {
    trip_payout:   '🚗 Trip payout',
    trip_cash:     '💵 Cash trip',
    topup:         '💳 Wallet top-up',
    payout:        '🏦 Bank payout',
    commission:    '📋 Commission paid',
  };
  return map[type] ?? type;
}

function formatDate(ts: Timestamp | undefined) {
  if (!ts?.toDate) return '';
  return ts.toDate().toLocaleDateString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = themed(() => StyleSheet.create({
  safe:     { flex: 1, backgroundColor: colors.background },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  back:     { fontSize: 16, fontWeight: '600', color: colors.muted },
  title:    { fontSize: 20, fontWeight: '900', color: colors.text },

  periodRow: { flexDirection: 'row', padding: 14, gap: 8, flexWrap: 'wrap' },
  periodBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  periodBtnActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  periodBtnText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  periodBtnTextActive: { color: colors.primary },

  content:   { padding: 16, gap: 16, paddingBottom: DRIVER_TAB_BAR_HEIGHT + 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:  { width: '47%', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4 },
  statValue: { fontSize: 20, fontWeight: '900', color: colors.text },
  statLabel: { fontSize: 12, color: colors.muted },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 4, marginTop: 8 },
  muted:         { fontSize: 13, color: colors.muted },

  commissionCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 14,
  },
  commissionTitle: { fontSize: 14, fontWeight: '900', color: colors.text, marginBottom: 10 },
  commissionDivider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  commissionNote: { fontSize: 11.5, color: colors.muted, lineHeight: 17, marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3, gap: 10 },
  rowLabel: { fontSize: 13, color: colors.muted, flex: 1 },
  rowValue: { fontSize: 13, fontWeight: '700', color: colors.text },
  rowBold: { fontWeight: '900', color: colors.text, fontSize: 14 },

  txRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  txType:   { fontSize: 14, fontWeight: '700', color: colors.text },
  txDate:   { fontSize: 11, color: colors.muted, marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '900', color: colors.primary },
  txNeg:    { color: colors.danger },
  cashTag:  { fontSize: 10, color: colors.muted, marginTop: 2 },

  chartCard:  { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  chartBars:  { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 6 },
  chartBarCol:{ flex: 1, alignItems: 'center', gap: 4 },
  chartBarValue: { fontSize: 9, color: colors.muted, fontWeight: '700' },
  chartBarTrack: { flex: 1, width: '100%', backgroundColor: colors.border, borderRadius: 4, justifyContent: 'flex-end' },
  chartBarFill:  { backgroundColor: colors.primary, borderRadius: 4 },
  chartBarLabel: { fontSize: 10, color: colors.muted, fontWeight: '700' },
}));
