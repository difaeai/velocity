import type { ComponentType, SVGProps } from 'react';

import styles from './site.module.css';

type Item = { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string };

/**
 * A services ticker.
 *
 * Pure CSS: the list is rendered twice and the track is translated a full
 * -100%, so the second copy lands exactly where the first began and the loop is
 * seamless without measuring anything. No JS, no client boundary, no layout
 * reads — which also means it costs nothing on a mid-range phone.
 *
 * Two of these stacked and running opposite ways read as motion rather than as
 * a banner; `reverse` flips the direction, and `muted` drops the second row
 * back so the pair has a foreground and a background instead of competing.
 *
 * The duplicate is `aria-hidden`, so a screen reader hears the services once
 * rather than twice, and the strip pauses on hover and on focus (WCAG 2.2
 * requires a pause for anything that moves for more than five seconds).
 */
export function Marquee({
  items,
  reverse = false,
  muted = false,
}: {
  items: Item[];
  reverse?: boolean;
  muted?: boolean;
}) {
  const track = (
    <div className={`${styles.marqueeTrack} ${reverse ? styles.marqueeReverse : ''}`}>
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
    <div className={`${styles.marquee} ${muted ? styles.marqueeMuted : ''}`}>
      {track}
      <div aria-hidden="true" style={{ display: 'contents' }}>
        {track}
      </div>
    </div>
  );
}
