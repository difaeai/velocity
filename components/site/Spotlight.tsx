'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Pointer-tracked spotlight for a grid of tiles.
 *
 * One delegated listener on the grid rather than one per tile, coalesced to a
 * frame, writing two custom properties on whichever tile is under the cursor.
 * CSS does the rest, so a pointer move costs a single style write and no React
 * render at all.
 *
 * Fine pointers only. On a touch screen there is no hover state to track, and
 * attaching the listener anyway would burn battery to move a highlight nobody
 * can see.
 */
export function SpotlightGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let frame = 0;
    let latest: { x: number; y: number; el: HTMLElement } | null = null;

    const apply = () => {
      frame = 0;
      if (!latest) return;
      const { x, y, el } = latest;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${x - r.left}px`);
      el.style.setProperty('--my', `${y - r.top}px`);
    };

    const onMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const tile = target?.closest?.('[data-tile]') as HTMLElement | null;
      if (!tile) return;
      latest = { x: e.clientX, y: e.clientY, el: tile };
      if (!frame) frame = requestAnimationFrame(apply);
    };

    grid.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      grid.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
