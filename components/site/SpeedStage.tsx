'use client';

import { useEffect, useRef, useState } from 'react';

import { Supercar } from './Supercar';
import { useReducedMotion } from './useReducedMotion';
import styles from './speedstage.module.css';

/**
 * Scroll-Triggered Storytelling: one pinned stage, three chapters, and a car
 * that accelerates as you scroll.
 *
 * Two things drive the speed, which is what makes it feel alive rather than
 * scrubbed: how far through the section you are (the gear you are in) and how
 * hard you are currently scrolling (the throttle). Let go and it coasts back
 * down.
 *
 * Every frame writes custom properties on ONE element — the stage — and CSS
 * distributes them to the car, the streaks and the road. That keeps a frame at
 * a single style write instead of a dozen React re-renders.
 */

const CHAPTERS = [
  {
    gear: 'Chapter 01',
    title: 'You name the fare',
    body: 'Set your pickup, set where you are going, and offer what the ride is worth to you. Drivers nearby see it the moment you send it.',
    metric: 'Cash, wallet or promo — decided before you book',
  },
  {
    gear: 'Chapter 02',
    title: 'Split it with the city',
    body: 'Going the same way as someone else? Pool the ride and the fare splits with you. Two riders pay 60% each. Four pay 35%.',
    metric: 'Up to 65% off a solo fare',
  },
  {
    gear: 'Chapter 03',
    title: 'Arrive, tracked the whole way',
    body: 'Live map, verified driver, two-way ratings and an SOS button that reaches a real safety desk — not a form.',
    metric: 'SOS and route-deviation alerts, 24/7',
  },
];

