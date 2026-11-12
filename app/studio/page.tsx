import type { Metadata } from 'next';
import Link from 'next/link';

import { VelocityMark } from '@/components/BrandMark';
import { ArrowRight, Clock, Handshake, Megaphone, Mic, Sparkle, TrendingUp } from '@/components/site/Icons';
import { Vexa } from '@/components/site/Assistant';
import { SoundToggle } from '@/components/site/siteSound';
import { STUDIO_FAQ, StudioFaq, StudioPricing } from '@/components/site/StudioSections';
import { StudioScrub } from '@/components/site/StudioScrub';
import { StudioStory } from '@/components/site/StudioStory';
import { STUDIO_FROM_USD, STUDIO_TRIAL_HOURS, STUDIO_TRIAL_USD, studioUsd } from '@/lib/studio';
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
 * below says what public/legal/privacy-policy.html §14 says.
 */

export const metadata: Metadata = {
  title: { absolute: 'Vexa — Your Social Media Virtual Assistant' },
  description:
    `Connect Instagram and Facebook and Vexa plans your month, makes reels with voice-over and music, posts every day, runs your Meta ads and finds you customers. From $${STUDIO_FROM_USD} a month.`,
  // /vexa and /studio are the same page; the policy and TikTok's app form name /vexa, so that is the one.
  alternates: { canonical: '/vexa' },
  openGraph: {
    title: 'Vexa — you don’t need a social media team anymore',
    description: 'Connect your account and watch Vexa plan, make, post, advertise and sell for you.',
    url: '/vexa',
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

/**
 * Vexa's privacy policy, on the page.
 *
 * Every line here is what public/legal/privacy-policy.html already says about
 * Vexa (§14, and §13 for the companies involved) — the policy document stays
 * the full one, covering the ride app too, and is linked under this section.
 * Change one and change the other, or Meta and TikTok will be reading two
 * different promises.
 */
const POLICY_EFFECTIVE = '9 November 2026';

const POLICY = [
  {
    t: 'Who you are dealing with',
    d: 'Vexa is operated by Berreto (Private) Limited, the company behind Velocity Rides, in Pakistan. It is the company responsible for the data described here. Write to business@velocityrides.app about anything on this page.',
  },
  {
    t: 'What you give us',
    d: 'Your email address, your business name and a short description of your business, its customers, market and language. If you pay, the transaction ID or the receipt screenshot you send.',
  },
  {
    t: 'Facebook & Instagram',
    d: 'When you connect your accounts with Facebook Login we receive an access token for the Facebook Page and Instagram professional account you choose, and — only if you connect the ads desk — your Meta ad account. We use them only to do what you ask: publish the posts and reels the service makes, read and answer comments on them, read your posts’ performance and your profile to improve future posts, and create, read and manage the ad campaigns you approve. Tokens are stored encrypted on our servers and are never shown to anyone, including you.',
  },
  {
    t: 'TikTok',
    d: 'Continue with TikTok allows two things: your basic profile, and posting videos. We store your display name, profile picture, @username, the user ID TikTok issues for our app, and an access token, so we can show which account is connected and post for you. Each time you open the Post to TikTok screen we read your account’s posting options (the privacy levels open to you, whether comments, Duet and Stitch are on, and the longest video you can post); we show them there and do not keep them. We send TikTok only the video you are looking at, with the title, privacy, interaction and commercial-content choices you made on that screen, and only after you press Post to TikTok. We keep TikTok’s answer for that post so we can show you the result. We do not read your followers, your messages, your other videos or their statistics.',
  },
  {
    t: 'TikTok Ads',
    d: 'Only if you connect it: we receive an access token for the ad accounts you allow and store the name, ID and currency of the one you choose. It is used to upload the video for an ad and to create, read and manage the campaigns you approve, including their spend, clicks and impressions. The token is stored encrypted.',
  },
  {
    t: 'The sales agent and your mailbox',
    d: 'If you use it, we store the businesses it finds (from public maps and websites) and the emails it writes. If you connect a mailbox, its app password is stored encrypted and used only to send the emails you approved and the follow-ups you allowed, and to read replies from the businesses it wrote to. The inbox is opened read-only: only messages from those businesses are read, nothing is marked read, moved or deleted, and we keep the text of their reply so an answer can be drafted for you.',
  },
  {
    t: 'Market analysis',
    d: 'Anything you type about your business, and the public pages you give us links to, are read to analyse your market and are kept in your workspace.',
  },
  {
    t: 'The pricing timer',
    d: 'Each visitor gets their own time at the current price. To count it we store when it started against your account if you are signed in, and otherwise against a one-way hash of your IP address. We do not store the address itself or use the hash for anything else.',
  },
  {
    t: 'How the writing is done',
    d: 'Your business description, what you tell us, your posts’ text, the replies your leads send and public market information are sent to Google Gemini to write and plan content. We do not send rider or driver data, and we do not sell your data.',
  },
  {
    t: 'Paying',
    d: 'Card payments are taken by Stripe on Stripe’s own page — we never see, handle or store your card number. If you pay by bank transfer, what we keep is the transaction ID or the screenshot you upload as proof.',
  },
  {
    t: 'What you can switch off',
    d: 'Disconnect an account at any time from Connected accounts, which deletes its stored token; the account’s name and picture stay in your workspace until the workspace is deleted. You can also remove our app from Facebook at Settings → Business Integrations, and from the connected apps in your TikTok settings.',
  },
  {
    t: 'Deleting everything',
    d: 'Email business@velocityrides.app from the address you signed up with to delete your Vexa workspace and everything in it. We delete it within 30 days, except records the law requires us to keep.',
  },
  {
    t: 'Who else sees it',
    d: 'Google Firebase (hosting and storage), Google Gemini (writing and research), Meta (Facebook and Instagram), TikTok (posting and ads) and Stripe (card payments). Each has its own privacy policy, listed in the full document below.',
  },
  {
    t: 'Children',
    d: 'Vexa is for businesses and for people aged 18 and over. We do not knowingly collect anything from children.',
  },
  {
    t: 'Changes',
    d: `When this policy changes we revise the effective date above. It last changed on ${POLICY_EFFECTIVE}.`,
  },
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
    <main className={site.site}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <header className={s.topBar}>
        <div className={`${site.wrap} ${s.topInner}`}>
          <Link href="/vexa" className={s.topBrand}>
            <VelocityMark size={30} />
            Vexa
          </Link>
          <nav className={s.topLinks} aria-label="Vexa">
            <a href="#how-it-works" className={s.topHide}>
              How it works
            </a>
            <a href="#pricing" className={s.topHide}>
              Pricing
            </a>
            <a href="#privacy" className={s.topHide}>
              Privacy
            </a>
            <Link href="/studio/login">Log in</Link>
            <Link href="/studio/signup" className={`${site.btn} ${site.btnLime} ${s.topCta}`}>
              Try a day
            </Link>
            {/* The scroll film and the story below are narrated; this is the page's one mute. */}
            <SoundToggle className={s.topSound} />
          </nav>
        </div>
      </header>

      <section className={s.hero}>
        <div className={s.heroGlow} aria-hidden />
        <div className={`${site.wrap} ${s.heroGrid}`}>
          <div>
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

      {/* The film that plays as you scroll, then the five jobs acted out in a mock of the console. */}
      <StudioScrub />
      <StudioStory />

      <section id="how" className={`${site.section} ${site.light}`}>
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

      <StudioPricing />
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
            <a href="/terms" style={{ textDecoration: 'underline' }}>
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
              Effective {POLICY_EFFECTIVE} · Berreto (Private) Limited · business@velocityrides.app
            </p>
          </div>
          <div className={s.policy}>
            {POLICY.map((p) => (
              <article key={p.t} className={s.policyItem}>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </article>
            ))}
          </div>
          <p className={s.policyMore}>
            This is Vexa’s part of the policy. The full document, which also covers the Velocity Rides app, is at{' '}
            <a href="/privacy">velocityrides.app/privacy</a> — see <a href="/terms">Terms of Service</a> and{' '}
            <a href="/support">Support</a>.
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
            <a href="/terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="/support">Support</a> ·{' '}
            <a href="mailto:business@velocityrides.app">business@velocityrides.app</a>
          </span>
        </div>
      </footer>
      <Vexa />
    </main>
  );
}
