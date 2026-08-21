'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

import styles from './site.module.css';

/**
 * Fade-and-lift a block the first time it enters the viewport.
 *
 * The content is in the DOM and readable from the first paint — only opacity
 * and transform change — so crawlers and no-JS visitors lose nothing, and the
 * reduced-motion rule in site.module.css renders it settled straight away.
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  return (
    <Tag
      ref={ref}
      className={`${styles.reveal} ${shown ? styles.revealIn : ''} ${className}`.trim()}
      style={{ ['--reveal-delay' as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
