'use client';

/**
 * Velocity Studio → Plans. The three plans side by side, a month or a year,
 * and credits underneath for anyone who wants more days without a new month.
 * Every button goes to the checkout (`billing`) with its choice in the URL;
 * nothing is paid here.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useWorkspace } from '@/lib/workspace';
import {
  STUDIO_CREDIT_DAY_USD,
  STUDIO_CREDIT_PACKS,
  STUDIO_PLAN_IDS,
  STUDIO_PLANS,
  STUDIO_YEAR_DISCOUNT_PCT,
  studioPriceUsd,
  type StudioBilling,
  type StudioPlanId,
} from '@/lib/studio';
import a from '../account.module.css';

const ICON: Record<StudioPlanId, string> = { sales: '🤝', content: '🎬', ads: '📈', all: '🚀' };

export default function UpgradePage() {
  const { ws } = useWorkspace();
  const [billing, setBilling] = useState<StudioBilling>('month');
  // The wall clock is subscribed to, not read during render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  if (!ws) return null;
  const paid = nowMs > 0 && ws.paidUntilMs > nowMs;
  const trial = nowMs > 0 && !paid && ws.trialEndsAtMs > nowMs;
  const hoursLeft = Math.max(1, Math.ceil((ws.trialEndsAtMs - nowMs) / 3600_000));
  const credits = ws.creditDays ?? 0;

  return (
    <div className={a.wrap}>
      <header className={a.hero}>
        <h1 className={a.h1}>Plans that grow with your business</h1>
        <p className={a.lead}>
          One AI team, three ways to hire it. Pay by bank transfer, EasyPaisa or JazzCash — your plan switches on as soon
          as the payment is approved.
        </p>
        <div className={a.toggle} role="radiogroup" aria-label="Pay for">
          {(['month', 'year'] as const).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={billing === b} onClick={() => setBilling(b)}>
              {b === 'month' ? 'Monthly' : 'Yearly'}
              {b === 'year' ? <span className={a.save}>Save {STUDIO_YEAR_DISCOUNT_PCT}%</span> : null}
            </button>
          ))}
        </div>
      </header>

      <div className={a.plans}>
        {STUDIO_PLAN_IDS.map((id) => {
          const p = STUDIO_PLANS[id];
          const mine = id === ws.plan;
          const best = id === 'all';
          const price = studioPriceUsd(id, billing);
          const ribbon = mine && trial ? `Free trial · ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} left` : mine && paid ? 'Your plan' : best ? 'Best value — the whole team' : null;
          return (
            <div key={id} className={a.planWrap}>
              <span className={`${a.ribbon} ${best && !mine ? a.ribbonLime : ''} ${ribbon ? '' : a.ribbonGhost}`}>{ribbon ?? '—'}</span>
              <article className={`${a.plan} ${best ? a.planBest : ''}`}>
                <span className={a.planIcon} aria-hidden>
                  {ICON[id]}
                </span>
                <div>
                  <h2 className={a.planName}>{p.name}</h2>
                  <p className={a.planTag}>{p.tagline}</p>
                </div>
                <div className={a.price}>
                  <span className={a.priceNum}>${price}</span>
                  <span className={a.priceUnit}>
                    USD / {billing}
                    <br />
                    {billing === 'year' ? `save $${p.usd * 12 - price} on 12 months` : 'billed monthly'}
                  </span>
                </div>
                <Link
                  href={`/dashboard/social/billing?plan=${id}&billing=${billing}`}
                  className={mine && paid ? a.btnGhost : a.btn}
                >
                  {mine && paid ? `Renew ${p.name}` : mine && trial ? `Keep ${p.name}` : `Get ${p.name}`}
                </Link>
                <ul className={a.features}>
                  {p.includes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </article>
            </div>
          );
        })}
      </div>

      <section className={a.credits} id="credits" aria-labelledby="credits-title">
        <div>
          <h2 id="credits-title">Need more days? Add credits.</h2>
          <p>
            ${STUDIO_CREDIT_DAY_USD} buys a full day of your team&apos;s work — content, comments, ads, sales. A credit day is
            used only when your plan has run out or this month&apos;s AI work is used up, so the team never stops halfway.
          </p>
          {credits > 0 ? (
            <span className={a.balance}>
              You have ${credits * STUDIO_CREDIT_DAY_USD}.00 — {credits} day{credits === 1 ? '' : 's'} of work
            </span>
          ) : null}
        </div>
        <div className={a.packs}>
          {STUDIO_CREDIT_PACKS.map((days) => (
            <Link key={days} href={`/dashboard/social/billing?credits=${days}`} className={a.pack}>
              <b>${days * STUDIO_CREDIT_DAY_USD}</b>
              <small>{days} days of work</small>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
