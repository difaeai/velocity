/**
 * Earn with Velocity — the Partner Program UI kit.
 *
 * Charts
 * ------
 * Chart fills do NOT use the brand lime (#ccff00). Lime is a button colour: it
 * carries dark text on a small fill, where its brightness is the point. As a
 * large plotted area on the near-black surface it glares and swamps the axis
 * labels beside it — measurably outside the readable lightness band. So the
 * series palette steps the same hue down to a value that sits in-band on each
 * surface, and lime stays where it belongs: buttons, badges, the level ring.
 *
 * Driver and passenger fleets are the only two series that ever share an axis,
 * and they are colour-separated well beyond the colour-blindness threshold — but
 * they are also always legended and direct-labelled, so identity never rests on
 * colour alone.
 *
 * Each chart plots ONE measure against ONE axis. Earnings and ride counts are
 * different units, so they get separate charts rather than a second y-axis — a
 * dual-axis chart can be made to show any correlation you like by scaling it.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { colors } from '../config';
import { getThemeMode, themed } from '../theme';
import type { PartnerLevel, PartnerRideStatus } from '../api/client';

/** Series colours, per surface. Validated against the chart surface in both modes. */
export function seriesColors(): { driver: string; passenger: string } {
  return getThemeMode() === 'light'
    ? { driver: '#5d7a00', passenger: '#2563eb' }
    : { driver: '#7da500', passenger: '#3b82f6' };
}

export function formatPKR(amount: number): string {
  return `Rs ${Math.round(amount).toLocaleString('en-PK')}`;
}

// ── Level badge ──────────────────────────────────────────────────────────────

const LEVEL_META: Record<PartnerLevel, { label: string; color: string; emoji: string }> = {
  bronze:   { label: 'Bronze',   color: '#cd7f32', emoji: '🥉' },
  silver:   { label: 'Silver',   color: '#9aa5b1', emoji: '🥈' },
  gold:     { label: 'Gold',     color: '#e0b109', emoji: '🥇' },
  platinum: { label: 'Platinum', color: '#7dd3fc', emoji: '💠' },
  diamond:  { label: 'Diamond',  color: '#a78bfa', emoji: '💎' },
};

export function LevelBadge({ level, size = 'md' }: { level: PartnerLevel; size?: 'sm' | 'md' }) {
  const meta = LEVEL_META[level] ?? LEVEL_META.bronze;
  return (
    <View
      style={[
        s.levelBadge,
        { borderColor: meta.color, backgroundColor: `${meta.color}1F` },
        size === 'sm' && { paddingVertical: 3, paddingHorizontal: 8 },
      ]}
    >
      <Text style={[s.levelText, { color: meta.color, fontSize: size === 'sm' ? 11 : 13 }]}>
        {meta.emoji} {meta.label}
      </Text>
    </View>
  );
}

// ── Ride status pill ─────────────────────────────────────────────────────────

/**
 * Status is a reserved palette, and it never rides on colour alone — every pill
 * carries its label, because "the red one" is meaningless to a colour-blind
 * partner arguing about why a ride paid nothing.
 */
const RIDE_STATUS: Record<PartnerRideStatus, { label: string; color: string; dot: string }> = {
  completed: { label: 'Completed', color: '#22c55e', dot: '🟢' },
  cancelled: { label: 'Cancelled', color: '#ef4444', dot: '🔴' },
  scam:      { label: 'Scam ride', color: '#f97316', dot: '🟠' },
  fraud:     { label: 'Fraud',     color: '#6b7280', dot: '⚫' },
};

