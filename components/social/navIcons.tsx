/**
 * The sidebar's icons.
 *
 * Emoji were doing this job, and they were the wrong tool: they are a different
 * typeface on every machine, they cannot take the nav's colour, and they cannot
 * move. These are line drawings in one stroke weight that inherit `currentColor`
 * — so an item that is active, hovered or dimmed gets an icon to match — and
 * each one has a small movement of its own that plays on hover and while its
 * page is open.
 *
 * The movement is never decoration for its own sake: it shows what the thing
 * does. The clapper claps, the megaphone throws its waves out, the funnel
 * drips, the plug pushes in, the gear turns. A person who cannot read the label
 * (the rail is collapsed, or English is not theirs) still gets told something.
 *
 * All of it is CSS on `<path>` elements — no icon font, no sprite sheet, no
 * dependency — and every animation is inside the `prefers-reduced-motion` guard
 * at the bottom of `NAV_ICON_CSS`.
 */

export type NavIconName =
  | 'home'
  | 'content'
  | 'comments'
  | 'analytics'
  | 'research'
  | 'ads'
  | 'whatsapp'
  | 'funnel'
  | 'email'
  | 'calls'
  | 'plug'
  | 'agents'
  | 'settings'
  | 'plan'
  | 'usage'
  | 'people'
  | 'money'
  | 'map'
  | 'shield'
  | 'tools';

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * Every icon, as the paths inside a 24×24 box. Parts that move carry a class;
 * `NAV_ICON_CSS` is what makes them move.
 */
const ART: Record<NavIconName, React.ReactNode> = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path className="ni-door" d="M9.5 20v-5.5h5V20" />
    </>
  ),
  content: (
    <>
      {/* the clapper board: the top bar hinges up */}
      <rect x="3" y="9.5" width="18" height="10.5" rx="2" />
      <g className="ni-clap">
        <path d="M3.4 9.5 4.6 5.6l16.1 1.6-.5 2.3" />
        <path d="M8.6 6 7.4 9.3M13.4 6.5 12.2 9.8" />
      </g>
    </>
  ),
  comments: (
    <>
      <path d="M20 13.5a3 3 0 0 1-3 3H9l-4 3v-3a3 3 0 0 1-1-2.2V7.5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" />
      <g className="ni-type">
        <circle cx="8.5" cy="10.8" r=".95" fill="currentColor" stroke="none" />
        <circle cx="12" cy="10.8" r=".95" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="10.8" r=".95" fill="currentColor" stroke="none" />
      </g>
    </>
  ),
  analytics: (
    <>
      <path d="M4 4v15a1 1 0 0 0 1 1h15" />
      <g className="ni-bars">
        <path d="M8 16.5V12" />
        <path d="M12.5 16.5V7.5" />
        <path d="M17 16.5v-6" />
      </g>
    </>
  ),
  research: (
    <>
      <circle className="ni-lens" cx="11" cy="11" r="6" />
      <path d="m15.4 15.4 4.1 4.1" />
      <path className="ni-sweep" d="M8.4 11a2.6 2.6 0 0 1 2.6-2.6" />
    </>
  ),
  ads: (
    <>
      <path d="M4 9.5v5a1 1 0 0 0 1 1h3l5.5 3.5V5L8 8.5H5a1 1 0 0 0-1 1z" />
      <path className="ni-wave w1" d="M16.7 9.3a4 4 0 0 1 0 5.4" />
      <path className="ni-wave w2" d="M19 7a7.3 7.3 0 0 1 0 10" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M20 11.6a7.6 7.6 0 0 1-11.2 6.7L4.5 19.5l1.3-4.1A7.6 7.6 0 1 1 20 11.6z" />
      <path className="ni-tick" d="m8.7 12 2.2 2.2 4.4-4.4" pathLength={1} />
    </>
  ),
  funnel: (
    <>
      <path d="M3.5 5h17l-6.4 7.4V19l-4.2 1.6v-8.2z" />
      <circle className="ni-drip" cx="12" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
      <path className="ni-flap" d="m3.6 7 7.1 5.3a2.2 2.2 0 0 0 2.6 0L20.4 7" />
    </>
  ),
  calls: (
    <g className="ni-ring">
      <path d="M8.6 4.5 10.9 8l-1.9 1.9a12 12 0 0 0 5.1 5.1L16 13.1l3.5 2.3-.6 2.6a2 2 0 0 1-2.2 1.5C10 18.8 5.2 14 4.3 7.3a2 2 0 0 1 1.5-2.2z" />
    </g>
  ),
  plug: (
    <>
      <path className="ni-plugbody" d="M14.5 4.5v4M18 4.5v4M12.8 8.5h6.4v2.6a3.2 3.2 0 0 1-3.2 3.2h0a3.2 3.2 0 0 1-3.2-3.2z" />
      <path d="M16 14.3V17a3 3 0 0 1-3 3H7" />
      <circle className="ni-spark" cx="5" cy="20" r="1.6" />
    </>
  ),
  agents: (
    <>
      <rect x="4" y="8.5" width="16" height="11" rx="3" />
      <path className="ni-ant" d="M12 8.5V5" />
      <circle className="ni-ant" cx="12" cy="4" r="1.3" />
      <g className="ni-eyes">
        <circle cx="9.2" cy="13.3" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="14.8" cy="13.3" r="1.15" fill="currentColor" stroke="none" />
      </g>
      <path d="M9.8 16.6h4.4" />
    </>
  ),
  settings: (
    <>
      <g className="ni-gear">
        <path d="M12 3.6l1.5 1.9 2.4-.5.5 2.4 2.1 1.2-1.2 2.1 1.2 2.1-2.1 1.2-.5 2.4-2.4-.5L12 18l-1.5-1.9-2.4.5-.5-2.4-2.1-1.2 1.2-2.1-1.2-2.1 2.1-1.2.5-2.4 2.4.5z" />
      </g>
      <circle cx="12" cy="10.8" r="2.4" />
    </>
  ),
  plan: (
    <>
      <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 9.9 9.4 9z" />
      <path className="ni-shine" d="M9.6 8.2 12 5.9l2.4 2.3" />
    </>
  ),
  usage: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path className="ni-hand" d="M12 12V7.4" />
      <path d="M12 12l3.2 2.4" />
    </>
  ),
  people: (
    <>
      <circle cx="9.5" cy="9" r="3.2" />
      <path d="M4 19.5a5.5 5.5 0 0 1 11 0" />
      <path className="ni-second" d="M15.5 7.2a3 3 0 0 1 0 5.9M17 19.5a5.4 5.4 0 0 0-1.6-3.9" />
    </>
  ),
  money: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.4" />
      <circle className="ni-coin" cx="12" cy="12" r="2.6" />
      <path d="M6.2 9.4v5.2M17.8 9.4v5.2" />
    </>
  ),
  map: (
    <>
      <path d="M9.2 4.6 4 6.8v12.6l5.2-2.2 5.6 2.2 5.2-2.2V4.6l-5.2 2.2z" />
      <path className="ni-route" d="M9.2 4.6v12.6M14.8 6.8v12.6" pathLength={1} />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.6 5 6.3v5.4c0 4 2.9 7.6 7 8.7 4.1-1.1 7-4.7 7-8.7V6.3z" />
      <path className="ni-tick" d="m9 12 2.2 2.2 4-4.3" pathLength={1} />
    </>
  ),
  tools: (
    <>
      <path d="M14.4 4.6a4 4 0 0 0 5 5.2L9.9 19.3a2.2 2.2 0 0 1-3.2-3.1z" />
      <path className="ni-spark" d="M17.6 16.4 20 18.8M6 5.8l2 2" />
    </>
  ),
};