const MAX_KMH = 340;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function SpeedStage() {
  const stageRef = useRef<HTMLElement | null>(null);
  const kmhRef = useRef<HTMLSpanElement | null>(null);
  const gearRef = useRef<HTMLSpanElement | null>(null);
  const [chapter, setChapter] = useState(0);
  const still = useReducedMotion();

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // No scrub, no pin, no rAF loop: the CSS lays the section out as a plain
    // column and the car simply sits there at a fixed pace.
    if (still) {
      stage.style.setProperty('--spd', '0.6');
      return;
    }

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    let frame = 0;
    let lastY = window.scrollY;
    let lastT = performance.now();
    let throttle = 0; // smoothed scroll energy, 0→1
    let spin = 0; // accumulated wheel rotation, degrees
    let streak = 0; // 0→33.33, one tile of the streak field
    let road = 0; // road dash offset, px
    let shownChapter = -1;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);

      // Frame-rate independent: everything below is scaled by `steps`, the
      // number of 60fps frames this frame represents.
      const steps = clamp((now - lastT) / 16.667, 0, 4);
      lastT = now;

      const y = window.scrollY;
      const energy = clamp(Math.abs(y - lastY) / 46, 0, 1);
      lastY = y;
      // Attack fast, release slow — the car surges when you flick the wheel and
      // coasts when you stop, instead of snapping to zero.
      const k = energy > throttle ? 0.28 : 0.045;
      throttle += (energy - throttle) * k * steps;

      const rect = stage.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? clamp(-rect.top / travel, 0, 1) : 0;

      // Base pace ramps with progress; the throttle rides on top of it.
      const base = p * p * (3 - 2 * p); // smoothstep
      const spd = clamp(base * 0.66 + throttle * 0.5, 0, 1);

      spin += spd * 30 * steps;
      streak = (streak + (0.25 + spd * 2.6) * steps) % (100 / 3);
      road = (road + (2 + spd * 26) * steps) % 160;

      stage.style.setProperty('--p', p.toFixed(4));
      stage.style.setProperty('--spd', spd.toFixed(4));
      stage.style.setProperty('--spin', `${spin.toFixed(1)}deg`);
      stage.style.setProperty('--blur', clamp(spd * 1.5 - 0.15, 0, 1).toFixed(3));
      stage.style.setProperty('--heat', clamp(throttle * 1.4, 0, 1).toFixed(3));
      stage.style.setProperty('--streak', streak.toFixed(3));
      stage.style.setProperty('--road', road.toFixed(1));

      if (kmhRef.current) kmhRef.current.textContent = String(Math.round(spd * MAX_KMH));
      if (gearRef.current) gearRef.current.textContent = String(Math.min(7, 1 + Math.floor(spd * 7)));

      const next = p >= 0.66 ? 2 : p >= 0.33 ? 1 : 0;
      if (next !== shownChapter) {
        shownChapter = next;
        setChapter(next);
      }
    };

    // Coarse pointers get a shorter section and a calmer field of streaks; the
    // CSS handles the visual half, this just keeps the loop honest.
    if (coarse) stage.dataset.coarse = 'true';

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still]);

  return (
    <section ref={stageRef} className={styles.stage} aria-labelledby="speed-heading">
      <div className={styles.sticky}>
        <div className={styles.sky} aria-hidden="true" />
        <div className={styles.skyline} aria-hidden="true" />

        <div className={styles.streakField} aria-hidden="true">
          {[0, 1, 2].map((tile) => (
            <div className={styles.streakTile} key={tile} style={{ left: `${tile * 33.3333}%` }}>
              {STREAKS.map((s, i) => (
                <span
                  key={i}
                  className={styles.streak}
                  style={{ top: `${s.top}%`, left: `${s.left}%`, width: s.w, opacity: s.o }}
                />
              ))}
            </div>
          ))}
        </div>

        <div className={styles.road} aria-hidden="true">
          <div className={styles.roadDashes} />
          <div className={styles.roadEdge} />
        </div>

        <div className={styles.carWrap}>
          <div className={styles.carGhost} aria-hidden="true" />
          <Supercar className={styles.car} />
        </div>

        <div className={styles.hud} aria-hidden="true">
          <Gauge />
          <div className={styles.gearBox}>
            <span className={styles.gearLabel}>Gear</span>
            <span className={styles.gearValue} ref={gearRef}>
              1
            </span>
          </div>
          <div className={styles.kmhBox}>
            <span className={styles.kmh} ref={kmhRef}>
              0
            </span>
            <span className={styles.kmhUnit}>km/h</span>
          </div>
        </div>

        <div className={styles.copy}>
          <h2 id="speed-heading" className={styles.stageHeading}>
            Three taps from <span>here</span> to <span>there</span>
          </h2>

          <div className={styles.chapters}>
            {CHAPTERS.map((c, i) => (
              <article
                key={c.title}
                className={`${styles.chapter} ${still || i === chapter ? styles.chapterOn : ''}`}
              >
                <span className={styles.chapterTag}>{c.gear}</span>
                <h3 className={styles.chapterTitle}>{c.title}</h3>
                <p className={styles.chapterBody}>{c.body}</p>
                <p className={styles.chapterMetric}>{c.metric}</p>
              </article>
            ))}
          </div>

          <div className={styles.rail} aria-hidden="true">
            {CHAPTERS.map((c, i) => (
              <span
                key={c.title}
                className={`${styles.railDot} ${still || i <= chapter ? styles.railDotOn : ''}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Circular speedometer: a 270° sweep with a needle driven by --spd. */
function Gauge() {
  const ticks = Array.from({ length: 28 }, (_, i) => i);
  return (
    <svg className={styles.gauge} viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="92" className={styles.gaugeFace} />
      <path
        d="M 35.1 164.9 A 92 92 0 1 1 164.9 164.9"
        className={styles.gaugeTrack}
        pathLength={100}
      />
      <path
        d="M 35.1 164.9 A 92 92 0 1 1 164.9 164.9"
        className={styles.gaugeFill}
        pathLength={100}
      />
      {ticks.map((i) => {
        const angle = -225 + (i * 270) / 27;
        const long = i % 3 === 0;
        return (
          <line
            key={i}
            x1="100"
            y1={long ? 22 : 26}
            x2="100"
            y2="32"
            className={long ? styles.tickLong : styles.tick}
            transform={`rotate(${angle + 90} 100 100)`}
          />
        );
      })}
      <g className={styles.needle}>
        <path d="M 100 100 L 96 96 L 100 30 L 104 96 Z" />
      </g>
      <circle cx="100" cy="100" r="11" className={styles.gaugeHub} />
      <circle cx="100" cy="100" r="4" className={styles.gaugePin} />
    </svg>
  );
}

/** Pre-computed streak layout — deterministic so server and client agree. */
const STREAKS = [
  { top: 16, left: 4, w: 130, o: 0.5 },
  { top: 26, left: 42, w: 190, o: 0.34 },
  { top: 33, left: 12, w: 90, o: 0.6 },
  { top: 44, left: 66, w: 150, o: 0.3 },
  { top: 51, left: 24, w: 220, o: 0.45 },
  { top: 58, left: 80, w: 110, o: 0.5 },
  { top: 64, left: 6, w: 170, o: 0.28 },
  { top: 71, left: 52, w: 130, o: 0.42 },
  { top: 78, left: 30, w: 200, o: 0.36 },
  { top: 84, left: 72, w: 100, o: 0.5 },
  { top: 21, left: 86, w: 120, o: 0.26 },
  { top: 38, left: 92, w: 160, o: 0.32 },
];
