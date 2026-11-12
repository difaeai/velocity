import type { Metadata } from 'next';

import { SUPPORT_ADDRESS, SUPPORT_EMAIL, SUPPORT_PHONE } from './site';
import {
  STUDIO_PLANS,
  STUDIO_PLAN_IDS,
  STUDIO_TRIAL_HOURS,
  STUDIO_TRIAL_USD,
  STUDIO_YEAR_DISCOUNT_PCT,
  studioUsd,
} from './studio';

/**
 * Vexa's own legal documents: her privacy policy, her terms, how a workspace
 * is deleted, and her support page.
 *
 * Vexa is sold to businesses, in dollars, by card and bank transfer, and
 * connects to Meta, TikTok and Google on a customer's behalf — none of which
 * the ride app's documents are about. The owner asked for the two products to
 * read as two companies, so these are hers: /vexa/privacy, /vexa/terms,
 * /vexa/delete-account and /vexa/support. The ride app keeps /privacy, /terms,
 * /delete-account and /support, and nothing of hers links there.
 *
 * Written once here and rendered twice: as those three pages
 * (components/site/LegalDoc) and, for the privacy policy, as the section on
 * Vexa's own page. Prices come from lib/studio.ts, so a price change cannot
 * leave a wrong number in a contract. Every clause is something the code
 * actually does, and the refund terms are the same words in her terms and on
 * her support page — change one and change the other.
 */

/** The day these last changed. One date for all three, so a reader can tell at a glance. */
export const VEXA_LEGAL_EFFECTIVE = '12 November 2026';

export interface Clause {
  t: string;
  d: string;
}

/**
 * The head tags for one of Vexa's documents. Without them the page inherits the
 * root layout's, which are the ride app's — so a shared link to Vexa's support
 * page offered to "name your fare, split the ride". Defining openGraph and
 * twitter here replaces the parent's whole object, images included.
 */
export function vexaDocMetadata(title: string, description: string, path: string): Metadata {
  const heading = `${title} — Vexa`;
  return {
    title: { absolute: heading },
    description,
    applicationName: 'Vexa',
    keywords: ['Vexa', 'social media virtual assistant', title],
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      siteName: 'Vexa',
      title: heading,
      description,
      url: path,
      images: ['/studio/opengraph-image'],
    },
    twitter: { card: 'summary_large_image', title: heading, description, images: ['/studio/opengraph-image'] },
  };
}

const PLAN_LIST = STUDIO_PLAN_IDS.map(
  (id) => `${studioUsd(STUDIO_PLANS[id].usd)} (${STUDIO_PLANS[id].name})`,
).join(', ');

export const VEXA_PRIVACY: Clause[] = [
  {
    t: 'Who you are dealing with',
    d: 'Vexa is operated by Berreto (Private) Limited, the company behind Velocity Rides, registered with the Securities and Exchange Commission of Pakistan. It is the company responsible for the data described here. Write to business@velocityrides.app about anything on this page.',
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
    d: 'Card payments are taken by Stripe on Stripe’s own page — we never see, handle or store your card number, and no card is kept on file to be charged again. If you pay by bank transfer, what we keep is the transaction ID or the screenshot you upload as proof.',
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
    d: 'Google Firebase (hosting and storage), Google Gemini (writing and research), Meta (Facebook and Instagram), TikTok (posting and ads) and Stripe (card payments). Each has its own privacy policy: firebase.google.com/support/privacy, policies.google.com/privacy, facebook.com/privacy/policy, tiktok.com/legal/privacy-policy and stripe.com/privacy.',
  },
  {
    t: 'Keeping it safe',
    d: 'Access tokens and mailbox passwords are stored encrypted, and your workspace is readable only by the account that owns it. No system is perfectly secure, but nothing here is shared with anyone outside the companies named above.',
  },
  {
    t: 'Children',
    d: 'Vexa is for businesses and for people aged 18 and over. We do not knowingly collect anything from children.',
  },
  {
    t: 'Changes',
    d: `When this policy changes we revise the date above, which is ${VEXA_LEGAL_EFFECTIVE}.`,
  },
];

