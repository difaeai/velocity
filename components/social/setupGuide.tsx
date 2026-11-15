'use client';

/**
 * "How do I connect it?" — the instructions, in the console, next to the button.
 *
 * Connecting an account is the one job on this desk that happens somewhere else:
 * on Facebook, in a Google account, inside WhatsApp Business. Every one of them
 * has a page the owner has to find, a switch they have to turn on, and a word
 * for it that is not the word we use. Sending them off to "check the docs" is
 * where most of them stop paying.
 *
 * So each connector carries its own guide: what you need before you start, the
 * steps in order, in plain sentences, and what goes wrong most often. It opens
 * in a sheet beside the card — never a new tab, because a new tab is where the
 * person was already lost.
 *
 * Two audiences, one guide. A Vexa customer is told to press Connect and sign
 * in, because that is all they will ever do. The lines about tokens, app ids
 * and secrets are marked `admin` and are shown only on Velocity's own console,
 * where somebody actually has to paste them.
 */

import { useEffect, useRef, useState } from 'react';

export interface GuideStep {
  /** The line itself. Keep it one instruction. */
  text: string;
  /** Only Velocity's own console shows this step. */
  admin?: boolean;
}

export interface Guide {
  title: string;
  /** One line: what connecting this actually buys them. */
  why: string;
  /** What they must already have. Checked off before the steps. */
  need: string[];
  steps: GuideStep[];
  /** The thing that goes wrong most, and what to do about it. */
  gotcha?: string;
  minutes: number;
}

export type GuideKey =
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'tiktok'
  | 'whatsapp'
  | 'meta-ads'
  | 'google-ads'
  | 'tiktok-ads'
  | 'store'
  | 'email'
  | 'token';

