/**
 * One function per stage of the desk's day, written to be a drop-in for the
 * Claude call it stands in for.
 *
 * Each of these returns the *domain type* the stage returns — `ContentPlan`,
 * `SeoPack`, `Distribution` — rather than a JSON string for somebody to parse
 * back. That is the one real advantage of writing locally: `generateJson`
 * exists because a model can only hand back text, and a function that is
 * already running inside the pipeline has no reason to pretend it is a model.
 * So the call sites read `if (!modelReady()) return localX(params)` and the
 * parsing, the field clamping and the shape-mismatch class of bug never
 * happen.
 *
 * Two of these are honestly better than the model they replace, and it is
 * worth saying which: `localLessons` reads the page's own numbers with
 * arithmetic instead of describing them in prose, and `localDistribution`
 * applies each network's character limit exactly. Everything else is a
 * downgrade in language and an upgrade in reliability, which is the trade this
 * whole module is.
 *
 * One is deliberately missing: research. It read the live web through the
 * model's own search tool, and nothing here can do that. `localResearch`
 * returns the "could not run" shape the type already carries rather than
 * inventing a market read, because a made-up trend is worse than no trend.
 */
import {
  lintCaption,
  humanise,
  reviewDraft,
  scoreHook,
  type QualityReport,
} from '../lint';
import {
  CAPTION_LIMITS,
  FORMAT_SPECS,
  type AdPlan,
  type ContentFormat,
  type ContentPlan,
  type ContentResearch,
  type Employee,
  type Frame,
  type Platform,
  type PostScript,
  type SearchPack,
  type SeoPack,
} from '../types';
// Type-only, and that is deliberate: `manager.ts` imports this module, so a
// value import either way round would be a runtime cycle. A type import is
// erased at compile time and cannot be one.
import type { Distribution } from '../manager';
import { composeDraft, dateFrom, factVars, hookCandidates, seedFor, type LocalDraft } from './compose';
import { materialFor } from './material';

/** The line the console shows wherever a stage was written without a model. */
export const LOCAL_ENGINE = 'Written by the local engine (no model, no key).';

const str = (v: string, max: number): string => v.trim().slice(0, max);

// ── the standup ─────────────────────────────────────────────────────────────

/**
 * The plan, decided rather than argued.
 *
 * The model version held a conversation in eight voices and committed to a
 * concept at the end of it. This one skips the argument and takes the concept
 * from the material: `scenes[0]` is already a filmable sentence, which is what
 * a concept was defined as. The hook direction names the formula the writer
 * will actually reach for, because both stages score the same candidates from
 * the same facts and land in the same place — the plan and the piece agree by
 * construction here, which they only did by instruction before.
 */
export function localPlan(params: {
  angle: string;
  format: ContentFormat;
  facts: Record<string, number | string>;
  date?: string;
  team: Employee[];
  recentConcepts: string[];
}): ContentPlan {
  const material = materialFor(params.angle);
  const spec = FORMAT_SPECS[params.format];
  const seed = seedFor(params.date ?? dateFrom(params.facts));
  const vars = factVars(params.facts, seed);

  // Rotate past a concept we have just made rather than repeating it.
  const scenes = material.scenes.length ? material.scenes : [material.lever];
  const recent = new Set(params.recentConcepts.map((c) => c.toLowerCase().slice(0, 80)));
  const fresh = scenes.filter((s) => !recent.has(s.toLowerCase().slice(0, 80)));
  const pool = fresh.length ? fresh : scenes;
  const concept = pool[seed % pool.length];

  const top = hookCandidates({ material, vars, recentHooks: [] })[0] ?? null;

  const notes: Record<string, string> = {};
  for (const employee of params.team) {
    const line = noteFor(employee, material.label, spec.label);
    if (line) notes[employee.id] = line;
  }

  return {
    atMs: Date.now(),
    concept: str(concept, 400),
    audience: str(material.who, 200),
    why: str(`${material.pain}, and ${material.lever}`, 300),
    hookDirection: top
      ? str(`Formula ${top.formula}, pointed at ${material.pain}.`, 300)
      : str(`Pointed at ${material.pain}.`, 300),
    visualDirection: str(
      `${concept} Near-black and one lime accent, natural Pakistani daylight, no stock-photo smiles.`,
      500,
    ),
    editDirection:
      spec.kind === 'video'
        ? str(
            `Open on the hook with the sound off. Cut on every line, something changes on screen by second five, close by looping back to the opening words. ${spec.seconds} seconds, ${spec.aspect}.`,
            500,
          )
        : '',
    distribution: str(
      `Per-network captions trimmed to each limit. ${material.label} belongs anywhere the format fits; the first ten comments get answered.`,
      600,
    ),
    notes,
  };
}

