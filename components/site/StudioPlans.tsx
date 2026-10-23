'use client';

/**
 * Velocity Studio's three plans as cards, each topped with a short looping film
 * of that team at work, under a Monthly / Yearly switch. Yearly is twelve months
 * less 13% (`studioPriceUsd`) — the same figure the Billing page asks for.
 *
 * Each card rises in the first time it is seen, and its film plays only while
 * the card is on screen. With reduced motion or Data Saver the films show their
 * posters and download nothing.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  STUDIO_PLAN_IDS,
  STUDIO_PLANS,
  STUDIO_YEAR_DISCOUNT_PCT,
  studioPriceUsd,
  type StudioBilling,
  type StudioPlanId,
} from '@/lib/studio';
import { ArrowRight, Check } from './Icons';
import { useReducedMotion, useSaveData } from './useReducedMotion';
import site from './site.module.css';
import styles from './pricing.module.css';

const FILMS: Record<StudioPlanId, { chip: string; alt: string }> = {
  content: {
    chip: 'Posting for you',
    alt: 'A phone whose feed fills with a bakery’s new posts while likes and comments float up',
  },
  ads: {
    chip: 'Improving your ads',
    alt: 'An ads dashboard whose charts climb while the winning ad glows and a losing one sits paused',
  },
  all: {
    chip: 'The whole team at work',
    alt: 'Posts, ad results and sales emails orbiting one glowing core',
  },
};

const dollars = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export function StudioPlans() {
  const reduced = useReducedMotion();
  const saveData = useSaveData();
  const still = reduced || saveData;
  const [billing, setBilling] = useState<StudioBilling>('month');
  const [seen, setSeen] = useState(() => STUDIO_PLAN_IDS.map(() => false));
  const cards = useRef<(HTMLElement | null)[]>([]);
  const films = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.i);
          if (e.isIntersecting) setSeen((s) => (s[i] ? s : s.map((v, j) => v || j === i)));
          const film = films.current[i];
          if (!film) continue;
          if (e.isIntersecting && !still) void film.play().catch(() => undefined);
          else film.pause();
        }
      },
      // Fires just before a card scrolls in, so its rise starts from below the fold.
      { rootMargin: '0px 0px 10% 0px' },
    );
    cards.current.forEach((c) => c && io.observe(c));
    return () => io.disconnect();
  }, [still]);

  return (
    <>
      <div className={styles.switch} role="radiogroup" aria-label="Billing" data-billing={billing}>
        <span className={styles.thumb} aria-hidden />
        {(['month', 'year'] as const).map((b) => (
          <button key={b} type="button" role="radio" aria-checked={billing === b} onClick={() => setBilling(b)}>
            {b === 'month' ? 'Monthly' : 'Yearly'}
            {b === 'year' ? <em>Save {STUDIO_YEAR_DISCOUNT_PCT}%</em> : null}
          </button>
        ))}
      </div>

      <div className={styles.plans}>
        {STUDIO_PLAN_IDS.map((id, i) => {
          const p = STUDIO_PLANS[id];
          const best = id === 'all';
          const year = studioPriceUsd(id, 'year');
          const twelve = p.usd * 12;
          return (
            <article
              key={id}
              ref={(el) => {
                cards.current[i] = el;
              }}
              data-i={i}
              className={`${styles.card} ${best ? styles.best : ''} ${seen[i] ? styles.seen : ''}`}
              style={{ ['--i' as string]: i }}
            >
              {best ? <span className={styles.tag}>The whole team</span> : null}
              <div className={styles.film}>
                <video
                  ref={(el) => {
                    films.current[i] = el;
                  }}
                  muted
                  playsInline
                  loop
                  preload={still ? 'none' : 'metadata'}
                  poster={`/site/plan-${id}.jpg`}
                  aria-label={FILMS[id].alt}
                >
                  <source src={`/site/plan-${id}.mp4`} type="video/mp4" />
                </video>
                <span className={styles.live}>
                  <i aria-hidden />
                  {FILMS[id].chip}
                </span>
              </div>

              <div className={styles.body}>
                <h3>{p.name}</h3>
                {/* Keyed on billing so the figure replays its entrance when the switch flips. */}
                <div key={billing} className={styles.price}>
                  <strong>${studioPriceUsd(id, billing)}</strong>
                  <small>/{billing}</small>
                </div>
                <p className={styles.save}>
                  {billing === 'year' ? (
                    <>
                      <s>${twelve}</s> {dollars(year / 12)} a month · <mark>you save ${twelve - year}</mark>
                    </>
                  ) : (
                    <>
                      or ${year} a year — save ${twelve - year}
                    </>
                  )}
                </p>
                <p className={styles.tagline}>{p.tagline}</p>
                <ul className={styles.list}>
                  {p.includes.map((line, j) => (
                    <li key={line} style={{ ['--j' as string]: j }}>
                      <Check />
                      {line}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/studio/start?plan=${id}${billing === 'year' ? '&billing=year' : ''}`}
                  className={`${site.btn} ${best ? site.btnLime : site.btnGhost} ${styles.cta}`}
                >
                  Start free <ArrowRight />
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
