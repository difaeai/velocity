import type { Metadata } from 'next';
import Link from 'next/link';

import { VelocityMark } from '@/components/BrandMark';
import { HeroSlider, type HeroSlide } from '@/components/site/HeroSlider';
import { Reveal } from '@/components/site/Reveal';
import { SiteNav } from '@/components/site/SiteNav';
import { StudioHow, type StudioStep } from '@/components/site/StudioHow';
import { StudioScrub } from '@/components/site/StudioScrub';
import { STUDIO_FAQ, StudioFaq, StudioPricing } from '@/components/site/StudioSections';
import { AppleMark, ArrowRight, Check, GooglePlay, Sparkle } from '@/components/site/Icons';
import styles from '@/components/site/site.module.css';
import home from '@/components/site/studioHome.module.css';
import { STUDIO_FROM_USD, STUDIO_PLAN_IDS, STUDIO_PLANS, STUDIO_TRIAL_HOURS } from '@/lib/studio';
import {
  SITE_URL as SITE,
  PRIVACY_URL,
  TERMS_URL,
  DELETE_ACCOUNT_URL,
  SOCIAL_PROFILES,
  FACEBOOK_URL,
  INSTAGRAM_URL,
  PLAY_URL,
  APP_STORE_URL,
} from '@/lib/site';

/**
 * The homepage: Velocity Studio, with the Velocity Rides app sharing its hero.
 *
 * The hero is two films — the ride app and the studio — and everything under it
 * is the studio: how it works (five films that play as you scroll, the same five
 * steps a new workspace runs), then the prices, then the questions. The ride
 * app's own long page lives at /rides, linked from its slide.
 *
 * The canonical lives here rather than in the root layout: a canonical declared
 * in the layout is inherited by the console and the fleet portal, which would
 * then all claim to be this page.
 *
 * No invented numbers anywhere — no customer counts, ratings or results. Every
 * claim is something the product does.
 */
export const metadata: Metadata = {
  description:
    'Velocity Rides: book a ride and share it with people going your way. Velocity Studio: an AI team that reads your market, posts every day at your time, runs your Meta ads and closes your leads.',
  alternates: { canonical: '/' },
};

const LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '/rides', label: 'Velocity Rides' },
  { href: '/studio/start', label: 'Start free' },
];

function StoreBadge({ variant }: { variant: 'play' | 'ios' }) {
  const ios = variant === 'ios';
  return (
    <a className={styles.store} href={ios ? APP_STORE_URL : PLAY_URL} target="_blank" rel="noreferrer">
      {ios ? <AppleMark /> : <GooglePlay />}
      <span className={styles.storeText}>
        <small>{ios ? 'Download on' : 'Get it on'}</small>
        <strong>{ios ? 'the App Store' : 'Google Play'}</strong>
      </span>
    </a>
  );
}

