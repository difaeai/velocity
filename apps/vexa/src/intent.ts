/**
 * What Vexa makes of what you typed.
 *
 * On-device, rules only — no cloud, no key. It reads English and the Roman
 * Urdu people actually type ("investors dhoond k lao", "unse baat kro",
 * "gmail se email kro"), and answers in English, which is the only language
 * the app speaks back.
 */
import { CHANNEL_NAME, db, type Channel, type Prospect, uid } from './store';

export type MissionKind = 'outreach' | 'content' | 'ads' | 'research' | 'plan';
export type Verb = 'find' | 'message' | 'email' | 'call' | 'make' | 'run' | 'learn';

export type Mission = {
  kind: MissionKind;
  verb: Verb;
  /** Who she is going after, already capitalised: "Investors". */
  who: string;
  channels: Channel[];
  count: number;
  /** For an ads job, the number you typed is a daily budget in PKR. */
  budget: number;
  city: string;
  raw: string;
  /** One line back in her own words. */
  understood: string;
  /** What she will actually do, in order. */
  steps: string[];
};

const CHANNEL_WORDS: Array<[Channel, RegExp]> = [
  ['instagram', /instagram|insta\b|\big\b|reels?/],
  ['facebook', /facebook|\bfb\b|meta\b/],
  ['tiktok', /tiktok|tik tok/],
  ['youtube', /youtube|\byt\b/],
  ['gmail', /gmail|e-?mail|mail\b|inbox/],
  ['whatsapp', /whatsapp|\bwa\b|whats app/],
  ['google', /google(?! ?mail)|search engine/],
];

const WHO_WORDS: Array<[string, RegExp]> = [
  ['Investors', /investor|funding|raise|angel|\bvc\b|sarmaya/],
  ['Customers', /customer|buyer|client|grahak|khareedar|order/],
  ['Shops', /shop|retailer|store|stockist|dukan/],
  ['Brands', /brand|company|business(?!es my)|partner/],
  ['Creators', /creator|influencer|blogger|page owner/],
  ['Suppliers', /supplier|vendor|manufacturer|factory|wholesale/],
  ['People', /people|log\b|audience|followers/],
];

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Sialkot', 'Dubai', 'London'];

const FIND = /find|search|look for|dhoond|dhund|talash|lao|source/;
const WRITE = /message|dm\b|baat|contact|reach out|outreach|pitch|approach|connect|likh/;
const MAIL = /e-?mail|mail\b|gmail|inbox|bhej/;
const CALL = /call|phone|ring|baat karo phone/;
const CONTENT = /post|reel|story|caption|content|video|photo|calendar|schedule/;
const ADS = /\bad\b|\bads\b|advert|campaign|budget|boost|promote|ishtihar/;
const RESEARCH = /research|compare|competitor|market|price check|kya chal/;

const has = (t: string, re: RegExp) => re.test(t);