/** One icon. `size` is the box; the stroke stays the same weight at every size. */
export function NavIcon({ name, size = 19 }: { name: NavIconName; size?: number }) {
  return (
    <svg
      className={`ni ni-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      {...S}
    >
      {ART[name]}
    </svg>
  );
}

/**
 * What makes them move.
 *
 * Every rule is written against `.ni-live` — the class the sidebar puts on a row
 * that is hovered, focused or open — so an icon sitting still is genuinely
 * still, and a screen of twenty icons is not twenty animations at once.
 */
export const NAV_ICON_CSS = `
.ni { flex: none; overflow: visible; }
.ni * { transition: transform .4s cubic-bezier(.3,1.5,.5,1), opacity .3s ease; }

/* home — the door swings open */
.ni-live .ni-home .ni-door { transform-origin: 9.5px 20px; transform: perspective(40px) rotateY(-42deg); }

/* content — the clapper claps */
.ni-live .ni-content .ni-clap { transform-origin: 4px 8px; animation: ni-clap .85s cubic-bezier(.3,1.4,.5,1); }
@keyframes ni-clap { 0%,100% { transform: rotate(0); } 35% { transform: rotate(-22deg); } 60% { transform: rotate(4deg); } }

/* comments — the three dots type */
.ni-live .ni-comments .ni-type circle { animation: ni-type 1.1s ease-in-out infinite; }
.ni-live .ni-comments .ni-type circle:nth-child(2) { animation-delay: .15s; }
.ni-live .ni-comments .ni-type circle:nth-child(3) { animation-delay: .3s; }
@keyframes ni-type { 0%,70%,100% { transform: translateY(0); opacity: .45; } 35% { transform: translateY(-2.2px); opacity: 1; } }

/* analytics — the bars grow from the axis */
.ni-live .ni-analytics .ni-bars path { animation: ni-bar .6s cubic-bezier(.2,.8,.2,1) both; transform-origin: center bottom; }
.ni-live .ni-analytics .ni-bars path:nth-child(2) { animation-delay: .07s; }
.ni-live .ni-analytics .ni-bars path:nth-child(3) { animation-delay: .14s; }
@keyframes ni-bar { from { transform: scaleY(.15); } }

/* research — the glass sweeps across what it is reading */
.ni-live .ni-research .ni-sweep { animation: ni-sweep 1.6s linear infinite; transform-origin: 11px 11px; }
@keyframes ni-sweep { to { transform: rotate(360deg); } }
.ni-live .ni-research .ni-lens { transform-origin: 11px 11px; transform: scale(1.06); }

/* ads — the waves leave the megaphone */
.ni-live .ni-ads .ni-wave { animation: ni-wave 1.5s ease-out infinite; transform-origin: 14px 12px; }
.ni-live .ni-ads .w2 { animation-delay: .25s; }
@keyframes ni-wave { 0% { opacity: 0; transform: translateX(-2px); } 40% { opacity: 1; } 100% { opacity: 0; transform: translateX(2.5px); } }

/* whatsapp + shield — the tick draws itself */
.ni-tick { stroke-dasharray: 1; stroke-dashoffset: 0; }
.ni-live .ni-tick { animation: ni-draw .55s cubic-bezier(.4,0,.2,1) both; }
@keyframes ni-draw { from { stroke-dashoffset: 1; } }

/* funnel — a drop falls out of the bottom */
.ni-live .ni-funnel .ni-drip { animation: ni-drip 1.4s ease-in infinite; }
@keyframes ni-drip { 0% { transform: translateY(-4px) scale(.5); opacity: 0; } 35% { opacity: 1; } 100% { transform: translateY(3.5px) scale(.75); opacity: 0; } }

/* email — the flap opens */
.ni-live .ni-email .ni-flap { transform-origin: 12px 7px; transform: scaleY(-.85) translateY(-1.5px); opacity: .75; }

/* calls — the handset rings */
.ni-live .ni-calls .ni-ring { transform-origin: 12px 12px; animation: ni-shake .9s cubic-bezier(.36,.07,.19,.97); }
@keyframes ni-shake { 10%,30%,50% { transform: rotate(-11deg); } 20%,40%,60% { transform: rotate(11deg); } 70%,100% { transform: rotate(0); } }

/* plug — it pushes into the socket and sparks */
.ni-live .ni-plug .ni-plugbody { transform: translateY(1.6px); }
.ni-live .ni-plug .ni-spark, .ni-live .ni-tools .ni-spark { animation: ni-spark 1.3s ease-out infinite; }
@keyframes ni-spark { 0%,100% { opacity: .35; transform: scale(.82); } 45% { opacity: 1; transform: scale(1.12); } }

/* agents — it blinks and its antenna pulses */
.ni-live .ni-agents .ni-eyes { animation: ni-blink 3.2s steps(1,end) infinite; transform-origin: 12px 13.3px; }
@keyframes ni-blink { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(.12); } }
.ni-live .ni-agents .ni-ant { animation: ni-pulse 1.5s ease-in-out infinite; transform-origin: 12px 6px; }
@keyframes ni-pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }

/* settings — the gear turns */
.ni-live .ni-settings .ni-gear { transform-origin: 12px 10.8px; animation: ni-turn 7s linear infinite; }
@keyframes ni-turn { to { transform: rotate(360deg); } }

/* the rest — small, quiet moves */
.ni-live .ni-plan .ni-shine { animation: ni-pulse 1.4s ease-in-out infinite; }
.ni-live .ni-usage .ni-hand { transform-origin: 12px 12px; animation: ni-turn 4s linear infinite; }
.ni-live .ni-people .ni-second { transform: translateX(1.2px); opacity: .85; }
.ni-live .ni-money .ni-coin { transform-origin: 12px 12px; animation: ni-flip 2.4s ease-in-out infinite; }
@keyframes ni-flip { 0%,100% { transform: scaleX(1); } 50% { transform: scaleX(.18); } }
.ni-route { stroke-dasharray: 1; }
.ni-live .ni-map .ni-route { animation: ni-draw 1s ease both; }

@media (prefers-reduced-motion: reduce) {
  .ni *, .ni-live .ni * { animation: none !important; transition: none !important; transform: none !important; }
}
`;
