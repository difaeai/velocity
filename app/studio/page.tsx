import type { Metadata } from 'next';
import Link from 'next/link';

import { VelocityMark } from '@/components/BrandMark';
import { ArrowRight, Check, Clock, Handshake, Megaphone, Mic, Sparkle, TrendingUp } from '@/components/site/Icons';
import { STUDIO_PLAN_IDS, STUDIO_PLANS, STUDIO_TRIAL_HOURS } from '@/lib/studio';
import site from '@/components/site/site.module.css';

import s from './studio.module.css';

/**
 * Velocity Studio's sales page. Static and Firebase-free on purpose: it lives
 * outside the (app) route group, and its prices come from lib/studio.ts, which
 * imports nothing. Sign-up is /studio/start, inside the console.
 *
 * No invented numbers anywhere: no customer counts, ratings or "x% more reach".
 * Every claim here is something the product does.
 */

export const metadata: Metadata = {
  title: { absolute: 'Velocity Studio — your AI social media team' },
  description:
    'Connect Instagram and Facebook and an AI team plans your month, makes reels with voice-over and music, posts every day, runs your Meta ads and finds you customers. From $19 a month.',
  alternates: { canonical: '/studio' },
  openGraph: {
    title: 'Velocity Studio — you don’t need a social media team anymore',
    description: 'Connect your account and watch the AI team plan, make, post, advertise and sell for you.',
    url: '/studio',
  },
};

const TEAM = [
  { name: 'Hina', role: 'Research', does: 'Searches your market every morning: what is going viral, what competitors post, which sounds are trending.' },
  { name: 'Qalam', role: 'Writer', does: 'Writes the hook, the script, the voice-over and the caption — in the language your customers speak.' },
  { name: 'Rang', role: 'Designer', does: 'Makes the post, story and carousel pictures, in your look.' },
  { name: 'Raftar', role: 'Video editor', does: 'Cuts reels with real footage, music and a spoken voice-over.' },
  { name: 'Talha', role: 'SEO', does: 'Chooses the words and hashtags people actually search on Instagram, TikTok and YouTube.' },
  { name: 'Awaaz', role: 'Social media manager', does: 'Posts at the right time, answers comments, and learns from your best posts.' },
  { name: 'Bilal', role: 'Ads expert', does: 'Plans, writes and runs Meta ads inside the daily limit you set — and reads every number.' },
  { name: 'Sales', role: 'Sales agent', does: 'Finds businesses that could buy from you and writes each one a short, personal email.' },
];

const MAKES = [
  { icon: Mic, text: 'Reels with real footage, music and a voice-over' },
  { icon: Sparkle, text: 'Posts, stories and carousels, designed for you' },
  { icon: Clock, text: 'A whole month planned on a content calendar' },
  { icon: TrendingUp, text: 'What is going viral in your niche — and a version of your own' },
  { icon: Megaphone, text: 'Facebook and Instagram ads, with your budget guarded in code' },
  { icon: Handshake, text: 'New customers found and emailed for you' },
];

