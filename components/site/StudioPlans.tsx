'use client';

/**
 * Velocity Studio's three plans as cards, each topped with a short looping film
 * of that team at work, under a Monthly / Yearly switch. Yearly is twelve months
 * less 13% (`studioPriceUsd`) — the same figure the Billing page asks for.
 *
 * Each card rises in the first time it is seen, and its film plays only while
 * the card is on screen. With reduced motion or Data Saver the films show their
 * posters and download nothing. Flipping the switch runs the figures to their
 * new values; hovering a card brings it to the middle and grows it (CSS, on the
 * fixed slot each card sits in), and leaving puts every card back.
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

/** `src` is the film without its extension: `.mp4` plays, `.jpg` is its poster. */
const FILMS: Record<StudioPlanId, { src: string; chip: string; alt: string }> = {
  sales: {
    src: '/site/step5',
    chip: 'Closing your leads',
    alt: 'The owner delivers a tall stack of pink boxes to an office manager, who shakes her hand',
  },
  content: {
    src: '/site/plan-content',
    chip: 'Posting for you',
    alt: 'A phone whose feed fills with a bakery’s new posts while likes and comments float up',
  },
  ads: {
    src: '/site/plan-ads',
    chip: 'Improving your ads',
    alt: 'An ads dashboard whose charts climb while the winning ad glows and a losing one sits paused',
  },
  all: {
    src: '/site/plan-all',
    chip: 'The whole team at work',
    alt: 'Posts, ad results and sales emails orbiting one glowing core',
  },
};

const dollars = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Runs a figure from where it stood to `to` in a fast ease-out, so flipping Monthly / Yearly reads as the price moving. */
function Count({ to, from = to }: { to: number; from?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(from);
  const at = useRef(from);

  useEffect(() => {
    if (reduced || at.current === to) return;
    const start = at.current;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function step(t) {
      const k = Math.min(1, (t - t0) / 650);
      at.current = start + (to - start) * (1 - (1 - k) ** 4);
      setShown(at.current);
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [to, reduced]);

  const v = reduced ? to : shown;
  return <>{dollars(Number.isInteger(to) ? Math.round(v) : v)}</>;
}

/** Tells the hovered card's glow where the mouse is. */
function glow(e: React.PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return;
  const card = e.currentTarget;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${e.clientX - r.left}px`);
  card.style.setProperty('--my', `${e.clientY - r.top}px`);
}

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
            <div key={id} className={styles.slot}>
              <article
                ref={(el) => {
                  cards.current[i] = el;
                }}
                data-i={i}
                className={`${styles.card} ${best ? styles.best : ''} ${seen[i] ? styles.seen : ''}`}
                style={{ ['--i' as string]: i }}
                onPointerMove={glow}
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
                    poster={`${FILMS[id].src}.jpg`}
                    aria-label={FILMS[id].alt}
                  >
                    <source src={`${FILMS[id].src}.mp4`} type="video/mp4" />
                  </video>
                  <span className={styles.live}>
                    <i aria-hidden />
                    {FILMS[id].chip}
                  </span>
                </div>

                <div className={styles.body}>
                  <h3>{p.name}</h3>
                  <div className={styles.priceBox}>
                    {/* Keyed on billing so the sweep, the unit and the line under it replay when the switch flips. */}
                    <span key={`sheen-${billing}`} className={styles.sheen} aria-hidden />
                    <div className={styles.price}>
                      <strong>
                        <Count to={studioPriceUsd(id, billing)} />
                      </strong>
                      <small key={billing}>/{billing}</small>
                    </div>
                    <p key={`save-${billing}`} className={styles.save}>
                      {billing === 'year' ? (
                        <>
                          <s>${twelve}</s> <Count from={p.usd} to={year / 12} /> a month ·{' '}
                          <mark>
                            you save <Count from={0} to={twelve - year} />
                          </mark>
                        </>
                      ) : (
                        <>
                          or ${year} a year — save ${twelve - year}
                        </>
                      )}
                    </p>
                  </div>
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
                    href={`/studio/signup?plan=${id}${billing === 'year' ? '&billing=year' : ''}`}
                    className={`${site.btn} ${best ? site.btnLime : site.btnGhost} ${styles.cta}`}
                  >
                    Start free <ArrowRight />
                  </Link>
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </>
  );
}
