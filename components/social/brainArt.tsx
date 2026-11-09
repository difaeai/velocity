/**
 * The Velocity Brain's drawing and its CSS, apart from the console's brain.tsx so
 * the public site can show the same brain without loading Firebase. Inline SVG
 * built once from fixed numbers (the same on the server and in the browser).
 * The animations read --speed and --lime from whatever they sit inside.
 */

type P = [number, number];
const CX = 160;
const CY = 140;
const RX = 132;
const RY = 118;
const GAP = 4;
export const r1 = (n: number) => Math.round(n * 10) / 10;

/** A smooth path through the points (Catmull-Rom as cubic Béziers). */
function smooth(pts: P[], closed = false): string {
  const n = pts.length;
  const at = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d +=
      ` C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)}` +
      ` ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return closed ? `${d} Z` : d;
}

/** One half of the brain seen from above: a bumpy outer edge, then back up the middle. */
function lobe(s: 1 | -1): P[] {
  const pts: P[] = [];
  for (let k = 0; k <= 40; k++) {
    const t = -Math.PI / 2 + (Math.PI * k) / 40;
    const bump = 1 + 0.035 * Math.sin(t * 13 + (s > 0 ? 1.3 : 0));
    pts.push([CX + s * (GAP + RX * Math.cos(t) * bump * (1 + 0.08 * Math.sin(t))), CY + RY * Math.sin(t) * bump]);
  }
  for (let k = 1; k < 8; k++) pts.push([CX + s * (GAP + 3 * Math.sin(k * 1.7)), CY + RY - (2 * RY * k) / 8]);
  return pts;
}

function buildArt() {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lobes: string[] = [];
  const folds: string[] = [];
  const nodes: P[] = [];
  for (const s of [-1, 1] as const) {
    lobes.push(smooth(lobe(s), true));
    const hx = CX + s * (GAP + RX * 0.5);
    const hy = CY + 4;
    // The folds: lines meandering front to back, clipped to the half they sit in.
    for (let i = 0; i < 7; i++) {
      const x0 = CX + s * (GAP + 12 + i * 18);
      const p1 = rand() * 6;
      const p2 = rand() * 6;
      const pts: P[] = [];
      for (let y = CY - RY - 4; y <= CY + RY + 4; y += 6) {
        pts.push([x0 + 6.5 * Math.sin(y * 0.085 + p1) + 3 * Math.sin(y * 0.21 + p2), y]);
      }
      folds.push(smooth(pts));
    }
    for (let n = 0; n < 15; ) {
      const x = rand() * 2 - 1;
      const y = rand() * 2 - 1;
      if (x * x + y * y > 1) continue;
      nodes.push([r1(hx + x * RX * 0.42), r1(hy + y * RY * 0.78)]);
      n++;
    }
  }
  // The bridges across the middle.
  const bridges = [-34, 0, 34].map((dy) =>
    smooth([[CX - 34, CY + dy + 6], [CX, CY + dy - 4], [CX + 34, CY + dy + 6]]),
  );
  // Each node to its two nearest.
  const edges: [P, P][] = [];
  const seen = new Set<string>();
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => [j, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2] as const)
      .filter(([j]) => j !== i)
      .sort((p, q) => p[1] - q[1])
      .slice(0, 2)
      .forEach(([j]) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([a, nodes[j]]);
        }
      });
  });
  return { lobes, folds, bridges, nodes, edges };
}

const ART = buildArt();
export const vars = (v: Record<string, string | number>) => v as React.CSSProperties;

export function BrainArt() {
  return (
    <svg viewBox="0 0 320 280" className="bn-art" aria-hidden>
      <defs>
        <radialGradient id="bn-halo">
          <stop offset="0" stopColor="#ccff00" stopOpacity=".34" />
          <stop offset=".55" stopColor="#19c37d" stopOpacity=".1" />
          <stop offset="1" stopColor="#19c37d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bn-skin" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#19c37d" stopOpacity=".2" />
          <stop offset="1" stopColor="#0b3d27" stopOpacity=".08" />
        </linearGradient>
        <filter id="bn-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx={CX} cy={CY} r="156" fill="url(#bn-halo)" className="bn-halo" />
      <g transform={`translate(${CX} ${CY}) rotate(-16) scale(1 .3)`}>
        <g className="bn-orbit">
          <circle r="154" className="bn-ring" />
          <circle cx="154" r="6" className="bn-spark" />
          <circle cx="-154" r="4" className="bn-spark" />
        </g>
      </g>
      <g className="bn-body">
        {ART.lobes.map((d) => (
          <path key={d} d={d} fill="url(#bn-skin)" className="bn-lobe" />
        ))}
        {ART.edges.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="bn-edge" />
        ))}
        <clipPath id="bn-clip">
          {ART.lobes.map((d) => (
            <path key={d} d={d} />
          ))}
        </clipPath>
        {[ART.folds, ART.bridges].map((paths, g) => (
          <g key={g} filter="url(#bn-glow)" clipPath={g ? undefined : 'url(#bn-clip)'}>
            {paths.map((d) => (
              <path key={d} d={d} className="bn-fold" />
            ))}
            {paths.map((d, i) => (
              <path
                key={`f${d}`}
                d={d}
                pathLength={100}
                className="bn-flow"
                style={vars({ '--d': `${2 + (i % 5) * 0.5}s`, animationDelay: `${-i * 0.43}s` })}
              />
            ))}
          </g>
        ))}
        {ART.nodes.map(([x, y], i) => (
          <circle
            key={`${x},${y}`}
            cx={x}
            cy={y}
            r={i % 4 ? 1.7 : 2.8}
            className="bn-node"
            style={{ animationDelay: `${-((i * 0.29) % 2.6)}s` }}
          />
        ))}
      </g>
      <circle cx={CX} cy={CY} r="44" className="bn-ping" />
      <circle cx={CX} cy={CY} r="44" className="bn-ping late" />
    </svg>
  );
}

export const BRAIN_ART_CSS = `
.bn-art { width: 100%; height: 100%; overflow: visible; }
.bn-halo { transform-box: fill-box; transform-origin: center; animation: bn-halo calc(4s * var(--speed)) ease-in-out infinite; }
@keyframes bn-halo { 0%, 100% { opacity: .65; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.04); } }
.bn.thinking .bn-halo { opacity: 1; }
.bn-ring { fill: none; stroke: rgba(204,255,0,.28); stroke-width: 3; stroke-dasharray: 2 14; }
.bn-spark { fill: var(--lime); }
.bn-orbit { animation: bn-spin calc(16s * var(--speed)) linear infinite; }
@keyframes bn-spin { to { transform: rotate(360deg); } }
.bn-body { transform-box: fill-box; transform-origin: center; animation: bn-breathe calc(5s * var(--speed)) ease-in-out infinite; }
@keyframes bn-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
.bn-lobe { stroke: rgba(204,255,0,.6); stroke-width: 1.6; }
.bn-edge { stroke: rgba(234,245,238,.13); stroke-width: .8; }
.bn-fold { fill: none; stroke: rgba(25,195,125,.6); stroke-width: 1.5; stroke-linecap: round; }
.bn-flow { fill: none; stroke: var(--lime); stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 8 92;
  animation: bn-dash calc(var(--d) * var(--speed)) linear infinite; }
.bn-node { fill: #eaffb0; transform-box: fill-box; transform-origin: center; animation: bn-twinkle calc(2.6s * var(--speed)) ease-in-out infinite; }
@keyframes bn-twinkle { 0%, 100% { opacity: .25; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.25); } }
.bn-ping { fill: none; stroke: var(--lime); stroke-width: 2; opacity: 0; transform-box: fill-box; transform-origin: center; }
.bn.thinking .bn-ping { animation: bn-ping 1.6s ease-out infinite; }
.bn.thinking .bn-ping.late { animation-delay: .8s; }
@keyframes bn-ping { from { opacity: .8; transform: scale(.4); } to { opacity: 0; transform: scale(3.4); } }
@keyframes bn-dash { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
`;
