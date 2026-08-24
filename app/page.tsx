import { VelocityMark } from '@/components/BrandMark';
import { ScreenBook, ScreenEarn, ScreenTrip } from '@/components/site/AppScreens';
import { PhoneShowcase } from '@/components/site/PhoneShowcase';
import { Reveal } from '@/components/site/Reveal';
import { SiteNav } from '@/components/site/SiteNav';
import { SpeedStage } from '@/components/site/SpeedStage';
import {
  AppleMark,
  BadgeCheck,
  Banknote,
  Bell,
  Bolt,
  Car,
  Check,
  Clock,
  Gauge,
  GooglePlay,
  Handshake,
  MapPin,
  Megaphone,
  Mic,
  Navigation,
  Package,
  Plus,
  Route,
  Shield,
  Sparkle,
  TrendingUp,
  Users,
  Wallet,
} from '@/components/site/Icons';
import styles from '@/components/site/site.module.css';
import {
  SITE_URL as SITE,
  PRIVACY_URL,
  TERMS_URL,
  DELETE_ACCOUNT_URL,
  SOCIAL_PROFILES,
  FACEBOOK_URL,
  INSTAGRAM_URL,
} from '@/lib/site';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.velocityridzpk.app';

/** Store badge — Play links out, Apple is honestly marked as not shipped yet. */
function StoreBadge({ variant }: { variant: 'play' | 'ios' }) {
  if (variant === 'ios') {
    return (
      <span className={`${styles.store} ${styles.storeSoon}`}>
        <AppleMark />
        <span className={styles.storeText}>
          <small>Coming soon to</small>
          <strong>the App Store</strong>
        </span>
      </span>
    );
  }
  return (
    <a className={styles.store} href={PLAY_URL} target="_blank" rel="noreferrer">
      <GooglePlay />
      <span className={styles.storeText}>
        <small>Get it on</small>
        <strong>Google Play</strong>
      </span>
    </a>
  );
}

const SERVICES = [
  {
    icon: MapPin,
    tag: 'Everyday',
    title: 'City rides',
    body: 'Point to point across your city. Choose your vehicle, offer your fare, and pay in cash or from your wallet.',
  },
  {
    icon: Users,
    tag: 'Save up to 65%',
    title: 'Pooled rides',
    body: 'Share the car with people already going your way. Two riders pay 60% of the solo fare each, three pay 40%, four pay 35%.',
  },
  {
    icon: Route,
    tag: 'Intercity',
    title: 'City to City',
    body: 'Book a seat on a scheduled intercity trip — AC, business, coaster or Hiace — with pickup and drop-off points published up front.',
  },
  {
    icon: Package,
    tag: 'Same city',
    title: 'Couriers',
    body: 'Send a document, a parcel or a box across town. Name the fare, track the status, and the recipient gets a call on arrival.',
  },
  {
    icon: Car,
    tag: 'By the day',
    title: 'Special Rides',
    body: 'Rent a car by the day, with or without a driver — or list your own vehicle and let it earn while you are not using it.',
  },
  {
    icon: Handshake,
    tag: 'Community',
    title: 'Travel Partner',
    body: 'Find people who make the same commute you do, form groups, split the cost, and follow what is happening in your city.',
  },
];

const FEATURES = [
  {
    icon: Mic,
    title: 'Book by speaking',
    body: 'Say where you are going in Urdu-English the way you actually speak it. It runs entirely on your phone — no server, no data cost, works with the network down.',
  },
  {
    icon: Banknote,
    title: 'Cash is a first-class citizen',
    body: 'No card, no top-up, no minimum balance. Pay the driver at the end of the ride, exactly like you always have.',
  },
  {
    icon: Navigation,
    title: 'A map that shows the city',
    body: 'See anonymised supply and demand around you before you book — where the cars are and where people are asking for rides.',
  },
  {
    icon: BadgeCheck,
    title: 'Every driver verified',
    body: 'CNIC, licence and vehicle documents are checked by a real person before a driver can accept a single ride.',
  },
  {
    icon: Bell,
    title: 'Told before you ask',
    body: 'Driver assigned, driver arriving, fare settled, dispute resolved — push notifications that arrive with the app closed.',
  },
  {
    icon: Wallet,
    title: 'Money you can see',
    body: 'Every fare, commission and settlement is written by the backend, not the app — so what you are shown is what actually happened.',
  },
];

