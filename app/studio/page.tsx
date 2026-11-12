import type { Metadata } from 'next';
import Link from 'next/link';

import { VelocityMark } from '@/components/BrandMark';
import { ArrowRight, Clock, Handshake, Megaphone, Mic, Sparkle, TrendingUp } from '@/components/site/Icons';
import { Vexa } from '@/components/site/Assistant';
import { DemoButton } from '@/components/site/DemoButton';
import { MagicCta } from '@/components/site/SiteNav';
import { SoundToggle } from '@/components/site/siteSound';
import { STUDIO_FAQ, StudioFaq, StudioPricing } from '@/components/site/StudioSections';
import { StudioScrub } from '@/components/site/StudioScrub';
import { StudioStory } from '@/components/site/StudioStory';
import { STUDIO_FROM_USD, STUDIO_TRIAL_HOURS, STUDIO_TRIAL_USD, studioUsd } from '@/lib/studio';
import { VEXA_LEGAL_EFFECTIVE, VEXA_PRIVACY } from '@/lib/vexaLegal';
import site from '@/components/site/site.module.css';

import s from './studio.module.css';

/**
 * Vexa's own site, at /vexa (the rewrite in next.config.ts serves this page).
 *
 * A site of its own, not a section of Velocity's: its own header and footer,
 * everything Vexa does, the same scroll film and narrated story the homepage
 * shows, the price cards, the questions, and the privacy policy on the page
 * rather than a link away — the owner asked for it read like a separate
 * website, and Meta, TikTok and Stripe reviewers all read a policy here.
 *
 * Static and Firebase-free on purpose: it lives outside the (app) route group,
 * and its prices come from lib/studio.ts, which imports nothing. Sign-up is
 * /studio/signup, inside the console.
 *
 * No invented numbers anywhere: no customer counts, ratings or "x% more reach".
 * Every claim here is something the product does, and every line of the policy
 * below is lib/vexaLegal.ts, the same words her own /vexa/privacy page prints.
 */

/**
 * Vexa's whole head, not just her title.
 *
 * app/layout.tsx is Velocity Rides' — its site name, keywords, Twitter card
 * and share picture are the ride app's, and every one of them survives on a
 * page that only replaces the title. So this names all of them. It is also the
 * head the front door wears when the console picks "Only Vexa" (app/page.tsx
 * returns this object), which is why the share picture is named outright
 * rather than left to the file beside the root page: that one is the Rides
 * card.
 */
