'use client';

/**
 * The homepage hero: two films, one per slide — Velocity Rides (a shared ride
 * booked, the driver arriving, a second rider joining on the way) and Velocity
 * Studio (a shop whose AI team researches, plans, posts, advertises and sells).
 *
 * The films carry the feeling; the cards beside them carry the facts, lit in
 * step with the film's own clock (`beats`), so what is said is what is on
 * screen. The copy is rendered on the server and passed in, so the H1 and every
 * word are in the HTML for crawlers and for anyone without JavaScript.
 *
 * Motion can always be stopped: a film plays once and hands over to the next,
 * the pause button stops both (WCAG 2.2.2), and a visitor who asked for reduced
 * motion — or is saving data — gets the posters with every card lit, and no
 * video is downloaded at all.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { hush, say, useAtMiddle } from './siteSound';
import { useReducedMotion, useSaveData } from './useReducedMotion';
import styles from './hero.module.css';

export interface HeroBeat {
  /** Seconds into the film when this card lights. */
  at: number;
  icon: string;
  title: string;
  detail: string;
}

export interface HeroSlide {
  key: string;
  tab: string;
  sub: string;
  film: { large: string; small: string; poster: string; label: string };
  beats: HeroBeat[];
  copy: ReactNode;
  /** Narration for the (silent) film, read while the slide shows — shorter than the film, or the next slide cuts it. */
  voice?: string;
}

export function HeroSlider({ slides }: { slides: HeroSlide[] }) {
  const reduced = useReducedMotion();
  const saveData = useSaveData();
  const still = reduced || saveData;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Seconds into the shown film, and the share of it played. */
  const [clock, setClock] = useState({ t: 0, share: 0 });
  const films = useRef<(HTMLVideoElement | null)[]>([]);
  const hero = useRef<HTMLElement>(null);
  const running = !still && !paused;
  const inView = useAtMiddle(hero);

  // The shown slide's narration, while the hero holds the middle of the screen and the films are not paused.
  const line = slides[index].voice;
  useEffect(() => {
    if (!line || !inView || paused) return;
    say('hero', line);
    return () => hush('hero');
  }, [line, inView, paused]);

  // Only the shown film plays; the other one waits.
  useEffect(() => {
    films.current.forEach((film, i) => {
      if (!film) return;
      if (i === index && running) void film.play().catch(() => undefined);
      else film.pause();
    });
  }, [index, running]);

  const show = useCallback((i: number) => {
    const film = films.current[i];
    if (film) film.currentTime = 0;
    setClock({ t: 0, share: 0 });
    setIndex(i);
  }, []);

  return (
    <section
      ref={hero}
      className={styles.hero}
      aria-roledescription="carousel"
      aria-label="Velocity Rides and Velocity Studio"
    >
      <div className={styles.stage}>
        {slides.map((s, i) => {
          const on = i === index;
          const t = on ? clock.t : 0;
          return (
            <div
              key={s.key}
              id={`hero-${s.key}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${slides.length}: ${s.tab}`}
              aria-hidden={!on}
              inert={!on}
              className={`${styles.slide} ${on ? styles.on : ''}`}
            >
              <div className={styles.film}>
                <video
                  ref={(el) => {
                    films.current[i] = el;
                  }}
                  className={styles.video}
                  muted
                  playsInline
                  // Nothing is fetched for a still visitor, or for the slide not shown yet.
                  preload={on && !still ? 'auto' : 'none'}
                  poster={s.film.poster}
                  aria-label={s.film.label}
                  onTimeUpdate={(e) => {
                    if (!on) return;
                    const v = e.currentTarget;
                    setClock({ t: v.currentTime, share: v.duration ? v.currentTime / v.duration : 0 });
                  }}
                  onEnded={() => on && show((i + 1) % slides.length)}
                >
                  <source src={s.film.small} type="video/mp4" media="(max-width: 760px)" />
                  <source src={s.film.large} type="video/mp4" />
                </video>
                <span className={styles.scrim} aria-hidden />
              </div>

              <div className={styles.content}>
                <div className={styles.copy}>{s.copy}</div>
                <ol className={styles.beats}>
                  {s.beats.map((b, j) => {
                    const lit = still || t >= b.at;
                    const now = !still && lit && (j === s.beats.length - 1 || t < s.beats[j + 1].at);
                    return (
                      <li key={b.title} className={`${styles.beat} ${lit ? styles.lit : ''} ${now ? styles.now : ''}`}>
                        <span className={styles.beatIcon} aria-hidden>
                          {b.icon}
                        </span>
                        <span className={styles.beatText}>
                          <b>{b.title}</b>
                          <span>{b.detail}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label="Choose a story">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-controls={`hero-${s.key}`}
              className={`${styles.tab} ${i === index ? styles.tabOn : ''}`}
              onClick={() => show(i)}
            >
              <span className={styles.tabTitle}>{s.tab}</span>
              <span className={styles.tabSub}>{s.sub}</span>
              <span className={styles.tabBar} aria-hidden>
                <span style={{ transform: `scaleX(${i === index ? (still ? 1 : clock.share) : 0})` }} />
              </span>
            </button>
          ))}
        </div>
        {still ? null : (
          <button
            type="button"
            className={styles.pause}
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Play the films' : 'Pause the films'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              {paused ? <path d="M8 5v14l11-7z" /> : <path d="M7 5h4v14H7zM13 5h4v14h-4z" />}
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}