const EARN = [
  {
    icon: Car,
    title: 'Drive',
    body: 'Bring your car or bike, get your documents approved, and start accepting rides. See a heat map of where demand is, and settle your earnings on your own schedule.',
    points: ['Cash collected stays with you', 'Live demand heat map', 'Two-way ratings'],
  },
  {
    icon: Wallet,
    title: 'Rent out your car',
    body: 'List a vehicle on Special Rides and let it earn by the day, with or without you driving it. You set the rate, the days and the rules.',
    points: ['With or without a driver', 'You set the daily rate', 'Renters are CNIC-verified'],
  },
  {
    icon: Megaphone,
    title: 'Advertise your shop',
    body: 'Find your Customers puts your offer on the phones of people who pass your door — and you can send yourself a sample notification before you spend a rupee.',
    points: ['Paid radius around your shop', 'See the ad on your own phone first', 'No daily-limit cost to test'],
  },
];

const FAQS = [
  {
    q: 'Do I need a card or a bank account?',
    a: 'No. Cash is a full payment method on Velocity, not a fallback. You book, you ride, you pay the driver at the end. A wallet is there if you want it, but nothing requires it.',
  },
  {
    q: 'How does pooling actually save money?',
    a: 'The fare for the trip is worked out once, then split by how many people are in the car. On your own you pay 100%. With two riders you each pay 60%, with three 40%, and with four 35% — so a full car costs each person about a third of the solo fare.',
  },
  {
    q: 'Can I choose what to pay?',
    a: 'You offer a fare when you book, and drivers nearby decide whether to take it. The fare engine on the server sets the bounds so nobody can offer something that would not cover the trip.',
  },
  {
    q: 'What happens if something goes wrong mid-ride?',
    a: 'There is an SOS button inside the trip. It raises a safety event that lands live on a staffed safety desk, along with your location if you share it. Route deviations can be flagged the same way, and every co-rider added to a pool mid-trip is visible to you.',
  },
  {
    q: 'Is Velocity on iPhone?',
    a: 'Velocity is on Google Play for Android today. The iOS build is in progress — the app is one codebase, so it is a release step rather than a rewrite.',
  },
  {
    q: 'Which cities does it cover?',
    a: 'Velocity is built for Pakistan and works wherever there are drivers signed up nearby. Intercity seats run between the cities operators have published trips for, and you can see the list inside the app before you book.',
  },
];