/** A line in the right person's lane. Generic by nature: nobody is improvising. */
function noteFor(employee: Employee, angle: string, format: string): string {
  switch (employee.role) {
    case 'content-writer':
      return `Write ${format.toLowerCase()} on ${angle.toLowerCase()}. Every figure from the facts, nothing rounded up.`;
    case 'designer':
      return 'One lime accent per frame, never the whole image. No overlay across a face.';
    case 'video-editor':
      return 'Shot one has to work muted. Cut on the line, not after it.';
    case 'social-manager':
      return 'One ask per caption, five tags, and answer the first ten comments yourself.';
    case 'seo-expert':
      return 'Two niche tags, two mid, one broad. Local before big.';
    case 'research-assistant':
      return 'No live read today, so nothing in this piece leans on a trend.';
    default:
      return '';
  }
}

// ── the writing ─────────────────────────────────────────────────────────────

export interface LocalDrafted {
  script: PostScript;
  caption: string;
  hashtags: string[];
  quality: QualityReport;
  /** What the search chose, for the work log. */
  note: string;
}

/** Write the piece. The candidate search in `compose.ts` does the deciding. */
export function localDraft(params: {
  angle: string;
  format: ContentFormat;
  facts: Record<string, number | string>;
  date?: string;
  recentHooks: string[];
  seo: SeoPack | null;
}): LocalDrafted {
  const spec = FORMAT_SPECS[params.format];
  const material = materialFor(params.angle);

  const draft: LocalDraft = composeDraft({
    angle: params.angle,
    format: params.format,
    facts: params.facts,
    date: params.date ?? dateFrom(params.facts),
    recentHooks: params.recentHooks,
    keywords: params.seo?.keywords ?? [],
  });

  const frames: Frame[] = draft.frames.length
    ? draft.frames
    : [{ scene: draft.hook, overlay: draft.hook.slice(0, 60) }];

  const script: PostScript = {
    hook: draft.hook,
    hookVariants: draft.hookVariants,
    frames,
    voiceover: draft.voiceover,
    cta: draft.cta,
    rationale: str(`${material.label}: ${material.pain}.`, 300),
    viralHook: str(
      `Somebody who has had ${material.pain} sends this to the one person who keeps complaining about it.`,
      300,
    ),
  };

  return {
    script,
    caption: draft.caption,
    hashtags: params.seo?.hashtags.length ? params.seo.hashtags : draft.hashtags,
    quality: reviewDraft({
      hook: draft.hook,
      caption: draft.caption,
      hashtags: params.seo?.hashtags.length ? params.seo.hashtags : draft.hashtags,
      voiceover: draft.voiceover,
      seconds: spec.seconds,
      keywords: params.seo?.keywords ?? [],
    }),
    note: draft.note,
  };
}

/**
 * Rewrite a caption on request — as far as a local engine honestly can.
 *
 * It cannot read the change request, and pretending otherwise would be the
 * worst thing in this file: an admin would type "make it warmer", get a
 * different caption back, and reasonably conclude the instruction worked. So
 * this keeps every sentence that is already there, cleans the typography,
 * tries the orderings, caps the tags, and returns the arrangement the critic
 * scores highest. The caller says plainly that the request was not read.
 */
