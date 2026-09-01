import styles from './site.module.css';

/**
 * The intercity route diagram that sits inside the City to City tile.
 *
 * Five nodes on a stylised map with the legs drawing themselves in sequence —
 * a dash pattern the length of each path, animated from fully offset to zero,
 * so the line appears to travel rather than fade in. Pure SVG and CSS: no
 * library, no client boundary, and it costs about a kilobyte.
 *
 * Deliberately not a real map of Pakistan. A recognisable but wrong outline is
 * worse than an abstract one, and an accurate one would need a projection and
 * a licence for the shape data.
 */
const LEGS = [
  { d: 'M 26 104 C 70 78 96 66 132 54', delay: 0 },
  { d: 'M 132 54 C 168 44 196 52 224 74', delay: 1.1 },
  { d: 'M 224 74 C 248 92 258 112 262 136', delay: 2.2 },
  { d: 'M 132 54 C 128 84 118 108 96 132', delay: 1.6 },
];

const NODES = [
  { cx: 26, cy: 104, r: 5 },
  { cx: 132, cy: 54, r: 7 },
  { cx: 224, cy: 74, r: 5 },
  { cx: 262, cy: 136, r: 5 },
  { cx: 96, cy: 132, r: 5 },
];

export function RouteMap() {
  return (
    <svg className={styles.routeMap} viewBox="0 0 288 168" aria-hidden="true" focusable="false">
      {/* the ghost of each leg, so the shape of the network reads before the
          animation has drawn it */}
      {LEGS.map((l) => (
        <path key={`g-${l.d}`} d={l.d} className={styles.routeGhost} />
      ))}

      {LEGS.map((l) => (
        <path
          key={l.d}
          d={l.d}
          className={styles.routeLine}
          style={{ animationDelay: `${l.delay}s` }}
        />
      ))}

      {NODES.map((n) => (
        <g key={`${n.cx}-${n.cy}`}>
          <circle cx={n.cx} cy={n.cy} r={n.r + 5} className={styles.routeHalo} />
          <circle cx={n.cx} cy={n.cy} r={n.r} className={styles.routeNode} />
        </g>
      ))}
    </svg>
  );
}
