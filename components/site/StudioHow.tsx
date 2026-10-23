'use client';

/**
 * How Velocity Studio works, told as five short films that play as you scroll
 * to them — the same five steps a new workspace actually runs (the launch
 * sequence in the console): market analysis, content, posting, the funnel and
 * the Meta Ad Expert, and closing the leads.
 *
 * Only the step in the middle of the screen plays; the rest wait, so at most
 * one film is ever downloading. A rail fills with the reader's progress. With
 * reduced motion, nothing plays and every step shows its poster, fully lit.
 */

import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from './useReducedMotion';
import styles from './studioHome.module.css';

export interface StudioStep {
  key: string;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  chipLabel: string;
  chip: string;
  film: string;
  poster: string;
  alt: string;
}

export function StudioHow({ steps }: { steps: StudioStep[] }) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [fill, setFill] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const films = useRef<(HTMLVideoElement | null)[]>([]);

  // The step crossing the middle band of the screen is the one in view.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    rows.current.forEach((row) => row && io.observe(row));
    return () => io.disconnect();
  }, []);

  // The rail fills with how far the middle of the screen is through the steps.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = list.current?.getBoundingClientRect();
        if (box) setFill(Math.min(100, Math.max(0, ((window.innerHeight / 2 - box.top) / box.height) * 100)));
      });
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Only the film in view plays.
  useEffect(() => {
    films.current.forEach((film, i) => {
      if (!film) return;
      if (i === active && !reduced) void film.play().catch(() => undefined);
      else film.pause();
    });
  }, [active, reduced]);

  return (
    <div ref={list} className={styles.steps} style={{ ['--fill' as string]: `${reduced ? 100 : fill}%` }}>
      <span className={styles.rail} aria-hidden>
        <span />
      </span>
      {steps.map((s, i) => {
        const state = reduced || i < active ? styles.past : i === active ? styles.active : '';
        return (
          <div
            key={s.key}
            ref={(el) => {
              rows.current[i] = el;
            }}
            data-i={i}
            className={`${styles.step} ${i % 2 ? styles.flip : ''} ${state}`}
          >
            <span className={styles.dot} aria-hidden>
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className={styles.film}>
              <video
                ref={(el) => {
                  films.current[i] = el;
                }}
                muted
                playsInline
                loop
                preload={reduced ? 'none' : 'metadata'}
                poster={s.poster}
                aria-label={s.alt}
              >
                <source src={s.film} type="video/mp4" />
              </video>
              <span className={styles.chip}>
                <b>{s.chipLabel}</b>
                {s.chip}
              </span>
            </div>
            <div className={styles.text}>
              <span className={styles.kicker}>{s.kicker}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <ul className={styles.points}>
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
