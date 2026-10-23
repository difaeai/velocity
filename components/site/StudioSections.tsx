import Link from 'next/link';

import { ArrowRight, Check } from '@/components/site/Icons';
import { STUDIO_PLAN_IDS, STUDIO_PLANS } from '@/lib/studio';
import s from '@/app/studio/studio.module.css';
import site from './site.module.css';

/**
 * Velocity Studio's pricing and questions — the same on the homepage and on
 * /studio, so a price or an answer is changed in one place. Prices come from
 * lib/studio.ts, which the server's plan checks mirror.
 */

export const STUDIO_FAQ = [
  {
    q: 'What happens in the first hour?',
    a: 'The team reads your market: what you told us at sign-up, anything you type into the first box, and any links you add. It searches who else sells what you sell, runs a pre-launch audience test with a simulated panel of customers, then plans your month from what it found.',
  },
  {
    q: 'Do I need to know anything about marketing or tech?',
    a: 'No. You answer five questions about your business, connect your Instagram and Facebook with one sign-in, and the team starts. You can tell any agent what you want in plain words.',
  },
  {
    q: 'Will it post without asking me?',
    a: 'Only if you say so. On day one you choose once: every piece waits for your Approve, or finished pieces go straight out at the time you pick. Either way you can open the calendar and change any day before it goes out.',
  },
  {
    q: 'What does the Meta Ad Expert do on its own?',
    a: 'It launches ads inside the daily limit you set, then reads the cost, the conversions and the ROAS every day. Winners keep running and get more budget, losers are paused, and a tired ad gets a fresh creative — or it asks you first, if you prefer.',
  },
  {
    q: 'Which accounts can it post to?',
    a: 'Instagram (a Business or Creator account) and the Facebook Page it is linked to. The Meta Ad Expert works with your own Meta ad account.',
  },
  {
    q: 'Is the music safe to use?',
    a: 'Yes. Reels use public-domain tracks, or music you add yourself. Instagram’s own trending sounds can’t be added by any app, so the team lists them for you to add when you post.',
  },
  {
    q: 'How do I pay?',
    a: 'By bank transfer, EasyPaisa or JazzCash. Send the payment, then upload the screenshot or type the transaction ID — your plan switches on as soon as it is checked.',
  },
  {
    q: 'Can I stop?',
    a: 'Any time. Plans are month to month: if you don’t pay for the next month, the team simply pauses. Nothing is posted after that.',
  },
];

export function StudioPricing({ heading = 'Pay for what you use. Nothing else.' }: { heading?: string }) {
  return (
    <section id="pricing" className={`${site.section} ${site.light}`}>
      <div className={site.wrap}>
        <div className={`${site.sectionHead} ${site.center}`}>
          <span className={site.eyebrow}>Pricing</span>
          <h2 className={site.h2}>{heading}</h2>
          <p className={`${site.lead} ${site.center}`}>Every plan starts with a free day. Month to month — stop any time.</p>
        </div>
        <div className={s.plans}>
          {STUDIO_PLAN_IDS.map((id) => {
            const p = STUDIO_PLANS[id];
            const best = id === 'all';
            return (
              <div key={id} className={`${s.plan} ${best ? s.planBest : ''}`}>
                {best ? <span className={s.planTag}>The whole team</span> : null}
                <h3>{p.name}</h3>
                <div className={s.price}>
                  ${p.usd}
                  <small>/month</small>
                </div>
                <p className={s.planTagline}>{p.tagline}</p>
                <ul className={s.planList}>
                  {p.includes.map((line) => (
                    <li key={line}>
                      <Check />
                      {line}
                    </li>
                  ))}
                </ul>
                <Link href={`/studio/start?plan=${id}`} className={`${site.btn} ${best ? site.btnLime : site.btnGhost}`}>
                  Start free <ArrowRight />
                </Link>
              </div>
            );
          })}
        </div>
        <p className={s.payNote}>Pay by bank transfer, EasyPaisa or JazzCash.</p>
      </div>
    </section>
  );
}

export function StudioFaq() {
  return (
    <section className={site.section}>
      <div className={site.wrap}>
        <div className={`${site.sectionHead} ${site.center}`}>
          <span className={site.eyebrow}>Questions</span>
          <h2 className={site.h2}>Before you start</h2>
        </div>
        <div className={s.faq}>
          {STUDIO_FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
