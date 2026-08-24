'use client';

/**
 * The admin console's chart set — plain inline SVG, no charting library.
 *
 * Four shapes cover everything the dashboard needs: a time series, stacked
 * daily columns, horizontal category bars, and a status bar. Each renders at
 * real pixel size (the container is measured, rather than a viewBox scaled to
 * fit) so a 12px label is 12px on screen and never grows with the card.
 *
 * The conventions below are deliberate and worth keeping if you add a fifth:
 *
 *  · Marks are thin and the grid is recessive — the data is the only loud thing.
 *  · Bars cap at 24px, round only at the data end, and square at the baseline.
 *  · Touching marks are separated by a 2px gap in the surface colour, never by
 *    a stroke; markers carry a 2px surface ring for the same reason.
 *  · Labels are selective — the last point, the extreme — never one per point.
 *    Everything else lives in the hover tooltip and the table view.
 *  · Two or more series always get a legend; a single series never does, since
 *    the card title already names it.
 *  · Text never wears a series colour; a swatch beside it carries identity.
 *
 * The palette is the validated categorical default (blue → orange), which
 * clears colour-blind separation and 3:1 contrast on white. Velocity's own
 * forest green is UI chrome, not a series colour — it is far too dark to sit
 * beside a second hue on a white card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { colors } from '@/lib/config';

export const SERIES = ['#2a78d6', '#eb6834'] as const;
export const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' } as const;

const INK = colors.text;
const MUTED = colors.muted;
const GRID = '#e9edea';
const AXIS = '#cfd8d2';
const SURFACE = colors.surface;

// ── shared plumbing ─────────────────────────────────────────────────────────

/** Width of the element, in real pixels, kept current as the layout changes. */
function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round an axis maximum up to something a human would have chosen. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

const fmt = (n: number) => n.toLocaleString('en-PK');

/** 12,900 → 12.9K. For axis ticks and tight labels only. */
export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

/** `2026-08-24` → `24 Aug`. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;
}

const tooltipBox: React.CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  background: '#1c1b1b',
  color: '#fff',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
  zIndex: 5,
  boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
};

function Swatch({ color }: { color: string }) {
  return (
    <span
      style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block', flex: 'none' }}
    />
  );
}

// ── the card the charts live in ─────────────────────────────────────────────

export interface SeriesMeta {
  key: string;
  label: string;
  color: string;
}

/**
 * Title, legend, the chart, and a table view behind a toggle. The table is not
 * decoration: it is how the numbers stay available to anyone the colours fail.
 */
