import type { Metadata } from 'next';
import Link from 'next/link';

import { VelocityMark } from '@/components/BrandMark';
import { HeroSlider, type HeroSlide } from '@/components/site/HeroSlider';
import { Reveal } from '@/components/site/Reveal';
import { SiteNav } from '@/components/site/SiteNav';
import { StudioStory } from '@/components/site/StudioStory';
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
 * is the studio: how it works (one story in five numbered steps, acted out in a
 * mock of the console and read by a narrator on request), then the prices, then
 * the questions. The ride app's own long page lives at /rides, linked from its
 * slide.
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
  { href: '/studio/login', label: 'Log in' },
  { href: '/studio/signup', label: 'Start free' },
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
          <Link href="/studio/signup" className={`${styles.btn} ${styles.btnLime}`}>
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

        <StudioStory />

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
                  <Link href="/studio/signup" className={`${styles.btn} ${styles.btnLime}`}>
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
              <Link href="/studio/signup">Start free</Link>
              <Link href="/studio/login">Log in</Link>
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
