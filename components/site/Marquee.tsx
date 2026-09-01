import type { ComponentType, SVGProps } from 'react';

import styles from './site.module.css';

type Item = { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string };

/**
 * The services ticker that sits directly under the hero.
 *
 * Pure CSS: the list is rendered twice and the track is translated a full
 * -100%, so the second copy lands exactly where the first began and the loop is
 * seamless without measuring anything. No JS, no client boundary, no layout
 * reads — which also means it costs nothing on a mid-range phone.
 *
 * The duplicate is `aria-hidden`, so a screen reader hears the six services
 * once rather than twice, and the whole strip pauses on hover and on focus (a
 * WCAG 2.2 requirement for anything that moves for more than five seconds).
 */
export function Marquee({ items }: { items: Item[] }) {
  const track = (
    <div className={styles.marqueeTrack}>
      {items.map(({ icon: Ico, label }) => (
        <span key={label} className={styles.marqueeItem}>
          <Ico />
          {label}
          <span className={styles.marqueeDot} aria-hidden="true" />
        </span>
      ))}
    </div>
  );

  return (
    <div className={styles.marquee}>
      {track}
      <div aria-hidden="true" style={{ display: 'contents' }}>
        {track}
      </div>
    </div>
  );
}