const FAQ = [
  {
    q: 'Do I need to know anything about marketing or tech?',
    a: 'No. You answer five questions about your business, connect your Instagram and Facebook with one sign-in, and the team starts. You can tell any agent what you want in plain words.',
  },
  {
    q: 'Will it post without asking me?',
    a: 'Only if you say so. On day one you choose once: every piece waits for your Approve, or finished pieces go straight out. You can change it any time.',
  },
  {
    q: 'Which accounts can it post to?',
    a: 'Instagram (a Business or Creator account) and the Facebook Page it is linked to. The ads expert works with your own Meta ad account.',
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

export default function StudioPage() {
  return (
    <main className={site.site}>
      <header className={s.topBar}>
        <div className={`${site.wrap} ${s.topInner}`}>
          <Link href="/studio" className={s.topBrand}>
            <VelocityMark size={30} />
            Velocity Studio
          </Link>
          <nav className={s.topLinks} aria-label="Velocity Studio">
            <a href="#how" className={s.topHide}>
              How it works
            </a>
            <a href="#pricing" className={s.topHide}>
              Pricing
            </a>
            <Link href="/login">Sign in</Link>
          </nav>
        </div>
      </header>

      <section className={s.hero}>
        <div className={s.heroGlow} aria-hidden />
        <div className={`${site.wrap} ${s.heroGrid}`}>
          <div>
            <span className={site.eyebrow}>
              <Sparkle /> Velocity Studio
            </span>
            <h1 className={site.h1}>
              You don’t need a social media team <span className={site.accent}>anymore.</span>
            </h1>
            <p className={site.lead}>
              An AI team plans your month, makes reels with voice-over and music, posts every day, answers comments, runs
              your Meta ads and finds you new customers. Connect your account — and watch.
            </p>
            <div className={s.heroActions}>
              <Link href="/studio/start" className={`${site.btn} ${site.btnLime}`}>
                Start free for {STUDIO_TRIAL_HOURS} hours <ArrowRight />
              </Link>
              <a href="#pricing" className={`${site.btn} ${site.btnGhost}`}>
                See plans
              </a>
            </div>
            <p className={s.heroNote}>No card. From ${STUDIO_PLANS.content.usd}/month after the free day.</p>
          </div>

          <div className={s.mock} aria-label="What your dashboard looks like">
            <div className={s.mockBar}>
              <span className={s.mockDot} /> Your team is working
            </div>
            <div className={s.mockAsk}>“Make a reel for Eid: order cakes by Thursday, free delivery”</div>
            <div className={s.mockBoxes}>
              {[
                { t: 'Eid orders close Thursday', bg: 'linear-gradient(160deg,#0b6b45,#04120c)', st: 'Live', live: true },
                { t: 'Baked at 5am. Delivered by noon.', bg: 'linear-gradient(160deg,#3d2a12,#120b04)', st: 'Approve' },
                { t: '3 cakes our regulars order most', bg: 'linear-gradient(160deg,#1d2f5a,#060b18)', st: 'Being made' },
              ].map((b) => (
                <div key={b.t} className={s.mockBox}>
                  <div className={s.mockThumb} style={{ background: b.bg }}>
                    {b.t}
                  </div>
                  <div className={s.mockMeta}>
                    <span>Reel</span>
                    <span className={b.live ? s.mockLive : undefined}>{b.st}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="how" className={`${site.section} ${site.light}`}>
        <div className={site.wrap}>
          <div className={site.sectionHead}>
            <span className={site.eyebrow}>How it works</span>
            <h2 className={site.h2}>Three steps. Then it runs by itself.</h2>
          </div>
          <div className={s.steps}>
            <div className={s.step}>
              <span className={s.stepN}>01</span>
              <h3>Tell us about your business</h3>
              <p>What you sell, who buys it, where, and in which language. Two minutes. That becomes the team’s brief.</p>
            </div>
            <div className={s.step}>
              <span className={s.stepN}>02</span>
              <h3>Connect Instagram &amp; Facebook</h3>
              <p>One sign-in with Facebook. No passwords to paste, no developer account, nothing to install.</p>
            </div>
            <div className={s.step}>
              <span className={s.stepN}>03</span>
              <h3>Watch the team work</h3>
              <p>It plans the month, makes and posts every day, and tells you what worked. Approve each piece, or let it post.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={`${site.section} ${site.deep}`}>
        <div className={site.wrap}>
          <div className={site.sectionHead}>
            <span className={site.eyebrow}>Your team</span>
            <h2 className={site.h2}>Eight specialists. One job each.</h2>
            <p className={site.lead}>
              Each agent has a name and a role, and you can tell any of them what you want — the tone, the topics, the
              words never to use.
            </p>
          </div>
          <div className={s.team}>
            {TEAM.map((a) => (
              <div key={a.name} className={s.agent}>
                <div className={s.agentHead}>
                  <span className={s.avatar} aria-hidden>
                    {a.name[0]}
                  </span>
                  <div>
                    <strong>{a.name}</strong>
                    <div className={s.agentRole}>{a.role}</div>
                  </div>
                </div>
                <p>{a.does}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={site.section}>
        <div className={site.wrap}>
          <div className={site.sectionHead}>
            <span className={site.eyebrow}>What it makes</span>
            <h2 className={site.h2}>Everything a social media team does — every day.</h2>
          </div>
          <div className={s.makes}>
            {MAKES.map(({ icon: Icon, text }) => (
              <div key={text} className={s.make}>
                <Icon />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className={`${site.section} ${site.light}`}>
        <div className={site.wrap}>
          <div className={`${site.sectionHead} ${site.center}`}>
            <span className={site.eyebrow}>Pricing</span>
            <h2 className={site.h2}>Pay for what you use. Nothing else.</h2>
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

      <section className={site.section}>
        <div className={site.wrap}>
          <div className={`${site.sectionHead} ${site.center}`}>
            <span className={site.eyebrow}>Questions</span>
            <h2 className={site.h2}>Before you start</h2>
          </div>
          <div className={s.faq}>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={`${s.closing} ${site.deep}`}>
        <div className={site.wrap}>
          <h2 className={site.h2}>Connect your account. Watch the magic.</h2>
          <p className={`${site.lead} ${site.center}`}>The first {STUDIO_TRIAL_HOURS} hours are on us.</p>
          <div className={s.heroActions} style={{ justifyContent: 'center' }}>
            <Link href="/studio/start" className={`${site.btn} ${site.btnLime}`}>
              Start free <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <footer className={site.wrap}>
        <div className={s.footer}>
          <span>Velocity Studio by Berreto (Private) Limited</span>
          <span>
            <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="mailto:business@velocityrides.app">business@velocityrides.app</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
