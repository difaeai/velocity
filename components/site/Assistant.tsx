'use client';

/**
 * The Social Media Virtual Assistant introduces himself: the character on a
 * lit stage, the jobs he does floating round him, and — when tapped — his own
 * voice saying all of it, each job lighting up as he says it.
 *
 * The stage tilts toward a mouse pointer (a real CSS 3D scene: the halo sits
 * behind him, the jobs in front), so the character reads as standing in space.
 * Touch screens and reduced motion get the stage still. The voice goes through
 * the page's one voice (`siteSound`), so the header's mute and the other
 * parts' narration behave the same here.
 */

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

import { Sparkle } from './Icons';
import { hush, say, toggleMute, useAtMiddle, useSiteSound, voiceAt } from './siteSound';
import { useReducedMotion } from './useReducedMotion';
import site from './site.module.css';
import styles from './assistant.module.css';

const OWNER = 'assistant';
const VOICE = '/site/voice/assistant.mp3';

/** In the order he says them; `at` is when he starts saying each one in assistant.mp3 (Kokoro word timings). */
const JOBS = [
  { at: 3.9, icon: '📱', title: 'Manages your social media' },
  { at: 5.6, icon: '🔎', title: 'Analyses your competition' },
  { at: 7.9, icon: '✍️', title: 'Writes your content' },
  { at: 9.1, icon: '🎨', title: 'Creates your content' },
  { at: 9.85, icon: '🎬', title: 'Makes your videos' },
  { at: 11.9, icon: '📲', title: 'Posts for you' },
  { at: 13.2, icon: '📈', title: 'Manages your ads' },
  { at: 14.8, icon: '🤖', title: 'All on my own — no human intervention' },
];

export function Assistant() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const atMiddle = useAtMiddle(section);
  const still = useReducedMotion();
  const { owner, speaking, muted } = useSiteSound();
  const talking = owner === OWNER && speaking;
  const [reached, setReached] = useState(0);

  // While he talks, light every job he has reached. Same number → React skips the render.
  useEffect(() => {
    if (!talking) return;
    let raf = 0;
    const tick = () => {
      const t = voiceAt();
      setReached(JOBS.filter((j) => j.at <= t).length);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [talking]);

  // Scrolled away: he stops, like every other part of the page.
  useEffect(() => {
    if (!atMiddle) hush(OWNER);
  }, [atMiddle]);

  const tap = (e: MouseEvent) => {
    if (talking) return hush(OWNER);
    setReached(0);
    say(OWNER, VOICE);
    // Tapping him is asking to hear him, so it turns the page's sound back on.
    if (muted) toggleMute(e.timeStamp);
  };

  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el || still || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${(x * 14).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
  };
  const untilt = () => {
    stage.current?.style.setProperty('--ry', '0deg');
    stage.current?.style.setProperty('--rx', '0deg');
  };

  const job = (i: number) => {
    const j = JOBS[i];
    const lit = i < reached;
    const now = talking && i === reached - 1;
    return (
      <li
        key={j.title}
        className={`${styles.job} ${lit ? styles.lit : ''} ${now ? styles.now : ''} ${i === JOBS.length - 1 ? styles.own : ''}`}
        style={{ ['--i' as string]: i }}
      >
        <span className={styles.icon} aria-hidden>
          {j.icon}
        </span>
        {j.title}
      </li>
    );
  };

  return (
    <section ref={section} id="assistant" className={`${site.section} ${site.deep} ${styles.assistant}`}>
      <div className={site.wrap}>
        <div className={`${site.sectionHead} ${site.center}`}>
          <span className={site.eyebrow}>
            <Sparkle /> Meet your assistant
          </span>
          <h2 className={site.h2}>
            I’m your <em className={site.accent}>Social Media Virtual Assistant.</em>
          </h2>
        </div>

        <div ref={stage} className={styles.stage} onPointerMove={tilt} onPointerLeave={untilt}>
          <ul className={`${styles.jobs} ${styles.left}`}>{[0, 1, 2, 3].map(job)}</ul>

          <div className={styles.center}>
            <p className={styles.bubble}>Hi! I’m your Social Media Virtual Assistant. I do all of this myself.</p>
            <button
              type="button"
              className={`${styles.figure} ${talking ? styles.talking : ''}`}
              onClick={tap}
              aria-label={talking ? 'Stop the assistant' : 'Tap to hear the Social Media Virtual Assistant'}
            >
              <span className={styles.halo} aria-hidden />
              {/* A 36 KB cut-out with its own alpha: next/image would only re-encode it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={styles.person}
                src="/site/assistant.webp"
                alt="The Social Media Virtual Assistant: a man in a denim jacket, white T-shirt and black jeans"
                width={375}
                height={565}
                draggable={false}
              />
              <span className={styles.floor} aria-hidden />
              <span className={styles.cue}>
                {talking ? (
                  <>
                    <span className={styles.wave} aria-hidden>
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    Tap to stop
                  </>
                ) : (
                  <>
                    <span className={styles.play} aria-hidden />
                    Tap me to hear what I do
                  </>
                )}
              </span>
            </button>
          </div>

          <ul className={`${styles.jobs} ${styles.right}`}>{[4, 5, 6, 7].map(job)}</ul>
        </div>
      </div>
    </section>
  );
}