export function read(raw: string): Mission {
  const t = (raw || '').toLowerCase();

  const channels = CHANNEL_WORDS.filter(([, re]) => has(t, re)).map(([c]) => c);
  const whoHit = WHO_WORDS.find(([, re]) => has(t, re));
  const who = whoHit ? whoHit[0] : 'People';
  const city = CITIES.find((c) => t.includes(c.toLowerCase())) ?? 'Lahore';

  const n = t.match(/\b(\d{1,6})\b/);
  const typed = n ? Number(n[1]) : 0;

  const wantsMail = has(t, MAIL);
  const wantsWrite = has(t, WRITE);
  const wantsFind = has(t, FIND);
  const wantsCall = has(t, CALL);

  // Which job is this? The order matters, because the words overlap:
  //  · "research" contains "search", so reading the market wins first;
  //  · "boost my post" is an ad, not a post;
  //  · "write my content" is the Content Team, "write to shops" is outreach,
  //    so writing only means people when there are people in it.
  let kind: MissionKind = 'plan';
  let verb: Verb = 'make';

  /** A real audience, as against the vague "people" or "audience". */
  const targeted = !!whoHit && whoHit[0] !== 'People';
  const namedChannel = channels.length > 0;
  const atThem = /unse|unko|inko|them|these people/.test(t);
  const toPeople =
    wantsFind || wantsMail || wantsCall || (wantsWrite && (targeted || namedChannel || atThem));

  if (has(t, RESEARCH)) {
    kind = 'research';
    verb = 'learn';
  } else if (has(t, ADS)) {
    kind = 'ads';
    verb = 'run';
  } else if (has(t, CONTENT) && !wantsFind && !wantsMail && !targeted) {
    kind = 'content';
    verb = 'make';
  } else if (toPeople || targeted) {
    kind = 'outreach';
    verb = wantsFind ? 'find' : wantsMail ? 'email' : wantsCall ? 'call' : 'message';
  }

  const pick: Channel[] = channels.length
    ? channels
    : kind === 'outreach'
      ? ['instagram', 'gmail']
      : kind === 'ads'
        ? ['facebook', 'instagram']
        : ['instagram'];

  const where = pick.map((c) => CHANNEL_NAME[c]).join(' and ');

  // The same number means different things to different jobs.
  const count = kind === 'ads' ? 50 : typed ? Math.min(500, Math.max(5, typed)) : 50;
  const budget = kind === 'ads' && typed ? Math.min(100_000, Math.max(200, typed)) : 999;

  const understood =
    kind === 'outreach'
      ? `Find ${count} ${who.toLowerCase()} in ${city} on ${where}, write to each one, and bring you the replies.`
      : kind === 'ads'
        ? `Build an ad campaign on ${where} for ${city} at PKR ${budget.toLocaleString('en-US')} a day, and stop there.`
        : kind === 'content'
          ? `Write and schedule content for ${where} — your voice, your hours.`
          : kind === 'research'
            ? `Read your market in ${city} and come back with a brief you can act on.`
            : `Take this on and come back with a plan for ${city}.`;

  const steps =
    kind === 'outreach'
      ? [
          `Search ${where} for ${who.toLowerCase()} in ${city}`,
          'Keep only the ones worth your time',
          `Write a ${pick.includes('gmail') ? 'short email' : 'short message'} for each`,
          'Send on your word, and watch for replies',
        ]
      : kind === 'ads'
        ? [
            `Pick who should see it in ${city}`,
            'Choose the piece that runs',
            `Hold it to PKR ${budget.toLocaleString('en-US')} a day`,
            'Build it as a draft for your word',
          ]
        : kind === 'content'
          ? ['Read what worked for you lately', 'Write the week', 'Fit each piece to its platform', 'Put them in the calendar']
          : kind === 'research'
            ? ['Read your rivals', 'Collect what customers ask', 'Compare prices and offers', 'Write the brief']
            : ['Read your accounts', 'Find the cheapest win', 'Put it into a plan', 'Start on your word'];

  return { kind, verb, who, channels: pick, count, budget, city, raw: raw.trim(), understood, steps };
}

/* ───────────────── the people she comes back with ───────────────── */

const FIRST = ['Zafar', 'Mehreen', 'Bilal', 'Ayesha', 'Usman', 'Hina', 'Faisal', 'Sana', 'Imran', 'Nida', 'Kamran', 'Rabia', 'Tariq', 'Saad'];
const LAST = ['Iqbal', 'Shah', 'Ahmed', 'Khan', 'Raza', 'Malik', 'Butt', 'Sheikh', 'Qureshi', 'Chaudhry'];
const HOUSE = ['Capital', 'Ventures', 'Angels', 'Partners', 'Holdings', 'Group'];

