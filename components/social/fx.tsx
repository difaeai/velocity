'use client';

/**
 * The desk's look: cards that rise in, numbers that count up, charts that draw
 * themselves, and a dark-green hero in Velocity's own colours (forest + lime).
 *
 * All CSS and inline SVG — no animation or chart library — and every motion
 * stops under `prefers-reduced-motion`, leaving the finished state.
 */

import { useEffect, useId, useRef, useState } from 'react';

export const FX_CSS = `
.fx { --forest:#004c31; --deep:#03291b; --ink:#0b1f17; --lime:#ccff00; --mint:#19c37d; --line:#e2e8e4; --muted:#6f7a72; }

.fx-rise { opacity: 0; transform: translateY(14px) scale(.985); animation: fx-rise .6s cubic-bezier(.2,.7,.2,1) forwards;
  animation-delay: calc(var(--i, 0) * 70ms); }
@keyframes fx-rise { to { opacity: 1; transform: none; } }

.fx-card { position: relative; background: #fff; border: 1px solid var(--line); border-radius: 20px; padding: 20px; min-width: 0;
  box-shadow: 0 1px 2px rgba(16,40,28,.04), 0 8px 24px -14px rgba(16,40,28,.16);
  transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
.fx-lift:hover { transform: translateY(-3px); box-shadow: 0 2px 4px rgba(16,40,28,.05), 0 20px 40px -18px rgba(16,40,28,.28); }
.fx-card.fx-focus:focus-within { border-color: #9fd9b9; box-shadow: 0 0 0 4px rgba(204,255,0,.28), 0 8px 24px -14px rgba(16,40,28,.16); }
.fx-dark { background: radial-gradient(130% 120% at 100% 0%, #11402c 0%, #0a2318 42%, #07150f 100%); color: #eaf5ee; border-color: #1a3b2c; }
.fx-dark .fx-muted { color: #8fb3a0; }
.fx-muted { color: var(--muted); }
.fx-h2 { font-size: 16px; font-weight: 900; margin: 0; letter-spacing: -.01em; }
.fx-sub { font-size: 12.5px; margin: 3px 0 0; color: var(--muted); }
.fx-dark .fx-sub { color: #8fb3a0; }
.fx-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.fx-link { margin-left: auto; font-size: 12.5px; font-weight: 800; color: #0058bb; white-space: nowrap; }
.fx-dark .fx-link { color: var(--lime); }
.fx-link:hover { text-decoration: underline; }
.fx-clip2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.fx-clip3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

.fx-hero { position: relative; overflow: hidden; isolation: isolate; border-radius: 24px; padding: 26px 28px; color: #fff;
  background: radial-gradient(120% 150% at 0% 0%, #0f5a3c 0%, #06301f 46%, #04150e 100%); margin-bottom: 18px; }
.fx-hero::before { content: ''; position: absolute; inset: 0; z-index: -1;
  background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
  background-size: 28px 28px; -webkit-mask-image: radial-gradient(80% 90% at 70% 40%, #000 30%, transparent 75%);
  mask-image: radial-gradient(80% 90% at 70% 40%, #000 30%, transparent 75%); }
.fx-orb { position: absolute; z-index: -1; border-radius: 50%; filter: blur(46px); opacity: .5; animation: fx-drift 16s ease-in-out infinite alternate; }
.fx-orb.a { background: var(--lime); width: 200px; height: 200px; top: -120px; right: 30%; opacity: .2; }
.fx-orb.b { background: var(--mint); width: 280px; height: 280px; bottom: -150px; left: -60px; animation-delay: -6s; }
.fx-orb.c { background: #3d7bff; width: 170px; height: 170px; top: 20%; right: -50px; opacity: .3; animation-delay: -11s; }
@keyframes fx-drift { 0% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,18px) scale(1.12); } 100% { transform: translate(-24px,10px) scale(.94); } }
.fx-eyebrow { font-size: 11px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: var(--lime); }
.fx-hero h1 { font-size: 30px; font-weight: 900; letter-spacing: -.02em; margin: 6px 0 6px; line-height: 1.15; }
.fx-hero p { margin: 0; color: #b9d6c6; font-size: 14px; line-height: 1.55; }
.fx-hero-chip { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 800;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #fff; backdrop-filter: blur(6px); white-space: nowrap;
  transition: background .2s ease, transform .2s ease; }
a.fx-hero-chip:hover { background: rgba(255,255,255,.16); transform: translateY(-1px); }
.fx-hero-chip.warn { background: var(--lime); color: var(--ink); border-color: var(--lime); }
.fx-team { display: flex; align-items: center; gap: 6px; margin-top: 16px; flex-wrap: wrap; }
.fx-mate { position: relative; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 15px;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.14); }
.fx-mate:hover { background: rgba(255,255,255,.2); }
.fx-mate .busy { position: absolute; right: -3px; top: -3px; width: 12px; height: 12px; border-radius: 50%; background: var(--lime); border: 2px solid #06301f; }

.fx-radar { position: relative; width: 116px; height: 116px; display: grid; place-items: center; flex: none; }
.fx-radar span { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(204,255,0,.55); animation: fx-radar 3s ease-out infinite; }
.fx-radar span:nth-child(2) { animation-delay: 1s; } .fx-radar span:nth-child(3) { animation-delay: 2s; }
.fx-radar b { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; font-size: 26px; background: var(--lime); box-shadow: 0 0 40px rgba(204,255,0,.45); }
.fx-radar.light span { border-color: rgba(0,76,49,.35); }
.fx-radar.light b { background: #e3f4ea; box-shadow: 0 0 30px rgba(25,195,125,.3); }
@keyframes fx-radar { from { transform: scale(.45); opacity: .9; } to { transform: scale(1.15); opacity: 0; } }

.fx-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(108px, 1fr)); gap: 10px; margin-bottom: 14px; }
.fx-stat { border-radius: 14px; padding: 11px 12px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08); min-width: 0; }
.fx-stat .k { font-size: 10.5px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; color: #8fb3a0; }
.fx-stat .v { font-size: 21px; font-weight: 900; margin-top: 3px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fx-stat .h { font-size: 11px; color: #8fb3a0; margin-top: 2px; }
.fx-chart { border-radius: 16px; padding: 12px 12px 6px; background: rgba(0,0,0,.18); border: 1px solid rgba(255,255,255,.06); margin-bottom: 14px; }
.fx-camp { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid rgba(255,255,255,.08); }
.fx-camp:first-child { border-top: 0; }
.fx-note { position: relative; display: flex; gap: 10px; align-items: flex-start; border-radius: 16px; padding: 12px 14px; margin-top: 12px;
  background: rgba(204,255,0,.08); border: 1px solid rgba(204,255,0,.2); font-size: 13px; line-height: 1.55; }
.fx-waiting { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 11px 13px; border-radius: 14px; background: #fff6dc;
  color: #7a5200; font-size: 13px; font-weight: 800; border: 1px solid #fde7a6; transition: transform .2s ease; }
.fx-waiting:hover { transform: translateX(3px); }
.fx-runrow { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 12px 13px; border-radius: 14px; background: #f5f8f6; }
.fx-funnel { display: grid; gap: 10px; }
.fx-funnel-row { display: grid; grid-template-columns: 118px minmax(0, 1fr) 44px; gap: 10px; align-items: center; font-size: 12.5px; font-weight: 800; }
.fx-funnel-row .n { text-align: right; font-variant-numeric: tabular-nums; font-size: 14px; font-weight: 900; }
.fx-agents { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding: 12px 13px; border-radius: 14px; background: linear-gradient(135deg, #eef6ff, #f3fbe6); }
.fx-avatar { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-size: 16px; border: 2px solid #fff; margin-left: -8px; }
.fx-avatar:first-child { margin-left: 0; }

.fx-bob { animation: fx-bob 3.4s ease-in-out infinite; animation-delay: calc(var(--i, 0) * -420ms); }
@keyframes fx-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.fx-wave { display: inline-block; transform-origin: 70% 70%; animation: fx-wave 2.6s ease-in-out infinite; }
@keyframes fx-wave { 0%, 60%, 100% { transform: rotate(0); } 10%, 30% { transform: rotate(14deg); } 20% { transform: rotate(-8deg); } 40% { transform: rotate(-4deg); } 50% { transform: rotate(10deg); } }
.fx-wiggle { display: inline-block; transform-origin: 50% 0; animation: fx-wiggle 3s ease-in-out infinite; }
@keyframes fx-wiggle { 0%, 70%, 100% { transform: rotate(0); } 75% { transform: rotate(14deg); } 80% { transform: rotate(-12deg); } 85% { transform: rotate(8deg); } 90% { transform: rotate(-4deg); } }

.fx-btn { position: relative; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 12px;
  padding: 11px 18px; font: inherit; font-size: 14px; font-weight: 800; color: #fff; cursor: pointer; text-decoration: none;
  background: linear-gradient(135deg, #00704a, #004c31 60%, #003924); box-shadow: 0 8px 20px -10px rgba(0,76,49,.8);
  transition: transform .15s ease, box-shadow .2s ease, opacity .2s ease; }
.fx-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 26px -12px rgba(0,76,49,.9); }
.fx-btn:active { transform: scale(.98); }
.fx-btn::after { content: ''; position: absolute; inset: 0; transform: translateX(-120%); transition: transform .7s ease;
  background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.35) 50%, transparent 70%); }
.fx-btn:hover::after { transform: translateX(120%); }
.fx-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; box-shadow: none; }
.fx-btn.lime { background: var(--lime); color: var(--ink); box-shadow: 0 8px 20px -10px rgba(170,214,0,.9); }
.fx-btn.ghost { background: #fff; color: var(--forest); border: 1px solid var(--line); box-shadow: none; }
.fx-btn.small { padding: 8px 13px; font-size: 13px; border-radius: 10px; }
.fx-dark .fx-btn.ghost { background: rgba(255,255,255,.06); color: #eaf5ee; border-color: rgba(255,255,255,.16); }

.fx-seg { display: flex; gap: 7px; flex-wrap: wrap; }
.fx-seg button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); background: #fff; color: #1c1b1b;
  border-radius: 999px; padding: 8px 15px; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; transition: all .2s ease; }
.fx-seg button:hover { border-color: #a8d5bd; transform: translateY(-1px); }
.fx-seg button[aria-checked='true'] { background: var(--forest); border-color: var(--forest); color: #fff; box-shadow: 0 8px 18px -10px rgba(0,76,49,.9); }

.fx-input { width: 100%; border: 1px solid var(--line); border-radius: 14px; padding: 13px 14px; font: inherit; font-size: 14.5px; line-height: 1.55;
  background: #fbfcfb; color: #1c1b1b; resize: vertical; transition: border-color .2s ease, background .2s ease, box-shadow .2s ease; }
.fx-input:focus { outline: none; border-color: #7cc9a0; background: #fff; box-shadow: 0 0 0 4px rgba(25,195,125,.13); }
.fx-mini { padding: 7px 10px; font: inherit; font-size: 13px; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: #1c1b1b; width: 96px; }
.fx-mini:focus { outline: none; border-color: #7cc9a0; box-shadow: 0 0 0 3px rgba(25,195,125,.13); }

.fx-opt { display: grid; grid-template-columns: 44px minmax(0, 1fr) 24px; gap: 12px; align-items: center; width: 100%; text-align: left;
  padding: 13px; border-radius: 16px; border: 1.5px solid var(--line); background: #fff; color: inherit; font: inherit; cursor: pointer;
  transition: border-color .25s ease, background .25s ease, transform .2s ease, box-shadow .25s ease; }
.fx-opt:hover { border-color: #b9dcc9; transform: translateY(-1px); }
.fx-opt:disabled { cursor: wait; }
.fx-opt[aria-checked='true'] { border-color: var(--forest); background: linear-gradient(135deg, #f4fbe3, #ebf7f0); box-shadow: 0 12px 26px -18px rgba(0,76,49,.7); }
.fx-opt .ico { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; font-size: 21px; background: #f1f5f3; transition: transform .3s ease, background .3s ease; }
.fx-opt[aria-checked='true'] .ico { background: var(--forest); transform: rotate(-6deg) scale(1.05); }
.fx-opt .tick { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--line); display: grid; place-items: center; font-size: 13px; font-weight: 900; color: var(--ink); }
.fx-opt[aria-checked='true'] .tick { background: var(--lime); border-color: var(--lime); animation: fx-pop .4s cubic-bezier(.3,1.6,.5,1); }
@keyframes fx-pop { 0% { transform: scale(.3); } 100% { transform: scale(1); } }

.fx-switch { position: relative; flex: none; width: 46px; height: 26px; border: 0; border-radius: 999px; background: #d3dcd7; cursor: pointer; transition: background .25s ease; }
.fx-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .3s cubic-bezier(.3,1.4,.5,1); }
.fx-switch[aria-checked='true'] { background: var(--mint); }
.fx-switch[aria-checked='true']::after { transform: translateX(20px); }
.fx-switch:disabled { opacity: .5; cursor: wait; }

.fx-ico { width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center; font-size: 20px; flex: none; }
.fx-num { font-size: 30px; font-weight: 900; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fx-delta { font-size: 12px; font-weight: 900; border-radius: 999px; padding: 2px 8px; }
.fx-delta.up { color: #047857; background: #04785714; }
.fx-delta.down { color: #ba1a1a; background: #ba1a1a12; }

.fx-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 900; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
.fx-live { width: 8px; height: 8px; border-radius: 50%; background: var(--mint); flex: none; animation: fx-ping 1.8s ease-out infinite; }
.fx-live.lime { background: var(--lime); }
.fx-live.off { background: #9aa5a0; animation: none; }
@keyframes fx-ping { 0% { box-shadow: 0 0 0 0 rgba(25,195,125,.6); } 80%, 100% { box-shadow: 0 0 0 9px rgba(25,195,125,0); } }

.fx-bar { height: 10px; border-radius: 999px; background: #eef2ef; overflow: hidden; }
.fx-dark .fx-bar { background: rgba(255,255,255,.08); }
.fx-bar > i { display: block; height: 100%; border-radius: inherit; transform-origin: left center;
  animation: fx-grow 1s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(var(--i, 0) * 90ms + 200ms); }
@keyframes fx-grow { from { transform: scaleX(0); } }
.fx-reveal { transform-box: fill-box; transform-origin: left center; animation: fx-grow 1.4s cubic-bezier(.2,.7,.2,1) both .15s; }
.fx-ring { animation: fx-ring 1.3s cubic-bezier(.2,.7,.2,1) both .2s; }
@keyframes fx-ring { from { stroke-dashoffset: var(--c); } }

.fx-skel { border-radius: 10px; background: linear-gradient(90deg, #eef2ef 25%, #f7f9f8 37%, #eef2ef 63%); background-size: 400% 100%; animation: fx-shimmer 1.4s ease infinite; }
@keyframes fx-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.fx-typing span { display: inline-block; width: 6px; height: 6px; margin: 0 2px; border-radius: 50%; background: currentColor; animation: fx-type 1.2s infinite ease-in-out; }
.fx-typing span:nth-child(2) { animation-delay: .15s; } .fx-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes fx-type { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

.fx-grid-kpi { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 18px; }
.fx-grid-split { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr); gap: 18px; align-items: start; margin-bottom: 18px; }
.fx-grid-split.one { grid-template-columns: minmax(0, 1fr); }
@media (max-width: 1180px) { .fx-grid-split { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 900px) { .fx-grid-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); } .fx-hero h1 { font-size: 24px; } }
@media (max-width: 520px) { .fx-grid-kpi { grid-template-columns: minmax(0, 1fr); } .fx-hero { padding: 20px; } }

@media (prefers-reduced-motion: reduce) {
  .fx *, .fx *::before, .fx *::after { animation: none !important; transition: none !important; }
  .fx-rise { opacity: 1; transform: none; }
}
`;

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up to its value — and from the old value to the new one when it changes. */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString('en-PK'),
  ms = 1000,
}: {
  value: number;
  format?: (n: number) => string;
  ms?: number;
}) {
  const [shown, setShown] = useState(0);
  const at = useRef(0);
  useEffect(() => {
    if (reduced()) {
      const t = setTimeout(() => {
        at.current = value;
        setShown(value);
      }, 0);
      return () => clearTimeout(t);
    }
    const from = at.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      at.current = from + (value - from) * (1 - (1 - k) ** 3);
      setShown(at.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{format(shown)}</>;
}

/**
 * A smooth area sparkline that reveals itself left to right. Scales to its box
 * (the stroke does not, thanks to non-scaling-stroke); the curve runs through
 * midpoints, so it never dips below zero between two points.
 */
export function AreaSpark({
  values,
  color = '#19c37d',
  height = 56,
  fill = true,
}: {
  values: number[];
  color?: string;
  height?: number;
  fill?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  if (values.length < 2) return null;
  const W = 100;
  const H = 40;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - (v / max) * (H - 8)] as const);
  let line = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    line += ` Q${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`;
    if (i === pts.length - 1) line += ` T${x1} ${y1}`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".38" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <clipPath id={`c${id}`}>
          <rect className="fx-reveal" x="-2" y="-6" width={W + 4} height={H + 12} />
        </clipPath>
      </defs>
      <g clipPath={`url(#c${id})`}>
        {fill ? <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#g${id})`} /> : null}
        <path d={line} fill="none" stroke={color} strokeWidth={2.2} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** A progress ring that fills on arrival; whatever sits in the middle is the children. */
export function Ring({
  value,
  size = 64,
  stroke = 7,
  color = '#19c37d',
  track = '#eef2ef',
  children,
}: {
  /** 0–1. */
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} aria-hidden style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          className="fx-ring"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ ['--c' as string]: c } as React.CSSProperties}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  );
}