const SLIDES: HeroSlide[] = [
  {
    key: 'rides',
    tab: 'Velocity Rides',
    sub: 'Book, share the ride, pay less',
    film: {
      large: '/site/rides.mp4',
      small: '/site/rides-sm.mp4',
      poster: '/site/rides.jpg',
      label: 'A rider books on her phone in Lahore, a white car picks her up, and a second rider joins her on the way.',
    },
    beats: [
      { at: 0, icon: '📱', title: 'Ride booked', detail: 'A shared ride — the fare is fixed, no haggling' },
      { at: 4, icon: '🚗', title: 'Your driver is here', detail: 'Verified driver, tracked live on the map' },
      { at: 7.5, icon: '👥', title: 'A second rider joins on the way', detail: 'Two riders: each pays 60% of the solo fare' },
    ],
    copy: (
      <>
        <span className={styles.launchPill}>
          <span className={styles.pulse} aria-hidden="true" />
          Now live on iPhone and Android
        </span>
        <h1 className={styles.heroTitle}>
          <span className={styles.line}>
            <span style={{ ['--line-delay' as string]: '80ms' }}>Name your fare.</span>
          </span>
          <span className={styles.line}>
            <span style={{ ['--line-delay' as string]: '200ms' }}>Split the ride.</span>
          </span>
          <span className={styles.line}>
            <em style={{ ['--line-delay' as string]: '320ms' }}>Keep the change.</em>
          </span>
        </h1>
        <p className={styles.heroLead}>
          Velocity Rides is the ride app built for how Pakistan travels and pays: book a ride, share it with people
          going your way, pay in cash.
        </p>
        <div className={styles.heroActions}>
          <StoreBadge variant="play" />
          <StoreBadge variant="ios" />
        </div>
        <p className={styles.heroNote}>
          <Check />
          <Link href="/rides">How Velocity Rides works →</Link>
        </p>
      </>
    ),
  },
  {
    key: 'studio',
    tab: 'Velocity Studio',
    sub: 'Your business, its own AI team',
    film: {
      large: '/site/studio.mp4',
      small: '/site/studio-sm.mp4',
      poster: '/site/studio.jpg',
      label: 'A bakery owner in Lahore while her AI team works: her laptop plans the month, her phone fills with likes, and her café fills with customers.',
    },
    beats: [
      { at: 0, icon: '🔎', title: 'Market analysed', detail: 'Your notes and links, a live search, an audience test' },
      { at: 2.2, icon: '🗓️', title: '30 days of content, made ahead', detail: 'Change any day on the calendar' },
      { at: 4.6, icon: '📲', title: 'Posted at your time', detail: 'Reels, posts and stories, every day' },
      { at: 7.2, icon: '📈', title: 'Meta Ad Expert on it', detail: 'Cost, conversions and ROAS — improved daily' },
      { at: 9.4, icon: '🤝', title: 'Leads followed up and closed', detail: 'Every reply answered with a draft' },
    ],
    copy: (
      <>
        <span className={styles.eyebrow}>
          <Sparkle /> Velocity Studio
        </span>
        <h2 className={styles.heroTitle}>
          Your business. <em>Its own AI team.</em>
        </h2>
        <p className={styles.heroLead}>
          It reads your market, plans a month of content, posts every day at your time, runs your Meta ads and closes
          your leads — while you run the shop.
        </p>
        <div className={styles.heroActions}>
          <Link href="/studio/start" className={`${styles.btn} ${styles.btnLime}`}>
            Start free for {STUDIO_TRIAL_HOURS} hours <ArrowRight />
          </Link>
          <a href="#how-it-works" className={`${styles.btn} ${styles.btnGhost}`}>
            See how it works
          </a>
        </div>
        <p className={styles.heroNote}>
          <Check />
          From ${STUDIO_FROM_USD} a month after the free day · no card
        </p>
      </>
    ),
  },
];