const WHY: Record<string, string[]> = {
  Investors: [
    'Backs small retail brands; wrote two cheques this year.',
    'Posts about early-stage Pakistani businesses most weeks.',
    'Already invested in a clothing label in your city.',
    'Writes PKR 5–20m cheques, which is your size.',
  ],
  Customers: [
    'Bought from a rival twice in the last month.',
    'Follows three shops like yours and comments on prices.',
    'Asked publicly where to find shirts in your size range.',
    'Lives in your delivery area and shops online weekly.',
  ],
  Shops: ['Stocks two labels close to yours.', 'Opened a second branch this year.', 'Sells your price band already.', 'Asks suppliers for small runs — which you can do.'],
  Brands: ['Same buyer as you, nothing competing.', 'Ran a joint giveaway last season.', 'Looking for a Lahore partner.', 'Their audience overlaps yours by a third.'],
  Creators: ['Her audience is your buyer, and she takes barter.', 'Posts try-ons weekly; good conversion for her size.', 'Tagged two shops like yours this month.', 'Cheap for her reach, and replies to DMs.'],
  Suppliers: ['Does small runs without a minimum.', 'Supplies two labels you know.', 'Closest mill to your workshop.', 'Quoted 12% under your current rate.'],
  People: ['Fits what you asked for.', 'Active this week, and reachable.', 'In your city, in your market.', 'Engages with shops like yours.'],
};

const DOMAINS = ['gmail.com', 'outlook.com', 'berreto.pk', 'capital.pk', 'ventures.pk'];

/** Makes the list she "found" — plausible, and different every run. */
export function findPeople(m: Mission, howMany: number): Prospect[] {
  const out: Prospect[] = [];
  const whys = WHY[m.who] ?? WHY.People;

  for (let i = 0; i < howMany; i++) {
    const channel = m.channels[i % m.channels.length];
    const firm = m.who === 'Investors' && i % 3 === 0;
    const first = FIRST[(i * 3 + 1) % FIRST.length];
    const last = LAST[(i * 5 + 2) % LAST.length];
    const name = firm ? `${last} ${HOUSE[i % HOUSE.length]}` : `${first} ${last}`;

    // a firm is reached at the firm, not at somebody's personal handle
    const slug = firm ? `${last}${HOUSE[i % HOUSE.length]}`.toLowerCase() : `${first}.${last}`.toLowerCase();
    const handle =
      channel === 'gmail'
        ? firm
          ? `hello@${slug}.pk`
          : `${slug}@${DOMAINS[i % DOMAINS.length]}`
        : channel === 'whatsapp'
          ? `+92 3${(10 + (i % 80)).toString()} ${(1000000 + i * 7919).toString().slice(0, 7)}`
          : `@${slug}`;

    out.push({
      id: uid(),
      name,
      handle,
      channel,
      who: m.who.replace(/s$/, ''),
      city: m.city,
      reach: channel === 'gmail' || channel === 'whatsapp' ? 0 : 2200 + ((i * 7417) % 90000),
      why: whys[i % whys.length],
      state: 'found',
      at: Date.now(),
    });
  }
  return out;
}

/** The first draft of what she would send them. */
export function draftMessage(m: Mission, business: string, trade: string, city: string) {
  const email = m.channels.includes('gmail');

  if (m.who === 'Investors') {
    return {
      subject: `${business} — a small round, one page`,
      body: `Hello {name},\n\nI run ${business}, a ${trade.toLowerCase()} in ${city}. We did PKR 1.4m last month, mostly repeat buyers, and we are raising a small round to open a second workshop.\n\nMay I send you one page on it?\n\nHassan`,
    };
  }
  if (m.who === 'Creators') {
    return {
      subject: `${business} — something for you, no strings`,
      body: `Hi {name} — we make ${trade.toLowerCase()} pieces in ${city} and would love to send you one, no strings. If you like it, say so. If not, keep it anyway.`,
    };
  }
  if (m.who === 'Shops' || m.who === 'Brands' || m.who === 'Suppliers') {
    return {
      subject: `${business} — stocking a Lahore label`,
      body: `Hello {name},\n\nI run ${business} in ${city}. We make small runs and already sell well online. Would you consider stocking a few pieces?\n\nI can send photographs and prices today.\n\nHassan`,
    };
  }
  return {
    subject: email ? `A hello from ${business}` : '',
    body: `Hi {name} — I run ${business} in ${city}. We have just put out our winter pieces and thought of you. Shall I send you a few photographs?`,
  };
}


/* ───────────────── answering a customer ───────────────── */