export const metadata: Metadata = {
  title: { absolute: 'Vexa — Your Social Media Virtual Assistant' },
  description:
    `Connect Instagram and Facebook and Vexa plans your month, makes reels with voice-over and music, posts every day, runs your Meta ads and finds you customers. From $${STUDIO_FROM_USD} a month.`,
  applicationName: 'Vexa',
  keywords: [
    'social media virtual assistant',
    'social media manager for small business',
    'Instagram and Facebook posting',
    'AI reels with voice-over',
    'Meta ads management',
    'Vexa',
  ],
  // /vexa and /studio are the same page; the policy and TikTok's app form name /vexa, so that is the one.
  alternates: { canonical: '/vexa' },
  openGraph: {
    type: 'website',
    siteName: 'Vexa',
    title: 'Vexa — you don’t need a social media team anymore',
    description: 'Connect your account and watch Vexa plan, make, post, advertise and sell for you.',
    url: '/vexa',
    images: ['/studio/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vexa — you don’t need a social media team anymore',
    description: 'Connect your account and watch Vexa plan, make, post, advertise and sell for you.',
    images: ['/studio/opengraph-image'],
  },
};

const TEAM = [
  {
    name: 'Hina',
    role: 'Research Assistant',
    does: 'Searches your market every morning — what is going viral, what competitors post — and runs every campaign as a free dummy before you spend.',
  },
  { name: 'Qalam', role: 'Writer', does: 'Writes the hook, the script, the voice-over and the caption — in the language your customers speak.' },
  { name: 'Rang', role: 'Designer', does: 'Makes the post, story and carousel pictures, in your look.' },
  { name: 'Raftar', role: 'Video editor', does: 'Cuts reels with real footage, music and a spoken voice-over.' },
  { name: 'Talha', role: 'SEO', does: 'Chooses the words and hashtags people actually search on Instagram, TikTok and YouTube.' },
  { name: 'Awaaz', role: 'Social media manager', does: 'Posts at the right time, answers comments, and learns from your best posts.' },
  {
    name: 'Bilal',
    role: 'Meta Ad Expert',
    does: 'Runs your Meta ads inside the daily limit you set, and improves them every day — cost, conversions and ROAS.',
  },
  { name: 'Sales', role: 'Sales, calling & email agents', does: 'Finds businesses that could buy from you, emails each one from your own mailbox, follows up, and phones your leads.' },
];

const MAKES = [
  { icon: Mic, text: 'Reels with real footage, music and a voice-over' },
  { icon: Sparkle, text: 'Posts, stories and carousels, designed for you' },
  { icon: Clock, text: 'A whole month planned on a content calendar' },
  { icon: TrendingUp, text: 'What is going viral in your niche — and a version of your own' },
  { icon: Megaphone, text: 'Facebook and Instagram ads, with your budget guarded in code' },
  { icon: Handshake, text: 'New customers found and emailed for you' },
];

/** The questions, for search — they moved here with the FAQ itself when the homepage became the door. */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: STUDIO_FAQ.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

export default function StudioPage() {
  return (
    <main className={site.site} id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <header className={s.topBar}>
        <div className={`${site.wrap} ${s.topInner}`}>
          {/* Stays on whatever address this is: the page is also served at / when
              the console picks "Only Vexa", and the logo must not move anyone off it. */}
          <a href="#top" className={s.topBrand}>
            <VelocityMark size={30} />
            Vexa
          </a>
          <nav className={s.topLinks} aria-label="Vexa">
            {/* They stay on a phone and inside the front door's half-width box,
                dropping to their own row rather than disappearing. */}
            <span className={s.topPages}>
              <a href="#how-it-works">How it works</a>
              <a href="#pricing">Pricing</a>
              <DemoButton>Demo</DemoButton>
            </span>
            {/* The way back in for a customer who already has a workspace — the
                homepage's own button, so it is the one they know. */}
            <span className={s.topRight}>
              <MagicCta href="/studio/login" label="Vexa login" />
              {/* The scroll film and the story below are narrated; this is the page's one mute. */}
              <SoundToggle className={s.topSound} />
            </span>
          </nav>
        </div>
      </header>

      <section className={s.hero}>
        <div className={s.heroGlow} aria-hidden />
        <div className={`${site.wrap} ${s.heroGrid}`}>
          <div className={s.heroCopy}>
            <span className={site.eyebrow}>
              <Sparkle /> Vexa — Your Social Media Virtual Assistant
            </span>
            <h1 className={site.h1}>
              You don’t need a social media team <span className={site.accent}>anymore.</span>
            </h1>
            <p className={site.lead}>
              Vexa plans your month, makes reels with voice-over and music, posts every day, answers comments, runs
              your Meta ads and finds you new customers. Connect your account — and watch.
            </p>
            <div className={s.heroActions}>
              <Link href="/studio/signup" className={`${site.btn} ${site.btnLime}`}>
                Try a day for {studioUsd(STUDIO_TRIAL_USD)} <ArrowRight />
              </Link>
              <a href="#pricing" className={`${site.btn} ${site.btnGhost}`}>
                See plans
              </a>
            </div>
            <p className={s.heroNote}>
              One day for {studioUsd(STUDIO_TRIAL_USD)}. From ${STUDIO_FROM_USD}/month after it.
            </p>
          </div>

          {/* She is the hero: life-size, the networks over her head, and she says what she does. */}
          <Vexa hero />
        </div>
      </section>

      {/* The film that plays as you scroll, then the five jobs acted out in a mock of the console. */}
      <StudioScrub />
      <StudioStory />
      <StudioPricing />

      <section id="how" className={site.section}>
        <div className={site.wrap}>
          <div className={site.sectionHead}>
            <span className={site.eyebrow}>Getting started</span>
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

      <StudioFaq />

      {/* What TikTok's app reviewer reads from outside the login. Every line is what the Post to TikTok screen does. */}
      <section id="about" className={`${site.section} ${site.light}`}>
        <div className={site.wrap}>
          <div className={site.sectionHead}>
            <span className={site.eyebrow}>About Vexa</span>
            <h2 className={site.h2}>Vexa is a product of Velocity Rides.</h2>
            <p className={site.lead}>
              Vexa is the social media virtual assistant for businesses. It is made by the team behind the Velocity Rides app and operated by Berreto (Private) Limited.
            </p>
          </div>
          <div className={site.sectionHead}>
            <span className={site.eyebrow}>How Vexa works with TikTok</span>
          </div>
          <div className={s.steps}>
            <div className={s.step}>
              <span className={s.stepN}>01</span>
              <h3>You connect your account</h3>
              <p>You sign in on TikTok’s own page and allow two things: your basic profile, and posting videos. Vexa never sees your password.</p>
            </div>
            <div className={s.step}>
              <span className={s.stepN}>02</span>
              <h3>You check each video</h3>
              <p>You watch it, edit the title, choose who can view it, set comments, Duet and Stitch, and label commercial content.</p>
            </div>
            <div className={s.step}>
              <span className={s.stepN}>03</span>
              <h3>You press Post to TikTok</h3>
              <p>Nothing goes to TikTok until you press it. You can disconnect at any time, which deletes the stored access.</p>
            </div>
          </div>
          <p className={`${site.lead} ${site.center}`} style={{ marginTop: 28 }}>
            Read our{' '}
            <a href="#privacy" style={{ textDecoration: 'underline' }}>
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href="/vexa/terms" style={{ textDecoration: 'underline' }}>
              Terms of Service
            </a>
            .
          </p>
        </div>
      </section>

      {/* The policy itself, on the page: Meta, TikTok and Stripe reviewers read it here, and so can a customer. */}
      <section id="privacy" className={site.section}>
        <div className={site.wrap}>
          <div className={`${site.sectionHead} ${site.center}`}>
            <span className={site.eyebrow}>Privacy</span>
            <h2 className={site.h2}>What Vexa knows about you, and why</h2>
            <p className={`${site.lead} ${site.center}`}>
              Effective {VEXA_LEGAL_EFFECTIVE} · Berreto (Private) Limited · business@velocityrides.app
            </p>
          </div>
          <div className={s.policy}>
            {VEXA_PRIVACY.map((p) => (
              <article key={p.t} className={s.policyItem}>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </article>
            ))}
          </div>
          <p className={s.policyMore}>
            This is Vexa’s privacy policy in full; it also has its own page at{' '}
            <a href="/vexa/privacy">velocityrides.app/vexa/privacy</a>. Her other documents:{' '}
            <a href="/vexa/terms">Terms of Service</a>, <a href="/vexa/delete-account">Delete your workspace</a> and{' '}
            <a href="/support">Support</a>. The Velocity Rides app has its own at <a href="/privacy">/privacy</a>.
          </p>
        </div>
      </section>

      <section className={`${s.closing} ${site.deep}`}>
        <div className={site.wrap}>
          <h2 className={site.h2}>Connect your account. Watch the magic.</h2>
          <p className={`${site.lead} ${site.center}`}>
            The first {STUDIO_TRIAL_HOURS} hours cost {studioUsd(STUDIO_TRIAL_USD)}.
          </p>
          <div className={s.heroActions} style={{ justifyContent: 'center' }}>
            <Link href="/studio/signup" className={`${site.btn} ${site.btnLime}`}>
              Try a day for {studioUsd(STUDIO_TRIAL_USD)} <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <footer className={site.wrap}>
        <div className={s.footer}>
          <span>Vexa — Your Social Media Virtual Assistant. A product of Velocity Rides, by Berreto (Private) Limited</span>
          <span>
            <a href="/vexa/terms">Terms</a> · <a href="/vexa/privacy">Privacy</a> ·{' '}
            <a href="/vexa/delete-account">Delete your workspace</a> · <a href="/support">Support</a> ·{' '}
            <a href="mailto:business@velocityrides.app">business@velocityrides.app</a>
          </span>
        </div>
      </footer>
      <Vexa />
    </main>
  );
}