/** The five steps every new workspace runs, in the order it runs them. */
const STEPS: StudioStep[] = [
  {
    key: 'market',
    kicker: 'Step 1 · Market analysis',
    title: 'It reads your market — and listens to you first',
    body: 'Type what you know about your business and add links: your website, your Instagram, a competitor. The team reads them, searches your market live, and runs a pre-launch audience test — a simulated panel of customers reacts to your offer before you spend a rupee.',
    points: ['Who buys, and what each kind of buyer wants', 'Who they choose instead, and how you stand out', 'What to change before you launch'],
    chipLabel: 'Market read',
    chip: 'Buyers, competitors and an audience test',
    film: '/site/step1.mp4',
    poster: '/site/step1.jpg',
    alt: 'The owner types at her laptop at night while maps, charts and shop photos float around it.',
  },
  {
    key: 'content',
    kicker: 'Step 2 · Content setup',
    title: 'A month of content, planned and made ahead',
    body: 'From that read the team plans 30 days — a goal, the stories it will tell, a theme for every week — and makes the reels, posts and stories ahead of time. Open the calendar any day to read what is coming, change a day, or send a piece back with your notes.',
    points: ['Reels with voice-over and music', 'Posts, stories and carousels in your look', 'Every day editable before it goes out'],
    chipLabel: 'Calendar',
    chip: '30 days filled, one by one',
    film: '/site/step2.mp4',
    poster: '/site/step2.jpg',
    alt: 'A wooden wall calendar fills, square by square, with colourful cards of pastries.',
  },
  {
    key: 'execute',
    kicker: 'Step 3 · Execute',
    title: 'Posted every day, at your time',
    body: 'Pick the hour in your own time zone. The team posts to Instagram and Facebook on its own — or waits for your Approve, if you would rather. It answers comments and learns from what your own audience liked.',
    points: ['Instagram and Facebook from one sign-in', 'Ask me first, or post directly — your choice', 'Learns from your own best posts'],
    chipLabel: 'Posting',
    chip: 'Out at your time, every day',
    film: '/site/step3.mp4',
    poster: '/site/step3.jpg',
    alt: 'A phone on a tripod films honey poured over a croissant, and small hearts float up from its screen.',
  },
  {
    key: 'funnel',
    kicker: 'Step 4 · Sales funnel',
    title: 'A funnel, and a Meta Ad Expert that improves it daily',
    body: 'The team designs the path from a stranger to a sale, and the Meta Ad Expert launches your first campaign inside the daily limit you set. Then it reads the cost, the conversions and the ROAS every day: winners keep running, losers stop, tired ads get a fresh creative.',
    points: ['Your daily budget limit, enforced in code', 'Judged on sales and leads, not just clicks', 'Reads the market and competitors before every move'],
    chipLabel: 'Meta Ad Expert',
    chip: 'Winners kept, losers paused',
    film: '/site/step4.mp4',
    poster: '/site/step4.jpg',
    alt: 'Golden particles stream across a city sky into a glass funnel, which turns them into a row of pink boxes.',
  },
  {
    key: 'close',
    kicker: 'Step 5 · Lead close',
    title: 'Leads followed up, replies answered, deals closed',
    body: 'The sales agent finds businesses that could buy from you, writes each one a short personal email, and follows up twice if nobody answers. When someone writes back, your answer is already drafted — you press send.',
    points: ['Sent from your own mailbox', 'Two follow-ups, never a third', 'A “no” closes the lead for good'],
    chipLabel: 'Sales agent',
    chip: 'Reply in — answer drafted',
    film: '/site/step5.mp4',
    poster: '/site/step5.jpg',
    alt: 'The owner delivers a tall stack of pink boxes to an office manager, who shakes her hand.',
  },
];

/**
 * Structured data built from the same constants the page renders, so markup and
 * schema cannot drift. No ratings or counts: none are verified.
 */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE}#org`,
      name: 'Velocity Rides',
      legalName: 'Berreto (Private) Limited',
      parentOrganization: { '@type': 'Organization', name: 'Berreto (Private) Limited', url: 'https://berreto.com' },
      url: SITE,
      logo: `${SITE}/app/icon.png`,
      areaServed: { '@type': 'Country', name: 'Pakistan' },
      sameAs: SOCIAL_PROFILES,
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Velocity Studio',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      publisher: { '@id': `${SITE}#org` },
      offers: STUDIO_PLAN_IDS.map((id) => ({
        '@type': 'Offer',
        name: STUDIO_PLANS[id].name,
        price: String(STUDIO_PLANS[id].usd),
        priceCurrency: 'USD',
      })),
    },
    {
      '@type': 'MobileApplication',
      name: 'Velocity Rides',
      operatingSystem: 'Android 7.0+',
      applicationCategory: 'TravelApplication',
      installUrl: PLAY_URL,
      publisher: { '@id': `${SITE}#org` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'PKR' },
    },
    {
      '@type': 'MobileApplication',
      name: 'Velocity Rides',
      operatingSystem: 'iOS 16.4+',
      applicationCategory: 'TravelApplication',
      installUrl: APP_STORE_URL,
      publisher: { '@id': `${SITE}#org` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'PKR' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: STUDIO_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ],
};