export const GUIDES: Record<GuideKey, Guide> = {
  instagram: {
    title: 'Instagram',
    why: 'Vexa posts your reels, carousels and stories here, reads the comments and answers them.',
    need: [
      'An Instagram account that is a Business or Creator account, not a personal one',
      'That Instagram linked to a Facebook Page you manage',
    ],
    minutes: 3,
    steps: [
      { text: 'On Instagram: Settings → Account type and tools → Switch to professional account. Pick Business. Skip this if it already says Professional.' },
      { text: 'Still in Instagram: Settings → Linked accounts (or Account Centre) → connect the Facebook Page for your business. Instagram will not let anything post until it is linked to a Page.' },
      { text: 'Come back here and press Connect with Facebook. Sign in as the person who manages that Page.' },
      { text: 'When Facebook asks which Pages to allow, tick your Page. If you untick it, nothing can post.' },
      { text: 'Allow every permission it asks for. Each one is a thing you are asking Vexa to do — posting, reading comments, reading your numbers.' },
      { text: 'Pick your Instagram account from the list, and you are done.' },
    ],
    gotcha:
      'The commonest failure is a personal Instagram account. Facebook shows the sign-in, everything looks fine, and then no account appears in the list. Switch it to a Business account and connect again.',
  },
  facebook: {
    title: 'Facebook Page',
    why: 'Vexa posts to your Page, replies to comments underneath, and this is also the Page your ads run as.',
    need: ['A Facebook Page for your business', 'Your own Facebook login with admin on that Page'],
    minutes: 2,
    steps: [
      { text: 'Press Connect with Facebook and sign in as yourself, not as the Page. Facebook always wants the person.' },
      { text: 'Tick your Page in the list it shows. If you have several, tick the one you actually post from.' },
      { text: 'Allow the permissions. Posting and reading comments are the two that matter.' },
      { text: "Check the card says 'Connected as' and your Page's name. That name is what customers will see." },
    ],
    gotcha:
      'If your Page is owned by a Business Manager, you need a Page admin role in there — being an admin of the Business is not the same thing, and Facebook will simply not list the Page.',
  },
  youtube: {
    title: 'YouTube',
    why: 'Every reel Vexa makes also goes up as a YouTube Short, and the comments come back to your Comments page.',
    need: ['A YouTube channel', 'The Google account that owns it'],
    minutes: 2,
    steps: [
      { text: 'Press Continue with Google and sign in with the account that owns the channel.' },
      { text: 'If that Google account has more than one channel, Google lists them — pick the right one carefully, there is no undo that is not a reconnect.' },
      { text: 'Allow upload access. Without it Vexa can read the channel but never post to it.' },
      { text: 'Running YouTube ads as well? Those go through Google Ads, which is a separate connection.' },
      { admin: true, text: 'Admin: YouTube uses the Google OAuth client saved on the Google Ads card. Set that up first or the popup will not open.' },
    ],
    gotcha: 'A brand channel usually needs the Google account that manages it, not the one that created it years ago.',
  },
  tiktok: {
    title: 'TikTok',
    why: 'Reels go up as TikTok videos through the official posting API.',
    need: ['A TikTok account', 'The app on your phone, to approve the sign-in'],
    minutes: 2,
    steps: [
      { text: 'Press Continue with TikTok. A TikTok window opens.' },
      { text: 'Sign in and approve the permissions — posting video and reading your basic profile.' },
      { text: 'TikTok sends you back here and the card turns green.' },
      { admin: true, text: 'Admin: the TikTok app key and secret are stored once on this console. A customer never sees that form.' },
    ],
    gotcha:
      'TikTok reviews new posting apps. While that review is pending, posts can land as private drafts in your TikTok inbox instead of going live — open the app and publish them from there.',
  },
  whatsapp: {
    title: 'WhatsApp — where Vexa closes the sale',
    why: 'Vexa answers your WhatsApp from your own number: price questions, booking, following up — and hands the chat to you the moment it should be a person.',
    need: [
      'A phone number that is NOT currently on the normal WhatsApp or WhatsApp Business app',
      'A Facebook Business account',
    ],
    minutes: 10,
    steps: [
      { text: 'Go to business.facebook.com and open your business. If you do not have one, make it — it is free and takes a minute.' },
      { text: 'In the left menu: WhatsApp accounts → Add → follow it through. This creates a WhatsApp Business Account (a WABA).' },
      { text: 'Add your phone number to it and verify it with the code they send. Use a number you can keep: moving it later is a job.' },
      { text: 'Open the number in the list and copy its Phone number ID. It is a long row of digits, and it is not the phone number itself.' },
      { text: 'Generate an access token for it and copy that too. Facebook shows a token once, so copy it before you close the window.' },
      { text: 'Paste both here and press Connect. Vexa checks them with WhatsApp before it stores anything, so a wrong paste fails now, not at a customer.' },
      { text: 'Last: submit a message template for approval, so Vexa may also write first to people who asked to hear from you. Replies to people who messaged you never need one.' },
    ],
    gotcha:
      'A number already signed into the WhatsApp or WhatsApp Business app cannot be added — WhatsApp refuses it. Use a second number, or remove it from the app first and accept that the old chats stay on that phone.',
  },
  'meta-ads': {
    title: 'Meta ads (Facebook & Instagram)',
    why: 'The Ad Expert plans the campaign with you, then runs it on your own ad account with your own money and reads back what it did.',
    need: ['A Meta ad account with a payment method on it', 'Admin on the Facebook Page the ads run as'],
    minutes: 4,
    steps: [
      { text: 'Press Connect with Facebook on the Meta ads card and sign in.' },
      { text: 'Allow the ads permissions. Vexa needs to create and read campaigns; it never touches your payment details.' },
      { text: 'Pick the ad account to use. If you only have one it is chosen for you.' },
      { text: 'Check your Page is attached, because an ad has to run as a Page.' },
      {
        admin: true,
        text: 'Admin, to make it never expire: business.facebook.com → Business settings → Users → System users → Add, as Admin. Give it the ad account (Manage) and the Page. Generate a token with expiry Never, ticking ads_management, ads_read, pages_show_list and pages_read_engagement, and paste it here.',
      },
    ],
    gotcha:
      'A plain Facebook sign-in lasts about 60 days and then the ads stop. If these are your ads and they matter, the never-expiring System User token is worth the ten minutes.',
  },
  'google-ads': {
    title: 'Google Ads',
    why: 'Vexa reads what your Google campaigns cost and what they brought in, and puts it beside the Meta ones so you can see which is actually working.',
    need: ['A Google Ads account', 'The Google login that can see it'],
    minutes: 2,
    steps: [
      { text: 'Press Continue with Google and sign in.' },
      { text: 'Allow read access to Google Ads.' },
      { text: 'Pick the account. A manager (MCC) account lists the ones under it.' },
      { text: 'Reading only, for now: Vexa reports on these campaigns, it does not change them.' },
      { admin: true, text: 'Admin: the Google OAuth client id and secret are stored on this card once, for every customer. YouTube borrows the same client.' },
    ],
    gotcha: 'Google Ads shows yesterday, not this minute. A campaign started an hour ago will have no numbers yet — that is Google, not a broken connection.',
  },
  'tiktok-ads': {
    title: 'TikTok Ads',
    why: 'The same campaign reporting as Meta and Google, for TikTok.',
    need: ['A TikTok Ads Manager account'],
    minutes: 2,
    steps: [
      { text: 'Press Continue with TikTok on the TikTok Ads card.' },
      { text: 'Approve the read permissions.' },
      { text: 'Pick the advertiser account you want reported.' },
    ],
  },
  store: {
    title: 'Your online shop',
    why: 'So the ads can be judged on orders instead of clicks: Vexa reads the month totals and lines them up with what each campaign cost.',
    need: ['A WooCommerce shop on WordPress', 'An admin login for that WordPress'],
    minutes: 3,
    steps: [
      { text: "Type your shop's web address here and press Connect." },
      { text: 'WordPress opens and asks you to approve it. Approve it as an admin.' },
      { text: 'It asks for read-only access, and that is all it ever gets: totals in, nothing out.' },
      { text: 'No customer name, phone number or address is ever read into Vexa. Order counts and totals only.' },
    ],
    gotcha: 'If your shop is not WooCommerce, leave this alone — the ads still report on clicks and cost, just not on orders.',
  },
  email: {
    title: 'Email',
    why: 'Vexa writes to customers and answers what comes back, from your own address.',
    need: ['A Gmail address', 'Two-step verification turned on for it'],
    minutes: 4,
    steps: [
      { text: 'In your Google account: Security → turn on 2-Step Verification if it is off. App passwords do not exist without it.' },
      { text: 'Still in Security, open App passwords and make one. Call it Vexa.' },
      { text: 'Google shows 16 letters. Copy them — it will not show them twice.' },
      { text: 'Paste your Gmail address and those 16 letters here. Not your normal password: that will be refused.' },
      { text: 'Leave it on "Ask me before sending" to start with. Read the first few it writes, then turn that off when you trust it.' },
    ],
    gotcha: 'The App passwords page is missing until 2-Step Verification is genuinely on, which is why that is step one and not an aside.',
  },
  token: {
    title: 'Connecting by token',
    why: 'The networks Meta does not own have no sign-in button, so the credential is pasted instead.',
    need: ['A developer account on that network', 'An app with the posting permission'],
    minutes: 6,
    steps: [
      { admin: true, text: "Make an app in that network's developer console." },
      { admin: true, text: 'Give it the permission to post as your account, and whatever it calls reading your own numbers.' },
      { admin: true, text: 'Generate a long-lived token. A short one works today and stops on its own in a week or two.' },
      { admin: true, text: 'Paste it here. It is spent on a real read call before anything is stored, so a bad token fails here rather than quietly at 10am tomorrow.' },
      { text: 'Stored encrypted, and never readable from this console again — not by you, not by us.' },
    ],
    gotcha: 'If the card goes red later, the token expired. Make a new one and paste it over the old.',
  },
};