export function RideStatusPill({ status }: { status: PartnerRideStatus }) {
  const meta = RIDE_STATUS[status] ?? RIDE_STATUS.completed;
  return (
    <View style={[s.statusPill, { backgroundColor: `${meta.color}1F` }]}>
      <Text style={[s.statusText, { color: meta.color }]}>
        {meta.dot} {meta.label}
      </Text>
    </View>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <View style={s.tile}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={[s.tileValue, accent ? { color: accent } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? <Text style={s.tileHint}>{hint}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

// ── Charts ───────────────────────────────────────────────────────────────────

export interface Point {
  date: string;
  value: number;
}

/**
 * Daily earnings — a single series, so no legend: the title names it. The line
 * is thin, the fill is a soft gradient, and only the peak is labelled. A number
 * on every point is noise the eye has to filter before it can see the shape.
 */
export function EarningsChart({ points, height = 160 }: { points: Point[]; height?: number }) {
  const W = 320;
  const H = height;
  const padX = 8;
  const padY = 14;

  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? (W - padX * 2) / (points.length - 1) : 0;
  const y = (v: number) => H - padY - (v / max) * (H - padY * 2);
  const x = (i: number) => padX + i * stepX;

  const stroke = seriesColors().driver;

  if (points.length === 0 || max <= 1) {
    return <EmptyChart height={H} message="No earnings yet — they appear the day your first fleet ride completes." />;
  }

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${line} L ${x(points.length - 1)} ${H - padY} L ${x(0)} ${H - padY} Z`;

  let peakIdx = 0;
  points.forEach((p, i) => {
    if (p.value > (points[peakIdx]?.value ?? 0)) peakIdx = i;
  });
  const peak = points[peakIdx]!;

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="earnFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity="0.28" />
            <Stop offset="1" stopColor={stroke} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {/* Recessive baseline — present enough to anchor the marks, quiet enough
            that it never competes with them. */}
        <Line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke={colors.border} strokeWidth={1} />
        <Path d={area} fill="url(#earnFill)" />
        <Path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={x(peakIdx)} cy={y(peak.value)} r={4} fill={stroke} stroke={colors.background} strokeWidth={2} />
      </Svg>
      <View style={s.chartFooter}>
        <Text style={s.chartMeta}>{points[0]?.date.slice(5)}</Text>
        <Text style={s.chartPeak}>Peak {formatPKR(peak.value)}</Text>
        <Text style={s.chartMeta}>{points[points.length - 1]?.date.slice(5)}</Text>
      </View>
    </View>
  );
}

/**
 * Ride growth — counts, not money, so it is its own chart with its own axis.
 * Bars have 4px rounded tops and a 2px surface gap between them.
 */
export function RideBars({ points, height = 140 }: { points: Point[]; height?: number }) {
  const W = 320;
  const H = height;
  const padY = 12;
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = W / Math.max(1, points.length);
  const barW = Math.max(2, slot - 2); // 2px surface gap

  const fill = seriesColors().driver;

  if (points.length === 0 || max <= 1) {
    return <EmptyChart height={H} message="Ride growth shows up here once your fleet starts driving." />;
  }

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {points.map((p, i) => {
          const h = (p.value / max) * (H - padY * 2);
          return (
            <Rect
              key={p.date}
              x={i * slot + 1}
              y={H - padY - h}
              width={barW}
              height={Math.max(h, p.value > 0 ? 2 : 0)}
              rx={2}
              fill={fill}
              opacity={0.9}
            />
          );
        })}
        <Line x1={0} y1={H - padY} x2={W} y2={H - padY} stroke={colors.border} strokeWidth={1} />
      </Svg>
      <View style={s.chartFooter}>
        <Text style={s.chartMeta}>{points[0]?.date.slice(5)}</Text>
        <Text style={s.chartPeak}>{max} rides / best day</Text>
        <Text style={s.chartMeta}>{points[points.length - 1]?.date.slice(5)}</Text>
      </View>
    </View>
  );
}

/**
 * Driver vs passenger fleet — the one place two series share an axis. Legended
 * AND direct-labelled, so the comparison survives without colour.
 */
export function FleetSplitBar({ driver, passenger }: { driver: number; passenger: number }) {
  const c = seriesColors();
  const total = driver + passenger;

  if (total <= 0) {
    return <Text style={s.emptyText}>No fleet revenue yet.</Text>;
  }

  const driverPct = (driver / total) * 100;

  return (
    <View style={{ gap: 10 }}>
      <View style={s.splitTrack}>
        <View style={{ flex: Math.max(driver, 0.0001), backgroundColor: c.driver }} />
        {/* 2px surface gap keeps the two fills from reading as one blended mass. */}
        {driver > 0 && passenger > 0 ? <View style={{ width: 2, backgroundColor: colors.background }} /> : null}
        <View style={{ flex: Math.max(passenger, 0.0001), backgroundColor: c.passenger }} />
      </View>
      <View style={s.legendRow}>
        <Legend color={c.driver} label="Driver fleet" value={`${formatPKR(driver)} · ${driverPct.toFixed(0)}%`} />
        <Legend color={c.passenger} label="Passenger fleet" value={`${formatPKR(passenger)} · ${(100 - driverPct).toFixed(0)}%`} />
      </View>
    </View>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={s.legendItem}>
      <View style={[s.legendDot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        {/* Text wears text tokens; the dot beside it carries the identity. */}
        <Text style={s.legendLabel}>{label}</Text>
        <Text style={s.legendValue}>{value}</Text>
      </View>
    </View>
  );
}

function EmptyChart({ height, message }: { height: number; message: string }) {
  return (
    <View style={[s.emptyChart, { height }]}>
      <Text style={s.emptyText}>{message}</Text>
    </View>
  );
}

// ── Error state ──────────────────────────────────────────────────────────────

/**
 * What a partner sees when their data will not load.
 *
 * Every Earn screen shows this rather than rendering nothing. A blank screen is
 * indistinguishable from a broken app, and the partner has no way to recover from
 * it — whereas a sentence and a button lets them retry a dropped request, and
 * tells them plainly when the reason is that they are not a partner yet.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={s.errorWrap}>
      <Text style={s.errorText}>{message}</Text>
      <Pressable onPress={onRetry} style={s.retry}>
        <Text style={s.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

// ── Loading skeletons ────────────────────────────────────────────────────────

export function Skeleton({
  height = 16,
  width = '100%',
  radius = 8,
}: {
  height?: number;
  width?: DimensionValue;
  radius?: number;
}) {
  return <View style={[s.skeleton, { height, width, borderRadius: radius }]} />;
}

export function DashboardSkeleton() {
  return (
    <View style={{ gap: 14 }}>
      <Skeleton height={92} radius={20} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Skeleton height={78} radius={16} width="48%" />
        <Skeleton height={78} radius={16} width="48%" />
      </View>
      <Skeleton height={170} radius={20} />
      <Skeleton height={140} radius={20} />
    </View>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={s.segmented}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[s.segment, active && s.segmentActive]}
          >
            <Text style={[s.segmentText, active && s.segmentTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  levelBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  levelText: { fontWeight: '800', letterSpacing: 0.3 },

  statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '800' },

  tile: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  tileLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  tileValue: { color: colors.text, fontSize: 20, fontWeight: '900' },
  tileHint: { color: colors.muted, fontSize: 11 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },

  chartFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  chartMeta: { color: colors.muted, fontSize: 11 },
  chartPeak: { color: colors.text, fontSize: 11, fontWeight: '800' },

  emptyChart: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  splitTrack: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: colors.glassChip,
  },
  legendRow: { flexDirection: 'row', gap: 14 },
  legendItem: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  legendDot: { width: 10, height: 10, borderRadius: 3, marginTop: 3 },
  legendLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  legendValue: { color: colors.text, fontSize: 13, fontWeight: '800' },

  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 },
  errorText: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  retryText: { color: colors.btnText, fontWeight: '800' },

  skeleton: { backgroundColor: colors.glassChip },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.glassChip,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  segmentTextActive: { color: colors.btnText },
}));
