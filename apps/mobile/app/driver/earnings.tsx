'use client';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
    </SafeAreaView>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: colors.background },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  back:     { fontSize: 16, fontWeight: '600', color: colors.muted },
  title:    { fontSize: 20, fontWeight: '900', color: colors.text },

  periodRow: { flexDirection: 'row', padding: 14, gap: 8, flexWrap: 'wrap' },
  periodBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  periodBtnActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  periodBtnText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  periodBtnTextActive: { color: colors.primary },

  content:   { padding: 16, gap: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:  { width: '47%', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4 },
  statValue: { fontSize: 20, fontWeight: '900', color: colors.text },
  statLabel: { fontSize: 12, color: colors.muted },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 4 },
  muted:         { fontSize: 13, color: colors.muted },

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
});