/**
 * The guide itself, in a sheet. `admin` decides whether the token-and-secret
 * steps are shown at all — a customer who never sees a token field should never
 * read an instruction about one.
 */
export function SetupGuide({
  which,
  admin,
  onClose,
  onPick,
}: {
  /** A guide to show, or null for the list of all of them. */
  which: GuideKey | null;
  admin: boolean;
  onClose: () => void;
  onPick: (key: GuideKey) => void;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const guide = which ? GUIDES[which] : null;
  const steps = guide?.steps.filter((s) => admin || !s.admin) ?? [];

  return (
    <div className="sg" role="dialog" aria-modal="true" aria-label={guide ? `How to connect ${guide.title}` : 'Setting up'}>
      <style>{SETUP_CSS}</style>
      <button type="button" className="sg-scrim" onClick={onClose} aria-label="Close" />
      <div className="sg-sheet" ref={sheet}>
        <div className="sg-top">
          {which ? (
            <button type="button" className="sg-back" onClick={() => onPick(null as unknown as GuideKey)} aria-label="All guides">
              ‹ All
            </button>
          ) : null}
          <strong>{guide ? `Connecting ${guide.title}` : 'What can I connect?'}</strong>
          <button type="button" className="sg-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!guide ? (
          <div className="sg-list">
            <p className="sg-lede">
              Pick the one you are setting up. Each is a few minutes, and nothing goes out anywhere until it is connected.
            </p>
            {(Object.keys(GUIDES) as GuideKey[])
              .filter((k) => admin || k !== 'token')
              .map((k) => (
                <button key={k} type="button" className="sg-item" onClick={() => onPick(k)}>
                  <span className="sg-item-t">
                    <strong>{GUIDES[k].title}</strong>
                    <em>{GUIDES[k].why}</em>
                  </span>
                  <span className="sg-mins">{GUIDES[k].minutes} min</span>
                </button>
              ))}
          </div>
        ) : (
          <div className="sg-body">
            <p className="sg-why">{guide.why}</p>

            <div className="sg-need">
              <span className="sg-need-h">Before you start you need</span>
              {guide.need.map((n) => (
                <span key={n} className="sg-need-row">
                  <i aria-hidden>✓</i>
                  {n}
                </span>
              ))}
            </div>

            <ol className="sg-steps">
              {steps.map((s, k) => (
                <li key={s.text} className={done[`${which}.${k}`] ? 'is-done' : ''} style={{ ['--i' as string]: k }}>
                  <button
                    type="button"
                    className="sg-tick"
                    onClick={() => setDone((d) => ({ ...d, [`${which}.${k}`]: !d[`${which}.${k}`] }))}
                    aria-pressed={Boolean(done[`${which}.${k}`])}
                    aria-label={`Step ${k + 1} done`}
                  >
                    <span>{k + 1}</span>
                  </button>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>

            {guide.gotcha ? (
              <div className="sg-gotcha">
                <strong>What usually goes wrong</strong>
                <p>{guide.gotcha}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** The little "How?" next to a connect button. */
export function HowLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="sg-how" onClick={onClick}>
      <span aria-hidden>?</span> How do I do this?
    </button>
  );
}

export const SETUP_CSS = `
.sg { position: fixed; inset: 0; z-index: 9200; display: flex; justify-content: flex-end; }
.sg-scrim { position: absolute; inset: 0; border: 0; padding: 0; background: rgba(3,22,15,.42); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  cursor: pointer; animation: sg-fade .25s ease both; }
@keyframes sg-fade { from { opacity: 0; } }
.sg-sheet { position: relative; width: min(470px, 100vw); height: 100%; background: #fff; display: flex; flex-direction: column;
  box-shadow: -30px 0 70px -24px rgba(3,22,15,.45); animation: sg-slide .38s cubic-bezier(.3,1,.35,1) both; }
@keyframes sg-slide { from { transform: translateX(26px); opacity: 0; } }
.sg-top { display: flex; align-items: center; gap: 10px; padding: 16px 18px; border-bottom: 1px solid #e2e8e4; flex: none; }
.sg-top strong { font-size: 15.5px; font-weight: 900; letter-spacing: -.01em; }
.sg-back { border: 0; background: #f1f5f3; border-radius: 8px; padding: 5px 10px; font: inherit; font-size: 12.5px; font-weight: 800; color: #6f7a72; cursor: pointer; }
.sg-back:hover { background: #e4ebe7; color: #0b1f17; }
.sg-x { margin-left: auto; width: 28px; height: 28px; flex: none; display: grid; place-items: center; border: 0; background: #f1f5f3; border-radius: 9px;
  font-size: 12px; color: #6f7a72; cursor: pointer; }
.sg-x:hover { background: #e4ebe7; color: #0b1f17; }
.sg-body, .sg-list { padding: 18px; overflow-y: auto; flex: 1; }
.sg-lede { margin: 0 0 14px; font-size: 13px; line-height: 1.6; color: #6f7a72; }
.sg-why { margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #1c1b1b; }

.sg-item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 13px; margin-bottom: 8px; border-radius: 13px;
  border: 1px solid #e2e8e4; background: #fff; font: inherit; cursor: pointer; transition: all .22s ease; }
.sg-item:hover { border-color: #a8d5bd; transform: translateX(3px); box-shadow: 0 10px 22px -16px rgba(16,40,28,.5); }
.sg-item-t { flex: 1; min-width: 0; }
.sg-item strong { display: block; font-size: 14px; }
.sg-item em { display: block; font-style: normal; font-size: 12.5px; line-height: 1.5; color: #6f7a72; margin-top: 3px; }
.sg-mins { flex: none; font-size: 11px; font-weight: 900; color: #6f7a72; background: #f1f5f3; border-radius: 999px; padding: 3px 9px; }

.sg-need { border-radius: 14px; background: #f4f8f6; padding: 13px 14px; margin-bottom: 18px; display: grid; gap: 7px; }
.sg-need-h { font-size: 11px; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; color: #6f7a72; }
.sg-need-row { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; line-height: 1.5; }
.sg-need-row i { font-style: normal; color: #19c37d; font-weight: 900; flex: none; }

.sg-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.sg-steps li { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; position: relative;
  animation: sg-rise .4s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * 45ms); }
@keyframes sg-rise { from { opacity: 0; transform: translateY(6px); } }
/* the line joining the steps, so it reads as one path and not five notes */
.sg-steps li::before { content: ''; position: absolute; left: 13px; top: 38px; bottom: -2px; width: 2px; background: #e8efea; }
.sg-steps li:last-child::before { display: none; }
.sg-tick { flex: none; width: 27px; height: 27px; border-radius: 50%; border: 2px solid #dce5e0; background: #fff; color: #6f7a72;
  font: inherit; font-size: 12px; font-weight: 900; display: grid; place-items: center; cursor: pointer; z-index: 1;
  transition: all .25s cubic-bezier(.3,1.5,.5,1); }
.sg-tick:hover { border-color: #a8d5bd; }
.sg-steps li.is-done .sg-tick { background: #ccff00; border-color: #ccff00; color: #0b1f17; transform: scale(1.08); }
.sg-steps li.is-done .sg-tick span { font-size: 0; }
.sg-steps li.is-done .sg-tick::after { content: '✓'; font-size: 13px; }
.sg-steps li p { margin: 3px 0 0; font-size: 13.5px; line-height: 1.6; color: #1c1b1b; transition: color .2s ease, opacity .2s ease; }
.sg-steps li.is-done p { color: #6f7a72; opacity: .66; }

.sg-gotcha { margin-top: 18px; border-radius: 14px; padding: 13px 14px; background: #fff8e6; border: 1px solid #fde7a6; }
.sg-gotcha strong { display: block; font-size: 12.5px; font-weight: 900; color: #7a5200; margin-bottom: 5px; }
.sg-gotcha p { margin: 0; font-size: 13px; line-height: 1.6; color: #6b5420; }

.sg-how { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 0; font: inherit; font-size: 12.5px;
  font-weight: 800; color: #0058bb; cursor: pointer; }
.sg-how:hover { text-decoration: underline; text-underline-offset: 3px; }
.sg-how > span { display: grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: #0058bb; color: #fff; font-size: 10px; font-weight: 900; }

@media (prefers-reduced-motion: reduce) { .sg *, .sg { animation: none !important; transition: none !important; } }
`;