export default function Home() {
  return (
    <div className={styles.site} id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <SiteNav links={LINKS} />

      <main>
        <HeroSlider slides={SLIDES} />

        <StudioScrub />

        {/* ── how it works: five films, played as you scroll to them ─────── */}
        <section id="how-it-works" className={`${styles.section} ${styles.deep} ${home.how}`}>
          <div className={styles.wrap}>
            <Reveal className={styles.sectionHead}>
              <span className={styles.eyebrow}>
                <Sparkle />
                How Velocity Studio works
              </span>
              <h2 className={styles.h2}>
                Five steps. Your team runs them <span className={styles.accent}>on its own.</span>
              </h2>
              <p className={styles.lead}>
                Sign up, connect Instagram and Facebook, and watch: each step starts the moment the one before it is
                done. You can step in anywhere — or just watch it work.
              </p>
            </Reveal>
            <StudioHow steps={STEPS} />
          </div>
        </section>

        <StudioPricing heading="One team. Three ways to hire it." />
        <StudioFaq />

        {/* ── the two products, and the way in to each ───────────────────── */}
        <section className={`${styles.sectionTight} ${styles.deep}`}>
          <div className={styles.wrap}>
            <div className={home.duo}>
              <Reveal className={home.duoCard}>
                <span className={styles.eyebrow}>
                  <Sparkle /> Velocity Studio
                </span>
                <h3>Connect your account. Watch your team work.</h3>
                <p>The first {STUDIO_TRIAL_HOURS} hours are on us — the market analysis starts the minute you sign up.</p>
                <div className={home.duoActions}>
                  <Link href="/studio/start" className={`${styles.btn} ${styles.btnLime}`}>
                    Start free <ArrowRight />
                  </Link>
                  <Link href="/studio" className={`${styles.btn} ${styles.btnGhost}`}>
                    Meet the team
                  </Link>
                </div>
              </Reveal>
              <Reveal className={home.duoCard} delay={80}>
                <span className={styles.eyebrow}>Velocity Rides</span>
                <h3>Need a ride? Share it and pay less.</h3>
                <p>City rides, shared seats, intercity trips and couriers — one app, cash accepted everywhere.</p>
                <div className={home.duoActions}>
                  <StoreBadge variant="play" />
                  <StoreBadge variant="ios" />
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <div className={styles.footerGrid}>
            <div className={styles.footerBrand}>
              <a className={styles.brand} href="#top">
                <span className={styles.brandMark}>
                  <VelocityMark style={{ color: '#ccff00' }} />
                </span>
                <span className={styles.brandName}>Velocity</span>
              </a>
              <p>
                Velocity Studio — an AI team for your business. Velocity Rides — ride-hailing and shared rides, built
                for Pakistan.
              </p>
            </div>

            <div className={styles.footerCol}>
              <h3>Studio</h3>
              <a href="#how-it-works">How it works</a>
              <a href="#pricing">Pricing</a>
              <Link href="/studio/start">Start free</Link>
              <Link href="/login">Sign in</Link>
            </div>

            <div className={styles.footerCol}>
              <h3>Rides</h3>
              <Link href="/rides">How Velocity Rides works</Link>
              <Link href="/rides#earn">Drive with Velocity Rides</Link>
              <Link href="/rides#safety">Safety</Link>
              <a href={PLAY_URL} target="_blank" rel="noreferrer">
                Google Play
              </a>
            </div>

            <div className={styles.footerCol}>
              <h3>Company</h3>
              <a href={FACEBOOK_URL} target="_blank" rel="noreferrer">
                Facebook
              </a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">
                Instagram
              </a>
              <a href="mailto:business@velocityrides.app">business@velocityrides.app</a>
            </div>
          </div>

          <div className={styles.footerBase}>
            <span>
              © {new Date().getFullYear()} Velocity. Velocity Rides and Velocity Studio are products of{' '}
              <a className={styles.footerOwner} href="https://berreto.com" target="_blank" rel="noreferrer">
                Berreto (Private) Limited
              </a>
              .
            </span>
            <span className={styles.footerLegal}>
              <a href={PRIVACY_URL}>Privacy</a>
              <a href={TERMS_URL}>Terms</a>
              <a href={DELETE_ACCOUNT_URL}>Delete your account</a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