export function localRewriteCaption(params: {
  script: PostScript;
  currentCaption: string;
  hashtags: string[];
}): { caption: string; hashtags: string[]; quality: QualityReport } {
  const cleaned = humanise(params.currentCaption).text;
  const lines = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const hook = params.script.hook;
  const rest = lines.filter((l) => l !== hook);
  const tags = [...new Set(params.hashtags.map((t) => t.replace(/^#/, '')))].slice(0, 5);

  // Every ordering that still opens on the hook and still closes on the ask.
  const candidates: string[][] = [
    [hook, '', ...rest],
    [hook, '', ...rest.slice().reverse()],
    [hook, '', ...rest.filter((l) => l.split(/\s+/).length >= 10), ...rest.filter((l) => l.split(/\s+/).length < 10)],
  ];

  let best = { caption: cleaned, quality: reviewDraft({ hook, caption: cleaned, hashtags: tags }) };
  for (const lineset of candidates) {
    const caption = humanise(lineset.join('\n')).text;
    const quality = reviewDraft({ hook, caption, hashtags: tags });
    if (quality.score > best.quality.score) best = { caption, quality };
  }

  return { caption: best.caption, hashtags: tags, quality: best.quality };
}

// ── the picture and the cut ─────────────────────────────────────────────────

export interface LocalFrame {
  prompt: string;
  overlay: string;
  alt: string;
}

/**
 * Art direction per frame.
 *
 * The writer's scene lines were already written as image prompts — subject,
 * setting, light, and where the lime sits — because `material.ts` had to serve
 * this stage too. So this adds the standing craft block and the alt text and
 * stops, rather than paraphrasing a sentence that was already the brief.
 */
export function localFrames(params: {
  script: PostScript;
  count: number;
  craft: string;
  seo: SeoPack | null;
}): LocalFrame[] {
  const frames = params.script.frames.length
    ? params.script.frames
    : [{ scene: params.script.hook, overlay: params.script.hook.slice(0, 60) }];

  return Array.from({ length: Math.max(1, params.count) }, (_, i) => {
    const frame = frames[i % frames.length];
    const alt = params.seo?.altTexts[i];
    return {
      prompt: str(`${frame.scene}. ${params.craft}`, 2000),
      overlay: str(frame.overlay, 80),
      alt: str(alt || frame.scene, 200),
    };
  });
}

// ── the search desk ─────────────────────────────────────────────────────────

/** Roman-Urdu forms worth having as YouTube tags, per angle. */
const URDU_TAGS: Record<string, string[]> = {
  'driver-earnings': ['driver kamai', 'cash kiraya'],
  'fleet-owner-maths': ['gari kiraye par', 'fleet malik'],
  'rider-savings': ['sasta kiraya', 'apna kiraya'],
  safety: ['mehfooz safar', 'female driver'],
  'how-it-works': ['ride kaise book karein', 'app kaise chalaye'],
  pooling: ['ride share', 'seat share'],
  intercity: ['shehr se shehr', 'seat booking'],
  couriers: ['parcel bhejna', 'same day parcel'],
  'partner-program': ['partner program', 'commission share'],
  'city-spotlight': ['local driver', 'shehar ki sawari'],
};

/**
 * The SEO brief.
 *
 * The keywords are filtered against the caption the writer is about to produce,
 * which is possible only because both stages are pure functions of the same
 * material and facts: this composes the piece, checks which phrases genuinely
 * survive into it, and briefs only those. A brief nobody can satisfy is how the
 * SEARCH TERMS check ends up failing on the desk's own instruction.
 */
export function localSeoPack(params: {
  angle: string;
  format: ContentFormat;
  facts: Record<string, number | string>;
  date?: string;
}): SeoPack {
  const material = materialFor(params.angle);
  const spec = FORMAT_SPECS[params.format];

  const preview = composeDraft({
    angle: params.angle,
    format: params.format,
    facts: params.facts,
    date: params.date ?? dateFrom(params.facts),
    recentHooks: [],
    keywords: [],
  });

  // The caption alone, because the caption alone is what `lintCaption` checks
  // its SEARCH TERMS against. Counting the voiceover here briefs a phrase that
  // is genuinely in the piece and still fails the check, which is how a desk
  // ends up marked down against its own instruction.
  const haystack = preview.caption.toLowerCase();
  const present = material.keywords.filter((k) => haystack.includes(k.toLowerCase()));

  const frames = preview.frames.length ? preview.frames : [{ scene: material.scenes[0], overlay: '' }];
  const altTexts = Array.from({ length: Math.max(1, spec.slides) }, (_, i) => {
    const frame = frames[i % frames.length];
    return str(frame.scene, 300);
  });

  return {
    searchIntent: str(material.searchIntent, 200),
    // Only what the piece will actually contain. An empty list is honest and
    // skips the check; a padded one fails it.
    keywords: present.slice(0, 8),
    hashtags: preview.hashtags,
    altTexts,
    note: `${LOCAL_ENGINE} ${present.length}/${material.keywords.length} phrases verified against the draft.`,
  };
}

/** YouTube metadata and the one query the site should try to own. */
export function localSearchPack(params: {
  angle: string;
  format: ContentFormat;
  script: PostScript;
  caption: string;
  seo: SeoPack | null;
  facts: Record<string, number | string>;
  date?: string;
}): SearchPack {
  const material = materialFor(params.angle);
  const spec = FORMAT_SPECS[params.format];
  const forYouTube = spec.kind === 'video';
  const seed = seedFor(params.date ?? dateFrom(params.facts));
  const vars = factVars(params.facts, seed);
  const city = vars.values.city;

  if (!forYouTube) {
    return {
      youtube: null,
      webAngle: str(material.searchIntent, 300),
      note: `${LOCAL_ENGINE} Not a video, so no YouTube metadata.`,
    };
  }

  // Under 60 characters, with the searched phrase at the front.
  const intent = material.searchIntent;
  const title = str(intent.length <= 58 ? capitalise(intent) : `${capitalise(intent.slice(0, 54)).trim()}...`, 100);

  const description = str(
    [
      params.script.hook,
      '',
      ...material.body.slice(0, 2),
      '',
      'https://play.google.com/store/apps/details?id=com.velocityridzpk.app',
      'https://velocityrides.app',
      '',
      `Velocity Rides is a ride-hailing app in Pakistan. The passenger offers their own fare and drivers bid on it, cash is a first-class way to pay, and every driver is verified against a CNIC. It also runs shared rides, intercity seats and couriers in ${city}.`,
    ].join('\n'),
    4500,
  );

  const tags = [
    ...(params.seo?.keywords ?? material.keywords),
    ...(URDU_TAGS[params.angle] ?? []),
    city.toLowerCase(),
    'velocity rides',
    'ride hailing pakistan',
  ];

  return {
    youtube: {
      title,
      description,
      tags: [...new Set(tags.map((t) => str(t, 40).toLowerCase()).filter(Boolean))].slice(0, 15),
    },
    webAngle: str(material.searchIntent, 300),
    note: LOCAL_ENGINE,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The YouTube ads brief.
 *
 * The figures here are a starting point for whoever runs the campaign, not a
 * forecast and not a platform claim — this document is read by one operator in
 * Ads Manager and never published, which is the only reason a number that did
 * not come from FACTS is allowed to appear in it at all.
 */
export function localAdPlan(params: {
  angle: string;
  script: PostScript;
  facts: Record<string, number | string>;
  date?: string;
}): AdPlan {
  const material = materialFor(params.angle);
  const seed = seedFor(params.date ?? dateFrom(params.facts));
  const vars = factVars(params.facts, seed);
  const candidates = hookCandidates({ material, vars, recentHooks: [] });

  return {
    objective: str(`Get installs from people who already have ${material.pain}.`, 300),
    campaignType: 'Video views to start, because the first job is finding which opening holds five seconds.',
    hookVariants: [params.script.hook, ...candidates.map((c) => c.text)]
      .filter((v, i, all) => v && all.indexOf(v) === i)
      .slice(0, 4)
      .map((v) => str(v, 300)),
    targeting: {
      locations: [vars.values.city, 'Lahore', 'Karachi', 'Islamabad'].filter(
        (c, i, all) => all.indexOf(c) === i,
      ),
      ages: '18-44',
      interests: ['Ride hailing apps', 'Commuters', 'Auto and vehicles', 'Mobile payments'],
    },
    budgetNote:
      'A starting point, not a forecast: run one city for two weeks before widening, and treat the first week as the cost of learning which opening works.',
    cta: str(params.script.cta || material.cta, 120),
    whatToTest: 'The first five seconds. Same body, two different openings, nothing else changed.',
    successLooksLike:
      'A cost per install you would pay again, and a view-through rate that beats the other opening by enough to be obvious.',
  };
}

// ── the manager ─────────────────────────────────────────────────────────────

/** Per-network captions, trimmed to each network's real limit. */
export function localDistribution(params: {
  caption: string;
  hashtags: string[];
  script: PostScript;
  candidates: Platform[];
  search: SearchPack | null;
}): Distribution {
  if (!params.candidates.length) {
    return { captions: {}, targets: [], note: 'No connected network can take this format.' };
  }

  const tagLine = params.hashtags.length ? params.hashtags.map((h) => `#${h}`).join(' ') : '';
  const lines = params.caption.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const hook = lines[0] ?? params.script.hook;
  const body = lines.slice(1);

  const captions: Partial<Record<Platform, string>> = {};
  for (const platform of params.candidates) {
    const limit = CAPTION_LIMITS[platform];
    let text: string;

    switch (platform) {
      case 'x':
        // 280 includes everything, so the hook plus one tag is the whole post.
        text = [hook, params.hashtags[0] ? `#${params.hashtags[0]}` : ''].filter(Boolean).join(' ');
        break;
      case 'threads':
        text = [hook, body[0] ?? ''].filter(Boolean).join('\n');
        break;
      case 'facebook':
        // Plainer and longer: people who read the whole thing, no tag wall.
        text = [hook, '', ...body].filter(Boolean).join('\n');
        break;
      case 'linkedin':
        text = [hook, '', ...body].filter(Boolean).join('\n');
        break;
      case 'youtube':
        text = params.search?.youtube?.description ?? [hook, '', ...body].join('\n');
        break;
      case 'tiktok':
        text = [hook, params.hashtags.slice(0, 2).map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n');
        break;
      default:
        // Instagram and anything added later: hook, break, body, tags at the end.
        text = [hook, '', ...body, '', tagLine].filter(Boolean).join('\n');
    }

    captions[platform] = text.slice(0, limit);
  }

  return {
    captions,
    targets: params.candidates,
    note: `${LOCAL_ENGINE} One caption per network, trimmed to each limit.`,
  };
}

// ── the inbox ───────────────────────────────────────────────────────────────

const SAFETY_WORDS = [
  'accident', 'crash', 'harass', 'harassment', 'unsafe', 'threat', 'threaten', 'police',
  'assault', 'abuse', 'kidnap', 'robbed', 'robbery', 'danger', 'emergency', 'injured',
  'hadsa', 'police ko', 'tang kiya', 'dhamki',
];

const SPAM_WORDS = [
  'http://', 'https://', 'www.', 'whatsapp me', 'dm for', 'investment', 'crypto', 'forex',
  'loan', 'followers', 'promo code', 'click here', 'free followers', 'binary',
];

const COMPLAINT_WORDS = [
  'worst', 'terrible', 'fraud', 'cheat', 'scam', 'refund', 'overcharge', 'charged me',
  'cancelled', 'late', 'rude', 'never again', 'useless', 'bakwas', 'ghalat', 'paise kat',
];

const PRAISE_WORDS = [
  'love', 'great', 'nice', 'best', 'awesome', 'thanks', 'thank you', 'good job', 'amazing',
  'zabardast', 'shukriya', 'behtareen', 'acha', 'mashallah',
];

/** Roman Urdu, by the function words that give it away. */
const URDU_MARKERS = [
  'hai', 'hain', 'nahi', 'kya', 'kaise', 'kahan', 'mera', 'meri', 'apna', 'kar', 'karna',
  'bhai', 'yar', 'acha', 'theek', 'paisa', 'paise', 'kiraya', 'gari', 'kitna', 'kitne',
];

export function looksRomanUrdu(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length < 2) return false;
  const hits = words.filter((w) => URDU_MARKERS.includes(w)).length;
  return hits >= 2 || hits / words.length > 0.2;
}

export type LocalIntent = 'praise' | 'question' | 'complaint' | 'safety' | 'spam' | 'other';

export interface LocalReply {
  id: string;
  intent: LocalIntent;
  reply: string;
}

/**
 * Classify a comment and write the reply.
 *
 * Deliberately narrow. A template cannot answer "how much will I make in
 * Johar Town on a Tuesday", so it does not try: anything that is a real
 * question gets an answer that promises a person, which is true, instead of an
 * answer that sounds specific and is not. Safety is escalated on the words
 * alone and never argued with, and spam gets an empty string, which is what
 * the pipeline reads as "close it".
 */
export function localReplies(comments: { id: string; text: string }[]): LocalReply[] {
  return comments.map(({ id, text }) => {
    const low = text.toLowerCase();
    const urdu = looksRomanUrdu(text);
    const has = (list: string[]) => list.some((w) => low.includes(w));

    if (has(SAFETY_WORDS)) {
      return {
        id,
        intent: 'safety',
        reply: urdu
          ? 'Yeh hum foran dekh rahe hain. Trip ki tafseel bhejein, support team isi waqt is par hai.'
          : 'We are looking at this now. Please send us the trip details and support will pick it up straight away.',
      };
    }

    if (has(SPAM_WORDS)) return { id, intent: 'spam', reply: '' };

    if (has(COMPLAINT_WORDS)) {
      return {
        id,
        intent: 'complaint',
        reply: urdu
          ? 'Is ke liye maazrat. Trip ki tafseel bhejein, hamari team ise dekhegi.'
          : 'Sorry that happened. Send us the trip details and our team will look at it.',
      };
    }

    if (low.includes('?') || /\b(how|what|when|where|which|why|can i|kaise|kitna|kitne|kahan|kya)\b/.test(low)) {
      return {
        id,
        intent: 'question',
        reply: urdu
          ? 'Acha sawal hai. Hamari team yahan thori dair mein tafseel se jawab degi.'
          : 'Good question. Someone from our team will answer it here shortly.',
      };
    }

    if (has(PRAISE_WORDS)) {
      return {
        id,
        intent: 'praise',
        reply: urdu ? 'Shukriya! Khushi hui sun kar.' : 'Thank you, that is good to hear.',
      };
    }

    // Nothing matched. An unanswered comment is better than a wrong answer,
    // and 'other' with an empty reply is what leaves it for a person.
    return { id, intent: 'other', reply: '' };
  });
}

// ── reading our own page ────────────────────────────────────────────────────

export interface RankedForLessons {
  mediaType: string;
  multiple: number;
  sendRate: number;
  saveRate: number;
  hookScore: number;
  hook: string;
}

/**
 * What our own numbers mean — arithmetic, not prose.
 *
 * This is the one stage that is better off without a model. The question
 * "which format travels furthest" is a mean over a group, and the question
 * "is the hook panel tracking reach" is a comparison of two means. A model was
 * being asked to eyeball thirteen rows and describe them; this computes them,
 * which is both cheaper and right.
 */
export function localLessons(params: {
  best: RankedForLessons[];
  worst: RankedForLessons[];
  medianReach: number;
  sampled: number;
}): { lessons: string[]; useMore: string[]; useLess: string[] } {
  const all = [...params.best, ...params.worst];
  if (all.length < 4) {
    return {
      lessons: [
        `Only ${all.length} post${all.length === 1 ? '' : 's'} with numbers so far. Nothing here is a pattern yet.`,
      ],
      useMore: [],
      useLess: [],
    };
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const lessons: string[] = [];
  const useMore: string[] = [];
  const useLess: string[] = [];

  // Which format carries, by multiple over our own median.
  const byType = new Map<string, number[]>();
  for (const post of all) {
    const list = byType.get(post.mediaType) ?? [];
    list.push(post.multiple);
    byType.set(post.mediaType, list);
  }
  const types = [...byType.entries()]
    .map(([type, multiples]) => ({ type, avg: mean(multiples), n: multiples.length }))
    .filter((t) => t.n >= 2)
    .sort((a, b) => b.avg - a.avg);

  if (types.length) {
    lessons.push(
      `Across ${params.sampled} posts, median reach is ${params.medianReach}. ` +
        types.map((t) => `${t.type.toLowerCase()} ${round1(t.avg)}x (${t.n})`).join(', ') + '.',
    );
    if (types.length > 1 && types[0].avg > types[types.length - 1].avg * 1.3) {
      useMore.push(`${types[0].type.toLowerCase()} — ${round1(types[0].avg)}x the median across ${types[0].n} posts.`);
      const last = types[types.length - 1];
      useLess.push(`${last.type.toLowerCase()} — ${round1(last.avg)}x across ${last.n} posts.`);
    }
  }

  // Is the hook panel actually tracking reach, on our own page?
  const bestHooks = mean(params.best.map((p) => p.hookScore));
  const worstHooks = mean(params.worst.map((p) => p.hookScore));
  if (bestHooks && worstHooks) {
    const gap = Math.round(bestHooks - worstHooks);
    lessons.push(
      gap >= 8
        ? `Our best posts opened on hooks scoring ${Math.round(bestHooks)}/100 against ${Math.round(worstHooks)}/100 for the worst. The hook panel is tracking reach here, so a weak score is worth a rewrite.`
        : `Hook scores barely separate our best from our worst (${Math.round(bestHooks)} against ${Math.round(worstHooks)}). Something other than the opening is deciding reach on this page.`,
    );
  }

  // Sends are the strongest ranking signal, so they get their own line.
  const bestSends = mean(params.best.map((p) => p.sendRate));
  const bestSaves = mean(params.best.map((p) => p.saveRate));
  if (bestSends || bestSaves) {
    lessons.push(
      `Our best posts ran ${round1(bestSends)} sends and ${round1(bestSaves)} saves per thousand reached.` +
        (bestSends >= bestSaves
          ? ' Sends are leading, so the pieces that travel are the ones one person forwards to one friend.'
          : ' Saves are leading, so what works here is the piece somebody keeps to use later.'),
    );
    useMore.push(
      bestSends >= bestSaves
        ? 'Pieces built to be forwarded to one specific person.'
        : 'Pieces built to be kept: fare breakdowns, lists, how-tos.',
    );
  }

  return { lessons: lessons.slice(0, 4), useMore: useMore.slice(0, 4), useLess: useLess.slice(0, 3) };
}

// ── the market read we cannot do ────────────────────────────────────────────

/**
 * No live read without the model's search tool, and that is reported rather
 * than filled in. `ContentResearch` already carries an `error` for exactly
 * this, and every stage downstream takes `research: null` without complaint.
 */
export function localResearch(): ContentResearch {
  return {
    atMs: Date.now(),
    trends: [],
    competitorMoves: [],
    opportunities: [],
    hookPatterns: [],
    avoid: [],
    sources: [],
    error:
      'The local engine cannot read the live web, so there is no market read today. Everything in this piece comes from the brand material and the facts.',
  };
}

/** Exported for the tests: the critic's view of one finished local piece. */
export function scoreLocal(draft: LocalDrafted): { hook: number; caption: string; quality: QualityReport } {
  return {
    hook: scoreHook(draft.script.hook).score,
    caption: lintCaption(draft.caption, []).verdict,
    quality: draft.quality,
  };
}