export const VEXA_TERMS: Clause[] = [
  {
    t: 'Who we are',
    d: 'Vexa is owned and operated by Berreto (Private) Limited, a company registered with the Securities and Exchange Commission of Pakistan, which also makes the Velocity Rides app. “We”, “us” and “our” mean that company. Our company website is berreto.com; our support address, phone and email are on velocityrides.app/vexa/support.',
  },
  {
    t: 'What Vexa is',
    d: 'Vexa is software that does a social media team’s work for your business: it reads your market, plans and makes content, posts it to the accounts you connect, answers comments, runs the ads you approve inside the daily limit you set, and writes to leads. It is a tool you direct, not an agency, and it promises no particular reach, following, sales or ad result.',
  },
  {
    t: 'Using it',
    d: 'You need a business and you must be 18 or over. What you tell Vexa about your business must be true, and what goes out on your accounts is published in your name — so you are responsible for it, whether you approved each piece or let it post for you. You choose which of those two it is, and you can change it at any time.',
  },
  {
    t: 'The accounts you connect',
    d: 'Connecting Facebook, Instagram, TikTok, YouTube, Google or a mailbox is you authorising us to act on that account within the permissions you grant, and within that platform’s own terms, which you keep. We use the access for nothing but running your workspace. You can disconnect any of them at any time, and a platform can withdraw access at any time, which may stop part of the service until it is reconnected.',
  },
  {
    t: 'Plans and prices',
    d: `Vexa is sold by the month or by the year, in US dollars: ${PLAN_LIST} a month. A year is the same price less ${STUDIO_YEAR_DISCOUNT_PCT}%. Any plan can start with ${STUDIO_TRIAL_HOURS} hours for ${studioUsd(STUDIO_TRIAL_USD)}, so you can see it work first. Prices on the site may change; the price you paid is the price for the period you paid for.`,
  },
  {
    t: 'Paying',
    d: 'By debit or credit card, taken by Stripe on Stripe’s own page, or by bank transfer — you send the payment, upload the proof, and the workspace opens once it is checked. Each payment buys exactly one month or one year: nothing renews on its own, no card is kept on file, and your statement shows the amount in US dollars, at the exchange rate your own bank chooses.',
  },
  {
    t: 'Stopping, and refunds',
    d: 'Stopping is simply not paying again. If you ask for your money back before the team has started work, we refund the payment in full, to the same card or account it came from, within 7 working days of agreeing it. Once the team has started work for that month or year, that period is not refunded, but nothing further is charged and your access runs to the end of what you paid for. If something looks wrong on your statement, write to us first — we can usually settle it the same day, which is faster than a bank dispute.',
  },
  {
    t: 'What you spend on ads',
    d: 'Advertising money goes from you to Meta or Google, never through us. You set a daily limit and the code holds the ads inside it, but the ad accounts, their billing and anything those platforms charge are yours. We are not responsible for a platform rejecting, pausing or charging for an ad.',
  },
  {
    t: 'What you may not do with it',
    d: 'No spam, no scams, no impersonating someone else, nothing illegal where you sell, nothing adult, hateful or misleading, and nothing that breaks the rules of the platform it would be posted to. We may pause or end a workspace that does any of it, and we will tell you why.',
  },
  {
    t: 'What is made for you',
    d: 'The posts, reels, captions and campaigns made for your business are yours to use. Footage and music the service adds are public domain or licensed for this use; anything you upload yourself must be yours to use. We keep the rights to Vexa itself — the software, the site and the way it works.',
  },
  {
    t: 'Where the words come from',
    d: 'The writing, the research and the pictures are produced with Google Gemini and tools like it, and software of that kind can be wrong or out of date. Read what is going out, especially a price, an offer or a claim about your business. Nothing is published to an account you did not connect.',
  },
  {
    t: 'When it is not working',
    d: 'We run Vexa with reasonable skill and care, but we do not promise it will be uninterrupted or error-free, and the platforms it depends on can change their rules or their software without notice. We may add, change or withdraw parts of the service; if a change takes away something you paid for, tell us and we will put it right under the refund terms above.',
  },
  {
    t: 'Our responsibility, and its limits',
    d: 'Nothing here excludes liability for fraud, for death or personal injury caused by our negligence, or for anything else that cannot be excluded under Pakistani law. Subject to that, our total liability to you for any claim connected with Vexa is limited to what you paid us for it in the twelve months before the claim, and we are not liable for indirect or consequential loss, lost profit, lost followers or lost opportunity.',
  },
  {
    t: 'Ending it',
    d: 'You can stop at any time, and ask for your workspace to be deleted — the Delete your workspace page says how. We may end an account that breaks these terms, that charges back a payment whose benefit it keeps, or that we are required by law to close.',
  },
  {
    t: 'Changes to these terms',
    d: `We may change these terms; the date above, ${VEXA_LEGAL_EFFECTIVE}, is when they last changed. Paying for a new period means accepting the terms as they stand then.`,
  },
  {
    t: 'Governing law',
    d: 'These terms are governed by the laws of the Islamic Republic of Pakistan, and the courts of Pakistan have jurisdiction over any dispute. If any part of them is found unenforceable, the rest continues to apply.',
  },
];

