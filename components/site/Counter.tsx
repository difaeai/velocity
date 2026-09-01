'use client';

import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from './useReducedMotion';

/**
 * A figure that counts up the first time it is scrolled into view.
 *
 * The final value is what renders on the server and what a crawler or a no-JS
 * visitor sees — the animation only ever runs *down* from that and back up, so
 * the number in the DOM is never a lie about what the page claims. Under
 * reduced motion it never animates at all.
 *
 * Eased with the same expo-out curve as the rest of the page so a counter and a
 * reveal that fire together feel like one movement rather than two.
 */
export function Counter({
  to,
  suffix = '',
  prefix = '',
  duration = 1400,
  className,
}: {
  to: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(to);
  const still = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;

    let frame = 0;
    let start = 0;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        setValue(0);

        const tick = (now: number) => {
          if (!start) start = now;
          const p = Math.min(1, (now - start) / duration);
          // expo.out — fast off the line, long settle, like the rest of the page
          const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
          setValue(Math.round(to * eased));
          if (p < 1) frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [to, duration, still]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
