'use client';

/**
 * Velocity Studio's three plans as cards, each topped with a short looping film
 * of that team at work, under a Monthly / Yearly switch. Yearly is twelve months
 * less 3% (`studioPriceUsd`) — the same figure the Billing page asks for.
 *
 * Each card rises in the first time it is seen, and its film plays only while
 * the card is on screen. With reduced motion or Data Saver the films show their
 * posters and download nothing. Flipping the switch runs the figures to their
 * new values; hovering a card brings it to the middle and grows it (CSS, on the
 * fixed slot each card sits in), and leaving puts every card back. While a card
 * is hovered or tapped, the rest of the page blurs behind it.
 *
 * Tap a card, or its "Hear Vexa" button, and Vexa says what she does on that
 * plan (Assistant.tsx).
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  STUDIO_PLANS,
  STUDIO_YEAR_DISCOUNT_PCT,
  studioPriceUsd,
  studioUsd,
  type StudioBilling,
  type StudioPlanId,
} from '@/lib/studio';
import { PlanAsk, planVoice, useVexa } from './Assistant';
import { ArrowRight } from './Icons';
import { PlanJobs } from './PlanJobs';
import { usePriceRaised } from './priceClock';
import { hush } from './siteSound';
import { useReducedMotion, useSaveData } from './useReducedMotion';
import site from './site.module.css';
import styles from './pricing.module.css';

/** `src` is the film without its extension: `.mp4` plays, `.jpg` is its poster. */
const FILMS: Record<StudioPlanId, { src: string; chip: string; alt: string }> = {
  // The ads-only plan is no longer sold, so its film of charts and a winning ad shows the research plan's testing.
  research: {
    src: '/site/plan-ads',
    chip: 'Testing before you spend',
    alt: 'An ads dashboard whose charts climb while the winning ad glows and a losing one sits paused',
  },
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

/** The whole-team plan in the middle. Only this section's order: billing and sign-up keep STUDIO_PLAN_IDS. */
const CARD_ORDER: StudioPlanId[] = ['research', 'all', 'content'];

/** `how` is null once the card has let go: it stays above the blur while the blur fades. */
type Focus = { id: StudioPlanId; how: 'hover' | 'tap' | null };
const letGo = (f: Focus | null): Focus | null => f && { ...f, how: null };

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
  return <>{studioUsd(Number.isInteger(to) ? Math.round(v) : v)}</>;
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
  const raised = usePriceRaised();
  const [seen, setSeen] = useState(() => CARD_ORDER.map(() => false));
  const cards = useRef<(HTMLElement | null)[]>([]);
  const films = useRef<(HTMLVideoElement | null)[]>([]);
  const { speak } = useVexa();
  const [focus, setFocus] = useState<Focus | null>(null);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.i);
          if (e.isIntersecting) setSeen((s) => (s[i] ? s : s.map((v, j) => v || j === i)));
          // The card scrolled away: its assistant stops talking and the page comes back.
          else {
            hush(planVoice(CARD_ORDER[i]));
            setFocus((f) => (f?.id === CARD_ORDER[i] ? letGo(f) : f));
          }
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
        {CARD_ORDER.map((id, i) => {
          const p = STUDIO_PLANS[id];
          const best = id === 'all';
          const month = studioPriceUsd(id, 'month', raised);
          const year = studioPriceUsd(id, 'year', raised);
          const twelve = month * 12;
          return (
            <div
              key={id}
              className={`${styles.slot} ${focus?.id === id ? styles.focused : ''}`}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') setFocus({ id, how: 'hover' });
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') setFocus(letGo);
              }}
            >
              <article
                ref={(el) => {
                  cards.current[i] = el;
                }}
                data-i={i}
                className={`${styles.card} ${best ? styles.best : ''} ${seen[i] ? styles.seen : ''}`}
                style={{ ['--i' as string]: i }}
                onPointerMove={glow}
                // A tap anywhere on the card but its links and buttons: Vexa says what she does on this plan.
                onClick={(e) => {
                  setFocus((f) => (f?.id === id && f.how ? f : { id, how: 'tap' }));
                  if (!(e.target as Element).closest('a, button')) speak(planVoice(id), e);
                }}
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
                  <PlanAsk plan={id} />
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
                        <Count to={studioPriceUsd(id, billing, raised)} />
                      </strong>
                      <small key={billing}>/{billing}</small>
                    </div>
                    <p key={`save-${billing}`} className={styles.save}>
                      {billing === 'year' ? (
                        <>
                          <s>${twelve}</s> <Count from={month} to={year / 12} /> a month ·{' '}
                          <mark>
                            you save <Count from={0} to={twelve - year} />
                          </mark>
                        </>
                      ) : (
                        <>
                          or {studioUsd(year)} a year — save {studioUsd(twelve - year)}
                        </>
                      )}
                    </p>
                  </div>
                  <p className={styles.tagline}>{p.tagline}</p>
                  <PlanJobs plan={id} lines={p.includes} className={styles.list} />
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
      <div className={styles.scrim} data-focus={focus?.how ?? undefined} aria-hidden onClick={() => setFocus(letGo)} />
    </>
  );
}