export const VEXA_DELETION: Clause[] = [
  {
    t: 'Disconnect the accounts first',
    d: 'In your workspace, open Connected accounts and disconnect each one. That deletes the stored access token at once, and from that moment nothing can be read from or posted to that account. You can also remove our app yourself: on Facebook at Settings → Business Integrations, and in TikTok under your connected apps.',
  },
  {
    t: 'Ask for the workspace to be deleted',
    d: 'Email business@velocityrides.app from the address you signed up with, with “Delete my Vexa workspace” as the subject. That address is how we know it is you; if you cannot write from it, tell us the business name and the last payment you made and we will verify it another way.',
  },
  {
    t: 'What is deleted',
    d: 'Everything in the workspace: your business brief and market analysis, every planned, made and posted piece and how it did, the comments and replies drafted for you, the leads the sales agent found and the emails it wrote, your connected accounts’ names and pictures, any stored mailbox password, and your log-in. It is deleted within 30 days of the request.',
  },
  {
    t: 'What stays, and why',
    d: 'Records of payments — what was paid, when and for what — are kept for as long as tax and company law require. Anything already published to your own Facebook, Instagram, TikTok or YouTube account stays there: it is on your account, not ours, and only you can take it down.',
  },
  {
    t: 'Stopping without deleting',
    d: 'If you only want it to stop, do not pay for the next period: nothing renews on its own, the team pauses at the end of what you paid for, and nothing is posted after that. Your workspace stays as it is until you ask for it to be deleted.',
  },
];

export const VEXA_SUPPORT: Clause[] = [
  {
    t: 'Who you are dealing with',
    d: `Vexa is owned and operated by Berreto (Private) Limited, a company registered with the Securities and Exchange Commission of Pakistan. “Vexa” is the name it trades under and the name on your receipt. Its company website is berreto.com.`,
  },
  {
    t: 'How to reach a person',
    d: `Email ${SUPPORT_EMAIL} about anything at all — the service, a connected account, an invoice or a refund. Phone or WhatsApp ${SUPPORT_PHONE}, the same number for both. By post: ${SUPPORT_ADDRESS}. Email and WhatsApp are read every day. Tell us the address you signed up with and, for anything about money, the payment or receipt — that is enough to find it.`,
  },
  {
    t: 'What you are buying',
    d: `Vexa is software that does a social media team’s work for your business: it reads your market, plans and makes the content, posts it to the accounts you connect, answers comments, runs the ads you approve inside the daily limit you set, and writes to leads. It is a tool you direct, not an agency, and it promises no particular reach, following or sales.`,
  },
  {
    t: 'What it costs',
    d: `Sold by the month or by the year, in US dollars: ${PLAN_LIST} a month. A year is the same price less ${STUDIO_YEAR_DISCOUNT_PCT}%. Any plan can start with ${STUDIO_TRIAL_HOURS} hours for ${studioUsd(STUDIO_TRIAL_USD)}, so you can see it work before you pay for a month. Each payment buys exactly that one period — nothing renews on its own and no card is kept on file to be charged again.`,
  },
  {
    t: 'How you pay',
    d: `By debit or credit card, taken by Stripe on Stripe’s own page — we never see, handle or store your card number — or by bank transfer, where you send the payment, upload the proof, and the workspace opens once it is checked. Your statement shows the amount in US dollars; your own bank decides the exchange rate it uses. Money you spend on advertising goes from you to Meta or Google, never through us.`,
  },
  {
    t: 'Refunds',
    d: `If you ask for your money back before the team has started work, we refund the payment in full, to the same card or account it came from, within 7 working days of agreeing it. Once the team has started work for that month or year, that period is not refunded, but nothing further is charged and your access runs to the end of what you paid for. Stopping is simply not paying again.`,
  },
  {
    t: 'If something looks wrong on your statement',
    d: `Write to ${SUPPORT_EMAIL} first. We can usually settle it the same day, which is faster than a bank dispute.`,
  },
  {
    t: 'Your accounts and your data',
    d: `You can disconnect any connected account from Connected accounts in your workspace, which deletes the stored token at once. What we hold and why is in the privacy policy, and a workspace and everything in it can be deleted — the Delete your workspace page says how.`,
  },
  {
    t: 'If we cannot agree',
    d: `Write to ${SUPPORT_EMAIL} with what happened and what you want done. A person reads it. Complaints are handled under the Terms of Service, which also says whose law applies.`,
  },
];