/**
 * What she says back. It is built from the rules you taught her in Make me
 * Learn: the matching rule wins, and with no rule at all she hands the
 * question to you rather than inventing an answer.
 */
export function answer(asked: string): { text: string; rule?: string } {
  const q = (asked || '').toLowerCase();

  const topics: Array<[RegExp, RegExp]> = [
    [/deliver|ship|kab|when|courier|next day|tomorrow/, /deliver|courier|days|ship/],
    [/discount|price|cost|kitna|how much|cheap|rate/, /discount|price|%|rate|negotiab/],
    [/size|large|medium|small|fit/, /size|fit|large|medium|small/],
    [/catalog|catalogue|pictures|photos|list/, /catalog|catalogue|page|guide|pdf/],
  ];

  for (const [asks, holds] of topics) {
    if (!asks.test(q)) continue;
    const rule = db.lessons.find((l) => holds.test(`${l.title} ${l.body}`.toLowerCase()));
    if (rule) return { text: rule.body, rule: rule.title };
  }

  return {
    text: `Thank you for writing to ${db.me.business}. I have put this in front of ${db.me.name.split(' ')[0]} and he will answer you himself.`,
  };
}

/* ───────────────── the other jobs she can be given ───────────────── */

/** What a research run comes back with, fitted to what was asked. */
export function briefFor(m: Mission) {
  const where = m.channels.map((c) => CHANNEL_NAME[c]).join(' and ');
  return {
    sources: 11 + Math.floor(Math.random() * 24),
    findings: [
      {
        head: `Short video is carrying ${where} in ${m.city}`,
        body: `Posts under 15 seconds took most of the saves this week. Photo-only accounts in ${m.city} lost reach for the third week running.`,
      },
      {
        head: 'Your price sits in the middle',
        body: `Two rivals undercut you and look it; one charges more and photographs better. There is room to hold your price if the pictures improve.`,
      },
      {
        head: 'Nobody answers quickly',
        body: `Average reply time in your trade is over 14 hours. Answering inside one would make you the fastest in ${m.city}.`,
      },
    ],
  };
}

/** The pieces she would write if you asked her for content. */
export function postsFor(m: Mission, business: string, trade: string) {
  const t = trade.toLowerCase();
  return [
    {
      title: `How we make it — ${business}`,
      caption: `Forty minutes on one collar. This is why it sits flat all day.`,
      kind: 'reel' as const,
    },
    {
      title: `What is new this week`,
      caption: `New in today. Three colours, one fit, nothing shouty.`,
      kind: 'post' as const,
    },
    {
      title: `A customer in ${m.city}`,
      caption: `Someone wore theirs to a wedding and three people asked where it came from.`,
      kind: 'story' as const,
    },
  ].map((p) => ({ ...p, caption: p.caption.replace('{trade}', t) }));
}

/** A caption in her voice, for this business, honouring the rules you set. */
export function writeCaption(
  business: string,
  trade: string,
  kind: 'reel' | 'post' | 'story',
  lessons: Array<{ title: string; body: string }>,
) {
  const t = trade.toLowerCase().replace(/s$/, '');
  const lines =
    kind === 'reel'
      ? [
          `Forty minutes on one collar. This is why it sits flat all day.`,
          `Ninety seconds, and the order is packed. Every single time.`,
          `This is how a ${t} piece is finished by hand in our workshop.`,
        ]
      : kind === 'story'
        ? [
            `New in today. Tap if you want one held for you.`,
            `Last two in this colour. After that it is gone.`,
            `Someone asked where to find these — here they are.`,
          ]
        : [
            `New in today. Three colours, one fit, nothing shouty.`,
            `We only made forty of these. When they go, they go.`,
            `This is the piece three customers came back for. Here is why.`,
          ];

  const line = lines[Math.floor(Math.random() * lines.length)];
  // Anything you have taught her about delivery goes in rather than a promise.
  const rule = lessons.find((l) => /deliver|courier|days/i.test(`${l.title} ${l.body}`));
  return rule ? `${line} ${rule.body.split('.')[0]}.` : `${line} — ${business}`;
}