/**
 * Structured data is generated from the same constants the page renders, so the
 * markup and the schema can never drift apart. Deliberately no aggregateRating
 * or install count: neither is verified, and inventing them is both a Google
 * policy violation and a lie to the reader.
 */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE}#org`,
      name: 'Velocity',
      url: SITE,
      logo: `${SITE}/app/icon.png`,
      areaServed: { '@type': 'Country', name: 'Pakistan' },
      sameAs: SOCIAL_PROFILES,
    },
    {
      '@type': 'MobileApplication',
      name: 'Velocity',
      operatingSystem: 'Android',
      applicationCategory: 'TravelApplication',
      installUrl: PLAY_URL,
      publisher: { '@id': `${SITE}#org` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'PKR' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
};

export default function Home() {
  return (
    <div className={styles.site} id="top">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <SiteNav playUrl={PLAY_URL} />

      <main>
        {/* ── hero ──────────────────────────────────────────────────────── */}
        <section className={styles.hero}>
          <div className={styles.wrap}>
            <div className={styles.heroGrid}>
              <Reveal className={styles.heroCopy}>
                <span className={styles.eyebrow}>
                  <Bolt />
                  Built for Pakistan
                </span>

                <h1 className={styles.heroTitle}>
                  Your city.
                  <br />
                  <em>Your fare.</em>
                  <br />
                  Your Velocity.
                </h1>

                <p className={styles.lead}>
                  Offer what the ride is worth to you, split it with people going the same way, and
                  pay in cash. City rides, intercity seats and couriers — one app, one account.
                </p>

                <div className={styles.heroActions}>
                  <StoreBadge variant="play" />
                  <StoreBadge variant="ios" />
                </div>

                <p className={styles.heroNote}>
                  <Check />
                  Free to download · Free to join as a driver
                </p>

                <div className={styles.trustRow}>
                  <span className={styles.trustItem}>
                    <Banknote />
                    Cash accepted
                  </span>
                  <span className={styles.trustItem}>
                    <BadgeCheck />
                    Verified drivers
                  </span>
                  <span className={styles.trustItem}>
                    <Shield />
                    In-app SOS
                  </span>
                </div>
              </Reveal>

              <div className={styles.heroArt}>
                <span className={styles.heroGlow} aria-hidden="true" />
                <div className={styles.heroPhoneStack}>
                  <div
                    className={styles.phone}
                    role="img"
                    aria-label="The Velocity booking screen: a route pinned on the map, with a fare of 480 rupees offered and a Find a driver button."
                  >
                    <span className={styles.notch} aria-hidden="true" />
                    <div className={styles.phoneScreen}>
                      <ScreenBook />
                    </div>
                  </div>

                  <div className={`${styles.floatCard} ${styles.floatA}`}>
                    <span className={styles.floatIcon}>
                      <Users />
                    </span>
                    <span>
                      <b>3 riders matched</b>
                      <span>Everyone pays 40%</span>
                    </span>
                  </div>

                  <div className={`${styles.floatCard} ${styles.floatB}`}>
                    <span className={styles.floatIcon}>
                      <Clock />
                    </span>
                    <span>
                      <b>Driver 2 min away</b>
                      <span>Tracked live on the map</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── facts strip ───────────────────────────────────────────────── */}
        <section className={styles.sectionTight}>
          <div className={styles.wrap}>
            <Reveal className={styles.statStrip}>
              <div className={styles.stat}>
                <span className={styles.statNum}>35%</span>
                <span className={styles.statLabel}>of the solo fare, each, in a four-person pool</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statNum}>6</span>
                <span className={styles.statLabel}>ways to travel or send something in one app</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statNum}>0</span>
                <span className={styles.statLabel}>cards required — cash is a full payment method</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statNum}>24/7</span>
                <span className={styles.statLabel}>SOS and route-deviation alerts to a staffed desk</span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── the scroll story ──────────────────────────────────────────── */}
        <SpeedStage />

        {/* ── how it works ──────────────────────────────────────────────── */}
        <section className={`${styles.section} ${styles.mistBg}`} id="how">
          <div className={styles.wrap}>
            <Reveal className={`${styles.sectionHead} ${styles.center}`}>
              <span className={styles.eyebrow}>
                <Gauge />
                How it works
              </span>
              <h2 className={styles.h2}>
                From <span className={styles.accent}>&ldquo;where to?&rdquo;</span> to on your way
              </h2>
              <p className={styles.lead}>
                No haggling on the street, no waiting to find out the price. The whole trip is decided
                before the car moves.
              </p>
            </Reveal>

            <div className={styles.steps}>
              {[
                {
                  t: 'Say where you are going',
                  b: 'Type it, pick it off the map, or just say it out loud. Saved places and your recent trips are one tap away.',
                },
                {
                  t: 'Choose solo or pooled, and name your fare',
                  b: 'See what a pool would save you before you commit, then offer the fare you think the trip is worth.',
                },
                {
                  t: 'Ride, tracked the whole way',
                  b: 'Your driver appears on the map, the trip is shareable, and the fare settles the moment you arrive.',
                },
              ].map((s, i) => (
                <Reveal key={s.t} delay={i * 90} className={styles.step}>
                  <h3>{s.t}</h3>
                  <p>{s.b}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── services ──────────────────────────────────────────────────── */}
        <section className={styles.section} id="services">
          <div className={styles.wrap}>
            <Reveal className={styles.sectionHead}>
              <span className={styles.eyebrow}>
                <Sparkle />
                One app, six ways to move
              </span>
              <h2 className={styles.h2}>
                Everything that needs to get
                <br />
                across town — or across the country
              </h2>
              <p className={styles.lead}>
                Velocity is not only a taxi app. The same account books your morning commute, your
                seat to Lahore, and the parcel that has to be there by five.
              </p>
            </Reveal>

            <div className={styles.cardGrid}>
              {SERVICES.map((s, i) => {
                const Ico = s.icon;
                return (
                  <Reveal key={s.title} delay={(i % 3) * 80} className={styles.card}>
                    <span className={styles.cardIcon}>
                      <Ico />
                    </span>
                    <span className={styles.tag}>{s.tag}</span>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── the app itself ────────────────────────────────────────────── */}
        <section className={`${styles.section} ${styles.dark}`} id="app">
          <div className={styles.wrap}>
            <Reveal className={styles.sectionHead}>
              <span className={styles.eyebrow}>
                <Bolt />
                The app
              </span>
              <h2 className={styles.h2}>
                It all happens on <span className={styles.accent}>your phone</span>
              </h2>
              <p className={styles.lead}>
                Velocity is a mobile app — there is no web booking. Here is what you actually do in
                it, screen by screen.
              </p>
            </Reveal>

            <PhoneShowcase />
          </div>
        </section>

        {/* ── feature grid ──────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.wrap}>
            <Reveal className={styles.sectionHead}>
              <span className={styles.eyebrow}>
                <Check />
                Why it feels different
              </span>
              <h2 className={styles.h2}>Small things, done properly</h2>
            </Reveal>

            <div className={styles.cardGrid}>
              {FEATURES.map((f, i) => {
                const Ico = f.icon;
                return (
                  <Reveal key={f.title} delay={(i % 3) * 80} className={styles.card}>
                    <span className={styles.cardIcon}>
                      <Ico />
                    </span>
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Earn with Velocity — the partner program, as its own feature ── */}
        <section className={`${styles.section} ${styles.dark}`} id="earn">
          <div className={styles.wrap}>
            <div className={`${styles.split} ${styles.splitReverse}`}>
              <Reveal className={styles.splitCopy}>
                <span className={styles.eyebrow}>
                  <TrendingUp />
                  Earn with Velocity
                </span>
                <h2 className={styles.h2}>
                  Build a transport business
                  <br />
                  without <span className={styles.accent}>owning a car</span>
                </h2>
                <p className={styles.lead}>
                  Recruit drivers and riders onto Velocity, run them as your fleet, and take a share
                  of what Velocity earns from every ride they complete. One five-digit code builds
                  both fleets — a driver who redeems it joins your driver fleet, a passenger joins
                  your rider fleet.
                </p>

                <p className={styles.ruleNote}>
                  <Shield />
                  <span>
                    <b>You earn a share of Velocity&apos;s commission, never of the fare.</b> On a
                    Rs 1,000 ride with a 10% commission, a 2% Pro rate pays you Rs 2 — 2% of the
                    Rs 100 commission, not of the fare. The fare belongs to the driver.
                  </span>
                </p>

                <div className={styles.tiers}>
                  <span className={styles.tierHead}>
                    <b />
                    <b>Free</b>
                    <b className={styles.tierPro}>Pro</b>
                  </span>
                  <span className={styles.tierRow}>
                    <small>Driver fleet</small>
                    <em>0.5%</em>
                    <em className={styles.tierPro}>2%</em>
                  </span>
                  <span className={styles.tierRow}>
                    <small>Rider fleet</small>
                    <em>0.5%</em>
                    <em className={styles.tierPro}>1.3%</em>
                  </span>
                  <span className={styles.tierRow}>
                    <small>Costs you</small>
                    <em>Nothing</em>
                    <em className={styles.tierPro}>Rs 4,500/mo</em>
                  </span>
                </div>

                <div className={styles.checkList}>
                  {[
                    ['Installs pay you nothing', 'only rides that actually complete do'],
                    ['Withdraw from Rs 500', 'after a 72-hour hold that catches fraud'],
                    ['A dashboard, not a promise', 'fleet, revenue and analytics, live in the app'],
                  ].map(([b, t]) => (
                    <span key={b} className={styles.checkItem}>
                      <Check />
                      <span>
                        <b>{b}</b> — <span>{t}</span>
                      </span>
                    </span>
                  ))}
                </div>

                <a className={`${styles.btn} ${styles.btnLime}`} href={PLAY_URL} target="_blank" rel="noreferrer">
                  <GooglePlay />
                  Start earning
                </a>
              </Reveal>

              <Reveal delay={120} className={styles.splitArt}>
                <div
                  className={styles.phone}
                  role="img"
                  aria-label="The Earn with Velocity dashboard: 18,420 rupees earned this month, a fleet of 24 drivers and 186 riders, and the fleet code 48213."
                >
                  <span className={styles.notch} aria-hidden="true" />
                  <div className={styles.phoneScreen}>
                    <ScreenEarn />
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── the other routes to income ────────────────────────────────── */}
        <section className={`${styles.section} ${styles.dark}`}>
          <div className={styles.wrap}>
            <Reveal className={styles.sectionHead}>
              <span className={styles.eyebrow}>
                <Sparkle />
                Other ways to earn
              </span>
              <h2 className={styles.h2}>
                Velocity is not only for
                <br />
                the people <span className={styles.accent}>taking rides</span>
              </h2>
            </Reveal>

            <div className={styles.cardGrid}>
              {EARN.map((e, i) => {
                const Ico = e.icon;
                return (
                  <Reveal key={e.title} delay={i * 90} className={styles.card}>
                    <span className={styles.cardIcon}>
                      <Ico />
                    </span>
                    <h3>{e.title}</h3>
                    <p>{e.body}</p>
                    <div className={styles.checkList}>
                      {e.points.map((pt) => (
                        <span key={pt} className={styles.checkItem}>
                          <Check />
                          <span>{pt}</span>
                        </span>
                      ))}
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── safety ────────────────────────────────────────────────────── */}
        <section className={`${styles.section} ${styles.mistBg}`} id="safety">
          <div className={styles.wrap}>
            <div className={styles.split}>
              <Reveal className={styles.splitCopy}>
                <span className={styles.eyebrow}>
                  <Shield />
                  Safety
                </span>
                <h2 className={styles.h2}>
                  Nobody gets in a car
                  <br />
                  they know nothing about
                </h2>
                <p className={styles.lead}>
                  Safety on Velocity is not a page in the settings. It is a set of checks that run
                  before the ride, during it, and after it.
                </p>

                <div className={styles.checkList}>
                  {[
                    ['Documents checked by a person', 'CNIC, licence and vehicle papers are reviewed and approved before a driver can take a ride.'],
                    ['SOS that reaches somebody', 'The button inside the trip raises a live alert on a staffed safety desk, with your location if you share it.'],
                    ['Route deviation flagging', 'If the trip stops making sense, you can say so from the same screen, and it lands in the same place.'],
                    ['Who is in the car, always', 'Every co-rider added to a pool mid-trip is shown to you, and pools carry gender rules you set before you join.'],
                    ['Ratings both ways', 'Passengers rate drivers and drivers rate passengers, and repeated reports are acted on.'],
                  ].map(([b, s]) => (
                    <span key={b} className={styles.checkItem}>
                      <Shield />
                      <span>
                        <b>{b}</b> — <span>{s}</span>
                      </span>
                    </span>
                  ))}
                </div>
              </Reveal>

              <Reveal delay={120} className={styles.splitArt}>
                <div
                  className={styles.phone}
                  role="img"
                  aria-label="The Velocity live trip screen: the driver tracked on the map, their name, rating and plate, and an SOS button."
                >
                  <span className={styles.notch} aria-hidden="true" />
                  <div className={styles.phoneScreen}>
                    <ScreenTrip />
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── FAQ (plain <details> — no JavaScript needed) ───────────────── */}
        <section className={styles.section}>
          <div className={styles.wrap}>
            <Reveal className={`${styles.sectionHead} ${styles.center}`}>
              <span className={styles.eyebrow}>
                <Plus />
                Questions
              </span>
              <h2 className={styles.h2}>The things people ask first</h2>
            </Reveal>

            <div className={styles.faq}>
              {FAQS.map((f, i) => (
                <Reveal key={f.q} delay={i * 50}>
                  <details className={styles.faqItem}>
                    <summary className={styles.faqQ}>
                      {f.q}
                      <Plus />
                    </summary>
                    <p className={styles.faqA}>{f.a}</p>
                  </details>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── climax CTA ────────────────────────────────────────────────── */}
        <section className={styles.sectionTight}>
          <div className={styles.wrap}>
            <Reveal className={styles.ctaBand}>
              <span className={styles.ctaStripes} aria-hidden="true" />
              <span className={styles.eyebrow}>
                <Bolt />
                Get moving
              </span>
              <h2>Your next ride is one download away</h2>
              <p>
                Velocity is free to install and free to join as a driver. Scan the store, sign in with
                your phone number, and book the first thing you need today.
              </p>
              <div className={styles.ctaActions}>
                <StoreBadge variant="play" />
                <StoreBadge variant="ios" />
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* Small screens get a persistent way to install without scrolling back
          up — this is an app landing page, and the app is the conversion. */}
      <div className={styles.mobileBar}>
        <span className={styles.brandMark}>
          <VelocityMark style={{ color: '#ccff00' }} />
        </span>
        <span className={styles.mobileBarText}>
          <strong>Get Velocity</strong>
          <span>Free on Google Play</span>
        </span>
        <a className={`${styles.btn} ${styles.btnLime}`} href={PLAY_URL} target="_blank" rel="noreferrer">
          Install
        </a>
      </div>

      {/* ── footer ──────────────────────────────────────────────────────── */}
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
              <p style={{ fontSize: 15.5, lineHeight: 1.6 }}>
                Ride-hailing, pooling, intercity seats and couriers, built for Pakistan. Available on
                Google Play.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <StoreBadge variant="play" />
              </div>
            </div>

            <div className={styles.footerCol}>
              <h3>Ride</h3>
              <a href="#how">How it works</a>
              <a href="#services">City rides</a>
              <a href="#services">Pooled rides</a>
              <a href="#services">City to City</a>
              <a href="#services">Couriers</a>
            </div>

            <div className={styles.footerCol}>
              <h3>Earn</h3>
              <a href="#earn">Drive with Velocity</a>
              <a href="#earn">Partner Program</a>
              <a href="#earn">Special Rides</a>
              <a href="#earn">Advertise your shop</a>
            </div>

            <div className={styles.footerCol}>
              <h3>Company</h3>
              <a href="#safety">Safety</a>
              <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
                Privacy policy
              </a>
              <a href={TERMS_URL} target="_blank" rel="noreferrer">
                Terms of service
              </a>
              <a href={DELETE_ACCOUNT_URL} target="_blank" rel="noreferrer">
                Delete your account
              </a>
              <a href={FACEBOOK_URL} target="_blank" rel="noreferrer">
                Facebook
              </a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">
                Instagram
              </a>
            </div>
          </div>

          <div className={styles.footerBottom}>
            <span>© {new Date().getFullYear()} Velocity. All rights reserved.</span>
            <span>Made in Pakistan.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
