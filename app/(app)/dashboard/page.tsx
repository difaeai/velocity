'use client';

/**
 * Manage app → Overview.
 *
 * This used to be four running totals out of `system/counters`, which answered
 * "how much money has Velocity ever made" and nothing else. Every number here
 * now has a shape over time, because the useful questions are directional: are
 * rides growing, is the cancel rate creeping up, is supply keeping pace with
 * demand, which services are actually being used.
 *
 * One call fetches the lot (adminGetAnalytics) — finished days come from a
 * per-day cache on the backend, so widening the range is cheap.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { analyticsApi, type AnalyticsPayload } from '@/lib/api';
import { colors } from '@/lib/config';
import {
  CategoryBars,
  ChartCard,
  SERIES,
  STATUS,
  Stat,
  StackedColumns,
  StatusSplit,
  TimeSeries,
  compact,
  shortDate,
} from '@/components/charts';
import { CostOfVelocityTile } from '@/components/CostOfVelocity';

const RANGES = [7, 30, 90] as const;

const RIDE_TYPE_LABELS: Record<string, string> = {
  bike: 'Bike',
  auto: 'Auto rickshaw',
  mini: 'Mini',
  ac: 'AC',
  comfort: 'Comfort',
  xl: 'XL',
};

const pkr = (n: number) => `${n.toLocaleString('en-PK')} PKR`;

export default function Overview() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Nothing is set synchronously here: `loading` is derived from whether the
  // data on hand matches the range being asked for, so switching 30d → 90d
  // shows the spinner without a second render pass to turn a flag on.
  useEffect(() => {
    let cancelled = false;
    analyticsApi
      .get({ days })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load analytics.');
      });
    return () => {
      cancelled = true;
    };
  }, [days, attempt]);

  const loading = !error && (!data || data.days !== days);

  const series = data?.series ?? [];
  const totals = data?.totals;
  const snap = data?.snapshot;

  const tripPoints = series.map((d) => ({
    label: shortDate(d.date),
    values: [d.tripsRequested, d.tripsCompleted],
  }));
  const moneyPoints = series.map((d) => ({
    label: shortDate(d.date),
    values: [d.driverPayout, d.commission],
  }));
  const signupPoints = series.map((d) => ({
    label: shortDate(d.date),
    values: [d.newPassengers, d.newDrivers],
  }));

  const rideTypeTotals = Object.entries(
    series.reduce<Record<string, number>>((acc, d) => {
      for (const [k, v] of Object.entries(d.byRideType ?? {})) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {}),
  )
    .map(([key, value]) => ({ label: RIDE_TYPE_LABELS[key] ?? key, value }))
    .sort((a, b) => b.value - a.value);

  const serviceTotals = [
    { label: 'City rides', value: series.reduce((n, d) => n + d.tripsRequested, 0) },
    { label: 'Pooled', value: series.reduce((n, d) => n + d.tripsPooled, 0) },
    { label: 'Intercity', value: series.reduce((n, d) => n + d.intercity, 0) },
    { label: 'Couriers', value: series.reduce((n, d) => n + d.couriers, 0) },
    { label: 'Freight', value: series.reduce((n, d) => n + d.freight, 0) },
    { label: 'Special Rides', value: series.reduce((n, d) => n + d.specialRides, 0) },
    { label: 'Scheduled', value: series.reduce((n, d) => n + d.scheduled, 0) },
  ];

  const cashVsWallet = [
    { label: 'Cash', value: series.reduce((n, d) => n + d.cashTrips, 0) },
    { label: 'Wallet', value: series.reduce((n, d) => n + d.walletTrips, 0) },
  ];

  const completionRate =
    totals && totals.tripsRequested > 0
      ? Math.round((totals.tripsCompleted / totals.tripsRequested) * 100)
      : null;

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Overview</h1>
          <p style={{ color: colors.muted, margin: 0 }}>
            The last {days} days across every Velocity service.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 3 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              style={{
                border: 'none',
                background: r === days ? `${colors.primary}14` : 'transparent',
                color: r === days ? colors.primary : colors.muted,
                fontWeight: 800,
                fontSize: 12.5,
                padding: '6px 12px',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              {r}d
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <p style={{ color: colors.danger, marginBottom: 16 }}>
          {error}{' '}
          <button onClick={() => setAttempt((n) => n + 1)} style={linkButton}>
            Try again
          </button>
        </p>
      ) : null}

      {loading && !data ? <p style={{ color: colors.muted }}>Loading…</p> : null}

      {data ? (
        <>
          {/* Things that need a person today, before any trend. */}
          <ActionRow snapshot={snap!} />

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '18px 0' }}>
            <Stat
              label="Gross fares"
              value={pkr(totals!.revenue)}
              hint={`${compact(totals!.tripsCompleted)} completed rides`}
              trend={series.map((d) => d.revenue)}
            />
            <Stat
              label="Platform commission"
              value={pkr(totals!.commission)}
              hint={
                totals!.revenue > 0
                  ? `${Math.round((totals!.commission / totals!.revenue) * 100)}% of gross`
                  : 'No completed rides yet'
              }
              trend={series.map((d) => d.commission)}
              trendColor={SERIES[1]}
            />
            <Stat
              label="Paid to drivers"
              value={pkr(totals!.driverPayout)}
              hint="Kept by drivers, mostly in cash"
              trend={series.map((d) => d.driverPayout)}
            />
            <Stat
              label="Completion rate"
              value={completionRate === null ? '—' : `${completionRate}%`}
              hint={`${compact(totals!.tripsCancelled)} cancelled of ${compact(totals!.tripsRequested)} requested`}
            />
          </div>

          {/* The other side of the ledger: what the platform costs to run. */}
          <div style={{ marginBottom: 18 }}>
            <CostOfVelocityTile />
          </div>

          <div style={grid2}>
            <ChartCard
              title="Rides per day"
              subtitle="Requested against completed — the gap is cancellations and rides still open."
              series={[
                { key: 'req', label: 'Requested', color: SERIES[0] },
                { key: 'done', label: 'Completed', color: SERIES[1] },
              ]}
              rows={series.map((d) => ({ label: shortDate(d.date), values: [d.tripsRequested, d.tripsCompleted] }))}
            >
              <TimeSeries
                points={tripPoints}
                series={[
                  { key: 'req', label: 'Requested', color: SERIES[0] },
                  { key: 'done', label: 'Completed', color: SERIES[1] },
                ]}
              />
            </ChartCard>

            <ChartCard
              title="Where the fare goes"
              subtitle="Each column is one day's gross fares, split between the driver and Velocity."
              series={[
                { key: 'driver', label: 'Driver payout', color: SERIES[0] },
                { key: 'commission', label: 'Commission', color: SERIES[1] },
              ]}
              rows={series.map((d) => ({ label: shortDate(d.date), values: [d.driverPayout, d.commission] }))}
            >
              <StackedColumns
                points={moneyPoints}
                series={[
                  { key: 'driver', label: 'Driver payout', color: SERIES[0] },
                  { key: 'commission', label: 'Commission', color: SERIES[1] },
                ]}
                valueFormat={pkr}
              />
            </ChartCard>

            <ChartCard
              title="Sign-ups"
              subtitle="New accounts against drivers entering onboarding — supply has to keep up with demand."
              series={[
                { key: 'p', label: 'New accounts', color: SERIES[0] },
                { key: 'd', label: 'Drivers onboarding', color: SERIES[1] },
              ]}
              rows={series.map((d) => ({ label: shortDate(d.date), values: [d.newPassengers, d.newDrivers] }))}
            >
              <StackedColumns
                points={signupPoints}
                series={[
                  { key: 'p', label: 'New accounts', color: SERIES[0] },
                  { key: 'd', label: 'Drivers onboarding', color: SERIES[1] },
                ]}
              />
            </ChartCard>

            <ChartCard title="Driver roster" subtitle="Every driver account, by verification state.">
              <StatusSplit
                segments={[
                  { label: 'Approved and driving', value: snap!.driversApproved, color: STATUS.good },
                  { label: 'Waiting for approval', value: snap!.driversPending, color: STATUS.warning },
                  { label: 'Suspended', value: snap!.driversSuspended, color: STATUS.critical },
                ]}
              />
            </ChartCard>

            <ChartCard title="Service mix" subtitle={`Orders and bookings started in the last ${days} days.`}>
              <CategoryBars items={serviceTotals} emptyLabel="No bookings in this period yet." />
            </ChartCard>

            <ChartCard title="Vehicle classes" subtitle="Which ride type riders actually ask for.">
              <CategoryBars
                items={rideTypeTotals.length ? rideTypeTotals : [{ label: 'No rides yet', value: 0 }]}
                emptyLabel="No rides requested in this period yet."
              />
            </ChartCard>

            <ChartCard title="How riders pay" subtitle="Completed rides, by payment method.">
              <CategoryBars items={cashVsWallet} emptyLabel="No completed rides in this period yet." />
            </ChartCard>
          </div>

          <p style={{ color: colors.muted, fontSize: 12, marginTop: 18 }}>
            Updated {new Date(data.generatedAt).toLocaleString('en-PK')}. Finished days are cached, so
            widening the range costs almost nothing.
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Queues with people waiting in them. Each one is a link to the desk that clears it. */
function ActionRow({ snapshot }: { snapshot: AnalyticsPayload['snapshot'] }) {
  const items = [
    { label: 'Drivers awaiting approval', value: snapshot.driversPending, href: '/dashboard/drivers' },
    { label: 'CNICs to verify', value: snapshot.cnicPending, href: '/dashboard/cnic' },
    { label: 'Open disputes', value: snapshot.openDisputes, href: '/dashboard/disputes' },
    { label: 'Payouts to pay', value: snapshot.payoutsPending, href: '/dashboard/payouts' },
    { label: 'Rides in progress', value: snapshot.activeTrips, href: '/dashboard/live-ops' },
  ];

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: i.value > 0 ? `${colors.primary}0F` : colors.surface,
            border: `1px solid ${i.value > 0 ? `${colors.primary}33` : colors.border}`,
            borderRadius: 999,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 600,
            color: colors.text,
          }}
        >
          <strong style={{ fontVariantNumeric: 'tabular-nums', color: i.value > 0 ? colors.primary : colors.muted }}>
            {i.value}
          </strong>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

const grid2: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
  gap: 16,
};

const linkButton: React.CSSProperties = {
  border: 'none',
  background: 'none',
  color: colors.secondary,
  fontWeight: 700,
  cursor: 'pointer',
  textDecoration: 'underline',
};
