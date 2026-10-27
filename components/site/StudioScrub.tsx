'use client';

/**
 * Velocity AI Studio, told by scrolling: one pinned film that plays as far as
 * the reader has scrolled, forwards and backwards, and a chapter beside it for
 * each job the team does — lit when the film reaches that scene.
 *
 * The film is one continuous camera move (a closed shop at night, into the
 * laptop, through the market map, the calendar, the phones and the ad chart,
 * the emails flying out, and back out into a full shop), encoded with a
 * keyframe every half second so seeking stays smooth. The chapter times below
 * are where those scenes sit in it.
 *
 * Every frame writes one custom property (`--t`) and the timecode text; React
 * re-renders only when the chapter changes. The loop runs only while the
 * section is near the screen. Reduced motion or a data saver gets the poster
 * and every chapter as a plain list, and no film is downloaded.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ArrowRight } from './Icons';
import { hush, say, useAtMiddle } from './siteSound';
import { useReducedMotion } from './useReducedMotion';
import site from './site.module.css';
import styles from './studioScrub.module.css';
import { STUDIO_TRIAL_HOURS } from '@/lib/studio';

const FILM_SECONDS = 12;
/** The last stretch of scroll holds the final frame, so the closing chapter stays up to be read. */
const HOLD = 0.12;

const CHAPTERS = [
  {
    at: 0,
    label: 'Intro',
    voice: 'film-intro',
    kicker: 'After hours',
    title: 'The shop is closed. Your team isn’t.',
    body: 'Velocity AI Studio gives your business its own AI team. Every scene in this film is a job the team does for you.',
  },
  {
    at: 2.8,
    label: 'Market',
    voice: 'film-market',
    kicker: '01 · Reads your market',
    title: 'It reads your market first',
    body: 'Your notes and links, a live search of your market, and an audience test — a simulated panel of customers reacts to your offer before you spend a rupee.',
  },
  {
    at: 5,
    label: 'Content',
    voice: 'film-content',
    kicker: '02 · Makes the content',
    title: 'A month of content, made ahead',
    body: 'Thirty days planned and made — reels with voice-over and music, posts and stories — on a calendar you can change any day.',
  },
  {
    at: 6.8,
    label: 'Posts & ads',
    voice: 'film-posts',
    kicker: '03 · Posts and advertises',
    title: 'Posted at your time. Ads improved daily.',
    body: 'It posts to Instagram and Facebook at the hour you pick, and the Meta Ad Expert keeps the winners running and stops the losers, inside the daily limit you set.',
  },
  {
    at: 8.4,
    label: 'Leads',
    voice: 'film-leads',
    kicker: '04 · Closes the leads',
    title: 'Leads followed up, replies drafted',
    body: 'The sales agent writes to businesses that could buy from you, follows up twice, and has your answer drafted the moment someone replies.',
  },
  {
    at: 10,
    label: 'You',
    voice: 'film-you',
    kicker: '05 · And you',
    title: 'You run the shop. Your team does the rest.',
    body: `The first ${STUDIO_TRIAL_HOURS} hours are free, and the market analysis starts the minute you sign up. No card.`,
  },
];

const LAST = CHAPTERS.length - 1;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const chapterAt = (t: number) => CHAPTERS.reduce((n, c, i) => (t >= c.at ? i : n), 0);
const stamp = (t: number) => `00:${String(Math.floor(t)).padStart(2, '0')}`;

const never = () => () => {};
const savingData = () =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