export function ChartCard({
  title,
  subtitle,
  series,
  rows,
  children,
  right,
}: {
  title: string;
  subtitle?: string;
  /** Two or more series get a legend. One gets none — the title names it. */
  series?: SeriesMeta[];
  /** Column-per-series table rows, shown when the reader asks for them. */
  rows?: { label: string; values: (string | number)[] }[];
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const legend = series && series.length >= 2 ? series : null;

  return (
    <section
      style={{
        background: SURFACE,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 20,
        minWidth: 0,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{title}</h2>
          {subtitle ? (
            <p style={{ fontSize: 12.5, color: MUTED, margin: '3px 0 0' }}>{subtitle}</p>
          ) : null}
        </div>
        {right}
        {rows?.length ? (
          <button
            onClick={() => setShowTable((v) => !v)}
            style={{
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              borderRadius: 8,
              padding: '4px 9px',
              fontSize: 11.5,
              fontWeight: 700,
              color: MUTED,
              cursor: 'pointer',
            }}
          >
            {showTable ? 'Chart' : 'Table'}
          </button>
        ) : null}
      </header>

      {legend ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
          {legend.map((s) => (
            <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED }}>
              <Swatch color={s.color} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      {showTable && rows?.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>&nbsp;</th>
                {(series ?? []).map((s) => (
                  <th key={s.key} style={{ ...thStyle, textAlign: 'right' }}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={tdStyle}>{r.label}</td>
                  {r.values.map((v, i) => (
                    <td key={i} style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {typeof v === 'number' ? fmt(v) : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  color: MUTED,
  fontWeight: 700,
  borderBottom: `1px solid ${colors.border}`,
  position: 'sticky',
  top: 0,
  background: SURFACE,
};
const tdStyle: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${GRID}` };

// ── time series (line + area, 1–2 series, crosshair) ────────────────────────

export interface TimePoint {
  label: string;
  values: number[];
}

export function TimeSeries({
  points,
  series,
  height = 210,
  valueFormat = fmt,
}: {
  points: TimePoint[];
  series: SeriesMeta[];
  height?: number;
  valueFormat?: (n: number) => string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 12, right: 14, bottom: 24, left: 44 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const max = useMemo(
    () => niceMax(Math.max(1, ...points.flatMap((p) => p.values))),
    [points],
  );

  const x = useCallback(
    (i: number) => (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW),
    [points.length, plotW],
  );
  const y = useCallback((v: number) => plotH - (v / max) * plotH, [plotH, max]);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.left;
    if (points.length < 2) return setHover(px >= 0 && px <= plotW ? 0 : null);
    const i = Math.round((px / plotW) * (points.length - 1));
    setHover(i >= 0 && i < points.length ? i : null);
  };

  const hovered = hover === null ? null : points[hover];

  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(' and ')}>
          <g transform={`translate(${pad.left},${pad.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
                <text
                  x={-8}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill={MUTED}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {compact(t)}
                </text>
              </g>
            ))}

            {series.map((s, si) => {
              const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p.values[si] ?? 0)}`).join('');
              const area = `${line}L${x(points.length - 1)} ${plotH}L${x(0)} ${plotH}Z`;
              return (
                <g key={s.key}>
                  {/* One series gets a wash under it. Two washes overlap into a
                      muddy third colour that belongs to neither series, so past
                      one the lines carry it alone. */}
                  {series.length === 1 ? <path d={area} fill={s.color} opacity={0.1} /> : null}
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}

            {/* Crosshair + the hovered point on every series. */}
            {hover !== null ? (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} stroke={AXIS} strokeWidth={1} />
                {series.map((s, si) => (
                  <circle
                    key={s.key}
                    cx={x(hover)}
                    cy={y(points[hover].values[si] ?? 0)}
                    r={4.5}
                    fill={s.color}
                    stroke={SURFACE}
                    strokeWidth={2}
                  />
                ))}
              </g>
            ) : null}

            {/* One direct label: the last value of the first series. */}
            {points.length > 0 && hover === null ? (
              <text
                x={x(points.length - 1) - 2}
                y={y(points[points.length - 1].values[0] ?? 0) - 10}
                textAnchor="end"
                fontSize={11.5}
                fontWeight={700}
                fill={INK}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {compact(points[points.length - 1].values[0] ?? 0)}
              </text>
            ) : null}

            {points.map((p, i) =>
              i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2) ? (
                <text
                  key={p.label}
                  x={x(i)}
                  y={plotH + 16}
                  textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                  fontSize={11}
                  fill={MUTED}
                >
                  {p.label}
                </text>
              ) : null,
            )}
          </g>
        </svg>
      ) : null}

      {hovered ? (
        <div
          style={{
            ...tooltipBox,
            left: Math.min(Math.max(pad.left + x(hover!) - 60, 0), Math.max(0, width - 150)),
            top: 4,
          }}
        >
          <strong>{hovered.label}</strong>
          {series.map((s, si) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Swatch color={s.color} />
              {s.label}: {valueFormat(hovered.values[si] ?? 0)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── stacked daily columns ───────────────────────────────────────────────────

export function StackedColumns({
  points,
  series,
  height = 210,
  valueFormat = fmt,
}: {
  points: TimePoint[];
  series: SeriesMeta[];
  height?: number;
  valueFormat?: (n: number) => string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 12, right: 14, bottom: 24, left: 48 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const totals = points.map((p) => p.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(1, ...totals));
  const band = points.length ? plotW / points.length : plotW;
  // Cap at 24px, and never let a column fill its band — the leftover is the air
  // that keeps 90 days of them readable.
  const barW = Math.max(2, Math.min(24, band * 0.68));
  /** The 2px surface gap between stacked segments, dropped once it would eat the bar. */
  const stackGap = barW >= 6 ? 2 : 1;
  const y = (v: number) => plotH - (v / max) * plotH;
  const ticks = [0, 0.5, 1].map((f) => f * max);

  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(' and ')}>
          <g transform={`translate(${pad.left},${pad.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
                <text x={-8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {compact(t)}
                </text>
              </g>
            ))}

            {points.map((p, i) => {
              const cx = i * band + band / 2;
              let cursor = 0;
              return (
                <g key={p.label} onMouseEnter={() => setHover(i)}>
                  {/* Full-height hit target: the columns are thin, the hover isn't. */}
                  <rect x={i * band} y={0} width={band} height={plotH} fill="transparent" />
                  {series.map((s, si) => {
                    const v = p.values[si] ?? 0;
                    if (v <= 0) return null;
                    const h = (v / max) * plotH;
                    const yTop = plotH - cursor - h;
                    cursor += h;
                    const isTop = si === series.length - 1 || p.values.slice(si + 1).every((x2) => (x2 ?? 0) <= 0);
                    return (
                      <rect
                        key={s.key}
                        x={cx - barW / 2}
                        y={yTop}
                        width={barW}
                        // 2px of surface separates the segments — a gap, not a stroke.
                        height={Math.max(1, h - (isTop ? 0 : stackGap))}
                        rx={isTop ? Math.min(4, barW / 2) : 0}
                        fill={s.color}
                        opacity={hover === null || hover === i ? 1 : 0.45}
                      />
                    );
                  })}
                </g>
              );
            })}

            {points.map((p, i) =>
              i === 0 || i === points.length - 1 ? (
                <text
                  key={p.label}
                  x={i * band + band / 2}
                  y={plotH + 16}
                  textAnchor={i === 0 ? 'start' : 'end'}
                  fontSize={11}
                  fill={MUTED}
                >
                  {p.label}
                </text>
              ) : null,
            )}
          </g>
        </svg>
      ) : null}

      {hover !== null && points[hover] ? (
        <div
          style={{
            ...tooltipBox,
            left: Math.min(Math.max(pad.left + hover * band - 40, 0), Math.max(0, width - 170)),
            top: 4,
          }}
        >
          <strong>{points[hover].label}</strong>
          {series.map((s, si) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Swatch color={s.color} />
              {s.label}: {valueFormat(points[hover].values[si] ?? 0)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── horizontal category bars (one measure across categories) ────────────────

export function CategoryBars({
  items,
  color = SERIES[0],
  valueFormat = fmt,
  emptyLabel = 'Nothing yet in this period.',
}: {
  items: { label: string; value: number }[];
  color?: string;
  valueFormat?: (n: number) => string;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const anything = items.some((i) => i.value > 0);

  if (!anything) {
    return <p style={{ color: MUTED, fontSize: 13, margin: '18px 0' }}>{emptyLabel}</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '112px 1fr auto', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: MUTED }}>{item.label}</span>
          <div style={{ background: GRID, borderRadius: 4, height: 14, position: 'relative' }}>
            <div
              style={{
                width: `${(item.value / max) * 100}%`,
                height: '100%',
                background: color,
                borderRadius: '0 4px 4px 0',
                minWidth: item.value > 0 ? 3 : 0,
              }}
            />
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' }}>
            {valueFormat(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── status bar (a whole split into named states) ────────────────────────────

/**
 * One bar, one whole, a handful of states. Status colours are reserved and
 * always ship with their label — nothing here is carried by hue alone.
 */
export function StatusSplit({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 16, marginBottom: 12 }}>
        {total === 0 ? (
          <div style={{ flex: 1, background: GRID, borderRadius: 4 }} />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.label}
                title={`${s.label}: ${fmt(s.value)}`}
                style={{ flexGrow: s.value, background: s.color, borderRadius: 4, minWidth: 4 }}
              />
            ))
        )}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <Swatch color={s.color} />
            <span style={{ color: MUTED, flex: 1 }}>{s.label}</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── sparkline (inside a stat tile) ──────────────────────────────────────────

/**
 * The trend line inside a stat tile. Pass `width="100%"` to have it measure its
 * container — the path is still laid out in real pixels, so the stroke never
 * stretches the way a scaled viewBox would.
 */
export function Sparkline({
  values,
  color = SERIES[0],
  width = 96,
  height = 26,
}: {
  values: number[];
  color?: string;
  width?: number | '100%';
  height?: number;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const w = width === '100%' ? measured : width;

  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const yOf = (v: number) => height - (v / max) * (height - 4) - 2;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * step} ${yOf(v)}`).join('');

  return (
    <div ref={ref} style={{ width: width === '100%' ? '100%' : w }}>
      {values.length >= 2 && w > 0 ? (
        <svg width={w} height={height} aria-hidden style={{ display: 'block' }}>
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.5} />
          <circle cx={w - 3} cy={yOf(values[values.length - 1])} r={3} fill={color} stroke={SURFACE} strokeWidth={2} />
        </svg>
      ) : null}
    </div>
  );
}

// ── stat tile ───────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  hint,
  trend,
  trendColor,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: number[];
  trendColor?: string;
}) {
  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 18,
        flex: '1 1 190px',
        minWidth: 180,
      }}
    >
      <div style={{ color: MUTED, fontSize: 12.5, fontWeight: 600 }}>{label}</div>
      {/* The value gets the full width. A sparkline beside it wraps six-figure
          rupee amounts onto two lines, so the trend sits underneath instead. */}
      <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.15, marginTop: 6, whiteSpace: 'nowrap' }}>
        {value}
      </div>
      {hint ? <div style={{ color: MUTED, fontSize: 12, marginTop: 5 }}>{hint}</div> : null}
      {trend?.length ? (
        <div style={{ marginTop: 10 }}>
          <Sparkline values={trend} color={trendColor ?? SERIES[0]} width="100%" />
        </div>
      ) : null}
    </div>
  );
}
