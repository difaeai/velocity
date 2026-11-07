'use client';

/**
 * The Social Media Virtual Assistant, at the head of the pricing section: who
 * he is and the jobs he does on one side, and him on the other, standing behind
 * the three plan cards as if handing them over.
 *
 * Tap him (or the button in his speech bubble) and he says what he does, each
 * job lighting up as he reaches it. His figure turns a few degrees toward a
 * mouse pointer (CSS 3D); touch screens and reduced motion get him still. The
 * voice goes through the page's one voice (`siteSound`), so the header's mute,
 * scrolling away and the other parts' narration behave the same here.
 */

import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { hush, say, toggleMute, useAtMiddle, useSiteSound, voiceAt } from './siteSound';
import { useReducedMotion } from './useReducedMotion';
import site from './site.module.css';
import styles from './assistant.module.css';
import { STUDIO_YEAR_DISCOUNT_PCT } from '@/lib/studio';

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
  const head = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const atMiddle = useAtMiddle(head);
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

  const tap = (at: number) => {
    if (talking) return hush(OWNER);
    setReached(0);
    say(OWNER, VOICE);
    // Tapping him is asking to hear him, so it turns the page's sound back on.
    if (muted) toggleMute(at);
  };

  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el || still || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 16).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${((0.5 - (e.clientY - r.top) / r.height) * 8).toFixed(2)}deg`);
  };
  const untilt = () => {
    stage.current?.style.setProperty('--ry', '0deg');
    stage.current?.style.setProperty('--rx', '0deg');
  };

  return (
    <div ref={head} className={styles.head}>
      <div className={styles.text}>
        <span className={site.eyebrow}>Pricing</span>
        <h2 className={site.h2}>
          I’m your <em className={styles.name}>Social Media Virtual Assistant.</em>
        </h2>
        <p className={site.lead}>
          Pick how much of your social media I take on. Every plan starts with a free day — pay monthly and stop any
          time, or pay for a year and save {STUDIO_YEAR_DISCOUNT_PCT}%.
        </p>
      </div>

      <ul className={styles.jobs} aria-label="What I do">
        {JOBS.map((j, i) => (
          <li
            key={j.title}
            className={`${styles.job} ${i < reached ? styles.lit : ''} ${talking && i === reached - 1 ? styles.now : ''} ${
              i === JOBS.length - 1 ? styles.own : ''
            }`}
          >
            <span className={styles.icon} aria-hidden>
              {j.icon}
            </span>
            {j.title}
          </li>
        ))}
      </ul>

      <div ref={stage} className={styles.stage} onPointerMove={tilt} onPointerLeave={untilt}>
        <div className={styles.bubble}>
          <p>Hi! I’m your Social Media Virtual Assistant. I do all of this myself.</p>
          <button type="button" className={styles.cue} onClick={(e) => tap(e.timeStamp)} aria-pressed={talking}>
            {talking ? (
              <>
                <span className={styles.wave} aria-hidden>
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                Stop
              </>
            ) : (
              <>
                <span className={styles.play} aria-hidden />
                Tap me to hear what I do
              </>
            )}
          </button>
        </div>
        {/* The figure answers a tap too; the bubble's button is the control for keyboards and screen readers. */}
        <div className={`${styles.figure} ${talking ? styles.talking : ''}`} onClick={(e) => tap(e.timeStamp)} aria-hidden>
          <span className={styles.halo} />
          {/* An 89 KB cut-out with its own alpha: next/image would only re-encode it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.person} src="/site/assistant.webp" alt="" width={806} height={1240} draggable={false} />
        </div>
      </div>
    </div>
  );
}
