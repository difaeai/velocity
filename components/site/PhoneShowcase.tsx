'use client';

import Image from 'next/image';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Banknote, ChevronLeft, ChevronRight, Handshake, MapPin, Navigation, Pause, Play } from './Icons';
import { useReducedMotion } from './useReducedMotion';
import styles from './site.module.css';

const SLIDES = [
  {
    src: '/app/screen-book.png',
    icon: MapPin,
    title: 'Book in seconds',
    body: 'Pickup, destination, and the fare you want to pay. Solo or pooled, cash or wallet — all decided on one screen.',
    alt: 'The Velocity booking screen showing a pickup pin, a destination pin and a Request ride button.',
  },
  {
    src: '/app/screen-track.png',
    icon: Navigation,
    title: 'Track every metre',
    body: 'Watch your driver approach on a live map, share the trip with someone you trust, and reach the safety desk without leaving the ride.',
    alt: 'The Velocity live trip screen tracking a driver on the map with the trip details below.',
  },
  {
    src: '/app/screen-partner.png',
    icon: Handshake,
    title: 'Find a travel partner',
    body: 'Match with people who make your commute, form groups, split the cost, and keep up with your city in the feed.',
    alt: 'The Velocity Travel Partner screen showing commuter matches.',
  },
  {
    src: '/app/screen-cash.png',
    icon: Banknote,
    title: 'Pay in cash',
    body: 'No card, no account, no top-up needed. Hand the driver the fare at the end — the app handles the rest.',
    alt: 'The Velocity payment screen with cash selected as the payment method.',
  },
];

const DWELL = 6000;

export function PhoneShowcase() {
  const [active, setActive] = useState(0);
  // `paused` is the reader's explicit choice and sticks; `held` is the transient
  // stop while the pointer or keyboard focus is inside the block.
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const reduced = useReducedMotion();

  // Rotation runs only while the reader is looking at it, is not interacting
  // with it, has not paused it, and has not asked for less motion.
  const rotating = !paused && !held && visible && !reduced;

  const go = useCallback((next: number) => {
    setActive((next + SLIDES.length) % SLIDES.length);
  }, []);

  // Only rotate while the section is actually on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!rotating) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % SLIDES.length), DWELL);
    return () => window.clearInterval(id);
  }, [rotating, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowRight: active + 1,
      ArrowUp: active - 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: SLIDES.length - 1,
    };
    const next = map[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const idx = (next + SLIDES.length) % SLIDES.length;
    setActive(idx);
    tabRefs.current[idx]?.focus();
  };

  return (
    <div
      className={styles.showcase}
      ref={rootRef}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div>
        <div className={styles.tabs} role="tablist" aria-orientation="vertical" aria-label="App screens" onKeyDown={onKeyDown}>
          {SLIDES.map((s, i) => {
            const Ico = s.icon;
            const on = i === active;
            return (
              <button
                key={s.title}
                type="button"
                role="tab"
                id={`${baseId}-tab-${i}`}
                aria-selected={on}
                aria-controls={`${baseId}-panel-${i}`}
                tabIndex={on ? 0 : -1}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                className={`${styles.tab} ${on ? styles.tabActive : ''}`}
                onClick={() => go(i)}
              >
                <span className={styles.tabIcon}>
                  <Ico />
                </span>
                <span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </span>
                {on && rotating ? (
                  <span className={styles.tabProgress}>
                    <span
                      className={styles.tabProgressFill}
                      key={active}
                      style={{ animationDuration: `${DWELL}ms` }}
                    />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className={styles.carouselControls}>
          <button type="button" className={styles.iconBtn} onClick={() => go(active - 1)} aria-label="Previous screen">
            <ChevronLeft />
          </button>
          <button type="button" className={styles.iconBtn} onClick={() => go(active + 1)} aria-label="Next screen">
            <ChevronRight />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setPaused((v) => !v)}
            disabled={reduced}
            aria-label={
              reduced
                ? 'Automatic rotation is off because your system asks for reduced motion'
                : paused
                  ? 'Resume automatic rotation'
                  : 'Pause automatic rotation'
            }
          >
            {paused || reduced ? <Play /> : <Pause />}
          </button>
          <span className={styles.carouselStatus} aria-live="polite">
            {active + 1} of {SLIDES.length} — {SLIDES[active].title}
          </span>
        </div>
      </div>

      <div className={styles.showcaseStage}>
        <span className={styles.showcaseGlow} aria-hidden="true" />
        {SLIDES.map((s, i) => (
          <div
            key={s.src}
            id={`${baseId}-panel-${i}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${i}`}
            inert={i !== active ? true : undefined}
            className={`${styles.showcaseSlide} ${i === active ? styles.slideIn : styles.slideOut}`}
          >
            <div className={styles.phone}>
              <span className={styles.notch} aria-hidden="true" />
              <div className={styles.phoneScreen}>
                <Image
                  src={s.src}
                  alt={s.alt}
                  width={1080}
                  height={1920}
                  sizes="(max-width: 900px) 70vw, 300px"
                  priority={i === 0}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