export function StudioScrub() {
  const reduced = useReducedMotion();
  const saveData = useSyncExternalStore(never, savingData, () => false);
  const still = reduced || saveData;
  const [chapter, setChapter] = useState(0);
  const stageRef = useRef<HTMLElement | null>(null);
  const filmRef = useRef<HTMLVideoElement | null>(null);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const inView = useAtMiddle(stageRef);

  // Each chapter is read as the film reaches it, while the film holds the middle of the screen (the film is silent).
  // A chapter scrolled straight past says nothing: it speaks once it has held for a moment.
  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => say('film', `/site/voice/${CHAPTERS[chapter].voice}.mp3`), 400);
    return () => {
      clearTimeout(t);
      hush('film');
    };
  }, [chapter, inView]);

  useEffect(() => {
    const stage = stageRef.current;
    const film = filmRef.current;
    if (!stage || !film || still) return;

    let frame = 0;
    let eased = 0;
    let shown = -1;
    let primed = false;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const rect = stage.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? clamp(-rect.top / travel, 0, 1) : 0;
      const target = Math.min(1, p / (1 - HOLD)) * FILM_SECONDS;
      // Ease toward the scroll position rather than jump to it: a wheel moves in
      // steps, and seeking straight to each one makes the film stutter.
      eased += (target - eased) * 0.2;
      if (film.readyState >= 1 && !film.seeking && Math.abs(film.currentTime - eased) > 1 / 48) {
        film.currentTime = Math.min(eased, FILM_SECONDS - 0.05);
      }
      stage.style.setProperty('--t', (eased / FILM_SECONDS).toFixed(4));
      if (clockRef.current) clockRef.current.textContent = stamp(eased);
      const next = chapterAt(eased);
      if (next !== shown) {
        shown = next;
        setChapter(next);
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        cancelAnimationFrame(frame);
        frame = 0;
        if (!entry.isIntersecting) return;
        if (!primed) {
          primed = true;
          // Fetching starts here, half a screen early, not with the page. iOS
          // only paints a seek once the film has played, hence play-then-pause.
          film.preload = 'auto';
          void film
            .play()
            .then(() => film.pause())
            .catch(() => undefined);
        }
        frame = requestAnimationFrame(tick);
      },
      { rootMargin: '50% 0px' },
    );
    io.observe(stage);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [still]);

  // The timeline's chapter buttons scroll to where that scene plays.
  const jump = (i: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const travel = stage.offsetHeight - window.innerHeight;
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const share = i === LAST ? 1 : ((CHAPTERS[i].at + 0.4) / FILM_SECONDS) * (1 - HOLD);
    window.scrollTo({ top: top + travel * share, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section
      ref={stageRef}
      id="ai-studio"
      className={`${styles.stage} ${still ? styles.still : ''}`}
      aria-labelledby="ai-studio-heading"
    >
      <div className={styles.sticky}>
        <div className={styles.screen}>
          <video
            ref={filmRef}
            muted
            playsInline
            preload="none"
            poster="/site/aistudio.jpg"
            aria-label="A closed bakery at night: the camera moves into the laptop on the counter, through a green studio where a market map, a content calendar, phones with likes and a rising ad chart assemble, past emails flying out, and back out into the same bakery in the morning, full of customers."
          >
            <source src="/site/aistudio-sm.mp4" type="video/mp4" media="(max-width: 760px)" />
            <source src="/site/aistudio.mp4" type="video/mp4" />
          </video>
          <span className={styles.scrim} aria-hidden />
        </div>

        <div className={`${site.wrap} ${styles.panel}`}>
          <header className={styles.head}>
            <span className={styles.kickerTop}>An AI team for your business</span>
            <h2 id="ai-studio-heading" className={styles.title}>
              Velocity <span className={site.accent}>AI</span> Studio
            </h2>
          </header>

          <div className={styles.chapters}>
            {CHAPTERS.map((c, i) => (
              <div
                key={c.label}
                className={`${styles.chapter} ${i === chapter ? styles.on : i < chapter ? styles.past : ''}`}
                // A keyboard user tabbing to the closing buttons is carried to the scene they belong to.
                onFocus={i === LAST && !still && chapter !== LAST ? () => jump(LAST) : undefined}
              >
                <span className={styles.kicker}>{c.kicker}</span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                {i === LAST ? (
                  <div className={styles.actions}>
                    <Link href="/studio/signup" className={`${site.btn} ${site.btnLime}`}>
                      Start free for {STUDIO_TRIAL_HOURS} hours <ArrowRight />
                    </Link>
                    <a href="#how-it-works" className={`${site.btn} ${site.btnGhost}`}>
                      See the five steps
                    </a>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <span className={styles.cue} aria-hidden>
          Scroll to play
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>

        <div className={`${site.wrap} ${styles.timeline}`}>
          <span className={styles.clock} aria-hidden>
            <span ref={clockRef}>00:00</span> / {stamp(FILM_SECONDS)}
          </span>
          <div className={styles.track}>
            <span className={styles.fill} aria-hidden />
            <ol aria-label="Scenes">
              {CHAPTERS.map((c, i) => (
                <li key={c.label} style={{ flexGrow: (CHAPTERS[i + 1]?.at ?? FILM_SECONDS) - c.at }}>
                  <button
                    type="button"
                    className={`${styles.mark} ${i === chapter ? styles.markOn : ''}`}
                    aria-current={i === chapter ? 'step' : undefined}
                    onClick={() => jump(i)}
                  >
                    {c.label}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
