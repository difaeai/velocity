/**
 * The checks that cost nothing.
 *
 * Everything in `playbook.ts` is advice given to a model and therefore
 * advice a model can forget. This file is the half of the same craft that can
 * be decided arithmetically — is the hook five to twelve words, is the first
 * line of the caption going to be cut mid-clause, are there six hashtags where
 * the cap is five, is the voiceover ninety seconds of script in a thirty-second
 * reel — and it runs in Cloud Functions on plain strings.
 *
 * That matters for one reason: **it is free**. A quality gate that costs a
 * model call per piece is a gate that doubles the bill; this one is a few
 * milliseconds of regex, runs on every piece, and only spends a call when it
 * actually found something, as one scoped rewrite rather than a fresh run.
 *
 * Ported from the Python tools in `Jakeschincariol/instagram-agent-skill` (MIT)
 * — `hookscore.py`, `caption.py`, `humanize.py`, `detect.py` and `beats.py`.
 * The thresholds are theirs and are left where they were, because they were
 * measured rather than guessed. Their own measurement is worth repeating here,
 * since it decides how much weight to put on the number this file returns:
 * against hooks written deliberately badly the panel separates well (AUC 0.83),
 * and between one good writer's hits and that same writer's misses it is close
 * to a coin flip (AUC 0.56).
 *
 * So this is a floor, not a judge. It catches the hook that opens on a
 * greeting, the caption that gets cut mid-sentence, the six hashtags and the
 * em dash. It cannot tell you which of two good hooks will travel, and neither
 * can anything else that only reads the text.
 *
 * One deliberate departure from the Python: a check that cannot judge a piece
 * of text — burstiness needs four sentences, voice needs twenty-five words —
 * is marked `skipped` and left out of the arithmetic entirely, instead of
 * scoring a neutral 50 that then drags the verdict down through the
 * weakest-check term. Instagram captions are three sentences long. Scoring
 * them as suspicious for being short would mean flagging almost everything,
 * and a gate that flags everything is one people learn to click past.
 */

// ── scoring helpers ─────────────────────────────────────────────────────────

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** Map a measurement onto 0-100, where `human` is 100 and `machine` is 0. */
function scale(value: number, human: number, machine: number): number {
  if (human === machine) return 50;
  return clamp(((value - machine) / (human - machine)) * 100);
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Population standard deviation, which is what the Python used. */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export interface Check {
  name: string;
  /** 0-100, or null when there was not enough text to judge it. */
  score: number | null;
  detail: string;
}

/** Mean and weakest, over the checks that could actually be judged. */
function combine(checks: Check[]): { score: number; weakest: string | null } {
  const judged = checks.filter((c) => c.score !== null) as (Check & { score: number })[];
  if (!judged.length) return { score: 50, weakest: null };
  const scores = judged.map((c) => c.score);
  const low = Math.min(...scores);
  // The weakest property caps the result: one bad property is enough for the
  // thumb to keep moving, and one bad signal is enough for a reader to clock a
  // caption as machine-written.
  return {
    score: clamp(mean(scores) * 0.6 + low * 0.4),
    weakest: judged.find((c) => c.score === low)?.name ?? null,
  };
}

// ── words and numbers ───────────────────────────────────────────────────────

const WORD_RE = /[A-Za-z0-9$%'-]+/g;
const NUMBER_RE =
  /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|x\b|hrs?\b|hours?\b|mins?\b|minutes?\b|days?\b|weeks?\b|months?\b|years?\b)?/gi;
const PROPER_RE = /(?!^)\b[A-Z][a-z]{2,}\b/g;
const HASHTAG_IN_TEXT = /(?:^|\s)#\w+/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u;

/** "$18,000" is one word when it is spoken, so it is one word here. */
function words(text: string): string[] {
  return text.replace(/(?<=\d),(?=\d)/g, '').match(WORD_RE) ?? [];
}

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

/**
 * Spoken hooks say their numbers out loud, so "zero rupees" is as concrete as
 * "Rs 0". "One" and "first" are deliberately absent: filler far more often than
 * a quantity.
 */
const SPOKEN_NUMBERS = new Set([
  'zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion',
  'dozen', 'half', 'twice', 'triple', 'lakh', 'crore', 'hazaar', 'sau',
]);

const MONEY_WORDS = new Set([
  'dollars', 'dollar', 'bucks', 'grand', 'percent', 'cents', 'rupees', 'rupee',
  'rs', 'pkr', 'kiraya', 'fare', 'revenue', 'profit', 'salary', 'rent', 'commission',
]);

/** Words that put something on the line. Without one, a hook is a statement. */
const STAKES = new Set([
  'stop', 'never', 'wrong', 'mistake', 'mistakes', 'lost', 'lose', 'losing',
  'cost', 'costs', 'broke', 'broken', 'failed', 'failure', 'fail', 'nobody',
  'no', 'not', "don't", 'dont', "doesn't", "didn't", "can't", "won't", 'quit',
  'quitting', 'fired', 'deleted', 'delete', 'killed', 'kills', 'kill',
  'replaced', 'replaces', 'cut', 'beat', 'free', 'paid', 'charged', 'hired',
  'saved', 'first', 'banned', 'illegal', 'worst', 'hate', 'hated', 'wasted',
  'waste', 'scam', 'lie', 'lied', 'lying', 'truth', 'secret', 'hidden', 'stole',
  'stolen', 'before', 'until', 'instead', 'but', 'except', 'unless', 'problem',
  'risk', 'danger', 'warning', 'regret', 'wish', 'should', "shouldn't", 'still',
  'already', 'only', 'without', 'versus', 'vs', 'actually',
]);

/** Openers that spend the first second saying nothing. */
const WEAK_OPENERS = [
  'so', 'ok', 'okay', 'hey', 'hi', 'hello', 'guys', 'yo', 'alright', 'welcome',
  'today', 'basically', 'honestly', 'look', 'listen', 'um', 'just', 'let',
  'lets', "let's", 'i wanted', 'i want', 'one of', 'have you', 'did you',
  'do you', 'are you', 'in this', 'in today', 'the thing', 'a lot', 'there is',
  'there are', 'this is', 'it is', 'as a', 'when it', 'you know',
];

/** Imperatives that earn the front position. */
const IMPERATIVES = new Set([
  'stop', 'steal', 'copy', 'delete', 'try', 'watch', 'read', 'save', 'use',
  'build', 'make', 'write', 'send', 'take', 'start', 'quit', 'never', 'always',
  "don't", 'dont', 'do', 'put', 'run', 'check',
]);

const DEALBREAKERS: { re: RegExp; why: string }[] = [
  {
    re: /^\s*(?:stop scrolling|don'?t scroll)/i,
    why: 'Opens with "stop scrolling". Asking for attention proves it was not earned.',
  },
  {
    re: /\b(?:in (?:this|today'?s) (?:video|reel)|i'?m going to show you|i'?ll show you how)\b/i,
    why: 'Video preamble. Delete it and open on the payoff.',
  },
  {
    re: /^\s*(?:hey |hi |what'?s up |welcome |assalam)/i,
    why: 'Greeting. Nobody came to the feed to be greeted.',
  },
  { re: HASHTAG_IN_TEXT, why: 'Hashtag in the hook. Hashtags belong at the bottom of the caption.' },
  { re: EMOJI_RE, why: 'Emoji in the hook. At hook size there is room for words or an emoji, not both.' },
];

// ── the hook panel ──────────────────────────────────────────────────────────

export interface HookScore {
  text: string;
  score: number;
  verdict: 'STRONG' | 'OK' | 'WEAK';
  checks: Check[];
  dealbreakers: string[];
  weakest: string | null;
}

function hookLength(text: string): Check {
  const n = words(text).length;
  const chars = text.trim().length;
  const secs = n / 2.75;
  let score = n >= 5 && n <= 12 ? 100 : n < 5 ? clamp(100 - (5 - n) * 20) : clamp(100 - (n - 12) * 11);
  if (chars > 60) score -= 12;
  return {
    name: 'LENGTH',
    score: clamp(score),
    detail: `${n} words, ${chars} chars, about ${secs.toFixed(1)}s spoken (want 5-12 words)`,
  };
}

function hookSpecificity(text: string): Check {
  const nums = (text.match(NUMBER_RE) ?? []).map((n) => n.trim()).filter(Boolean);
  const propers = new Set(text.match(PROPER_RE) ?? []);
  const low = words(text).map((w) => w.toLowerCase().replace(/'$/, ''));
  const spoken = low.filter((w) => SPOKEN_NUMBERS.has(w) || MONEY_WORDS.has(w));
  const hits = nums.length + propers.size + spoken.length;
  const found = [...nums.slice(0, 2), ...[...propers].sort().slice(0, 2), ...spoken.slice(0, 2)].join(', ');
  return {
    name: 'SPECIFICITY',
    score: hits === 0 ? 15 : clamp(45 + hits * 30),
    detail: hits
      ? `${hits} concrete marker(s): ${found}`
      : 'no number, no name, nothing checkable',
  };
}

function hookStakes(text: string): Check {
  const markers = [...new Set(words(text).map((w) => w.toLowerCase().replace(/'$/, '')).filter((w) => STAKES.has(w)))];
  if (/(?:\$|rs\.?\s?|pkr\s?)\s?\d/i.test(text)) markers.push('a price');
  const n = markers.length;
  return {
    name: 'STAKES',
    score: n === 0 ? 20 : n === 1 ? 70 : 100,
    detail: n ? `${n} tension marker(s): ${markers.slice(0, 4).join(', ')}` : 'nothing is at stake in this line',
  };
}

function hookFrontload(text: string): Check {
  const w = words(text);
  if (!w.length) return { name: 'FRONTLOAD', score: 0, detail: 'empty' };
  const low = w.map((x) => x.toLowerCase().replace(/'$/, ''));
  const opener = low.slice(0, 2).join(' ');
  const weak = WEAK_OPENERS.find((x) => opener.startsWith(x) || low[0] === x);

  let payload: number | null = null;
  for (let i = 0; i < low.length; i++) {
    const token = low[i];
    const isNumber = new RegExp(`^${NUMBER_RE.source}$`, 'i').test(w[i]);
    const isProper = i > 0 && /^[A-Z][a-z]{2,}$/.test(w[i]);
    if (STAKES.has(token) || SPOKEN_NUMBERS.has(token) || MONEY_WORDS.has(token) || isNumber || isProper) {
      payload = i;
      break;
    }
  }

  const base =
    payload === null ? 30 : payload <= 3 ? 100 : payload <= 6 ? 70 : 40;
  const where =
    payload === null
      ? 'no payload word anywhere in the line'
      : payload <= 3
        ? `payload at word ${payload + 1}`
        : `payload at word ${payload + 1}, too late`;
  return {
    name: 'FRONTLOAD',
    score: clamp(base - (weak ? 30 : 0)),
    detail: where + (weak ? `; weak opener "${weak}"` : ''),
  };
}

function hookAddress(text: string): Check {
  const low = text.toLowerCase();
  const first = words(text)[0]?.toLowerCase().replace(/'$/, '');
  if (/\b(you|your|you're|youre|yourself|aap|tum)\b/.test(low)) {
    return { name: 'ADDRESS', score: 100, detail: 'speaks to the viewer' };
  }
  if (first && IMPERATIVES.has(first)) {
    return { name: 'ADDRESS', score: 90, detail: `imperative opener ("${first}")` };
  }
  if (/\b(i|my|me|we|our)\b/.test(low)) {
    return { name: 'ADDRESS', score: 70, detail: 'first person, no viewer named' };
  }
  return { name: 'ADDRESS', score: 35, detail: 'third person, nobody in the room' };
}

/** Score one hook on the five things strong openings have in common. */
export function scoreHook(text: string): HookScore {
  const checks = [hookLength(text), hookSpecificity(text), hookStakes(text), hookFrontload(text), hookAddress(text)];
  const dealbreakers = DEALBREAKERS.filter((d) => d.re.test(text)).map((d) => d.why);
  const { score, weakest } = combine(checks);
  const overall = clamp(score - dealbreakers.length * 15);
  const low = Math.min(...checks.map((c) => c.score ?? 100));
  const verdict: HookScore['verdict'] =
    overall >= 70 && low >= 55 && !dealbreakers.length ? 'STRONG' : overall >= 50 ? 'OK' : 'WEAK';
  return { text, score: overall, verdict, checks, dealbreakers, weakest };
}

// ── the caption linter ──────────────────────────────────────────────────────

/** Instagram's hard caption limit. */
const CAPTION_LIMIT = 2200;
/** Roughly where the feed cuts to "... more". An approximation, by design. */
export const FOLD = 125;
/** The cap per post or reel since 18 December 2025, down from thirty. */
export const HASHTAG_CAP = 5;

const FILLER_TAGS = new Set([
  '#viral', '#fyp', '#explore', '#explorepage', '#foryou', '#foryoupage',
  '#trending', '#instagood', '#love', '#follow', '#like4like', '#reels',
  '#reelsinstagram', '#viralreels', '#instadaily', '#viralpost', '#trend',
]);

const ASKS: { re: RegExp; name: string }[] = [
  { re: /\bcomment (?:the word |")?[A-Z0-9]{2,}\b/i, name: 'comment a keyword' },
  { re: /\b(?:dm|message) (?:me|us)\b/i, name: 'DM us' },
  { re: /\bsave (?:this|it)\b/i, name: 'save this' },
  { re: /\bshare (?:this|it)\b/i, name: 'share this' },
  { re: /\bfollow (?:me|us|for)\b/i, name: 'follow' },
  { re: /\blink in (?:my |our )?bio\b/i, name: 'link in bio' },
  { re: /\b(?:swipe|tap) (?:through|left|right|for|to)\b/i, name: 'swipe or tap' },
  { re: /\bdownload (?:the app|velocity)\b/i, name: 'download the app' },
  { re: /\btell (?:me|us)\b|\bwhat would you\b|\bwhich one\b/i, name: 'answer a question' },
];

const CONCRETE_RE = /\$\s?\d|\b\d[\d,.]*\b|(?<!^)\b[A-Z][a-z]{2,}\b/m;
const LINK_RE = /https?:\/\/\S+|\bwww\.\S+/i;

export type Status = 'PASS' | 'WARN' | 'FAIL';

export interface CaptionLint {
  characters: number;
  /** Exactly what a scrolling stranger sees before "... more". */
  visible: string;
  truncated: boolean;
  hashtags: string[];
  asks: string[];
  checks: { name: string; status: Status; detail: string }[];
  verdict: 'READY' | 'REVIEW' | 'FIX';
}

/**
 * Lint the caption as it will actually be posted — hashtags included, because
 * the fold does not care which field a word came from.
 */
export function lintCaption(raw: string, keywords: string[] = []): CaptionLint {
  const text = raw.trim();
  const chars = text.length;
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const tags = (text.match(/(?:^|\s)(#[A-Za-z0-9_]+)/g) ?? []).map((t) => t.trim());
  const emoji = (text.match(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu) ?? []).length;
  const visible = chars <= FOLD ? text : text.slice(0, FOLD);
  const asks = ASKS.filter((a) => a.re.test(text)).map((a) => a.name);
  const filler = tags.filter((t) => FILLER_TAGS.has(t.toLowerCase()));

  const checks: CaptionLint['checks'] = [];
  const add = (name: string, status: Status, detail: string) => checks.push({ name, status, detail });

  add('LENGTH', chars > CAPTION_LIMIT ? 'FAIL' : 'PASS', `${chars} / ${CAPTION_LIMIT} characters`);

  if (!firstLine) {
    add('FIRST LINE', 'FAIL', 'the caption opens on a blank line');
  } else if (firstLine.startsWith('#') || firstLine.startsWith('@')) {
    add('FIRST LINE', 'FAIL', 'opens on a hashtag or a mention, which is the one position worth a sentence');
  } else if (firstLine.length > FOLD) {
    add(
      'FIRST LINE',
      'WARN',
      `${firstLine.length} characters, so it is cut at ${FOLD} mid-thought. Fine if the cut is a cliffhanger, bad if it is a subordinate clause`,
    );
  } else {
    add('FIRST LINE', 'PASS', `${firstLine.length} characters, lands whole`);
  }

  add(
    'HOOK IS CONCRETE',
    CONCRETE_RE.test(visible) ? 'PASS' : 'WARN',
    CONCRETE_RE.test(visible)
      ? 'a number or a name is visible before the tap'
      : 'nothing checkable before the tap',
  );

  if (tags.length > HASHTAG_CAP) {
    add(
      'HASHTAGS',
      'FAIL',
      `${tags.length} tags, over Instagram's cap of ${HASHTAG_CAP}. Tags past the fifth do nothing and the block reads as old`,
    );
  } else if (filler.length) {
    add(
      'HASHTAGS',
      'WARN',
      `${tags.length} tags, ${filler.length} of them generic (${filler.slice(0, 3).join(', ')}). Those describe nothing`,
    );
  } else {
    add('HASHTAGS', 'PASS', tags.length ? `${tags.length} tag(s): ${tags.join(' ')}` : 'no tags');
  }

  // A tag is misplaced when it sits inside the prose, not when a short caption
  // puts the trailing tag block inside the first 125 characters — that is
  // arithmetic, not a mistake, and the original Python flagged it as one.
  // What is worth catching is a hashtag used as a word mid-sentence, which
  // spends the hook on a label.
  const body = text.replace(/(?:\s*#[A-Za-z0-9_]+)+\s*$/, '');
  if (/(?:^|\s)#[A-Za-z0-9_]+/.test(body)) {
    add('TAG PLACEMENT', 'WARN', 'a hashtag sits inside the sentence rather than in the block at the end');
  } else {
    add('TAG PLACEMENT', 'PASS', 'tags are in one block at the end');
  }

  add(
    'LINKS',
    LINK_RE.test(text) ? 'WARN' : 'PASS',
    LINK_RE.test(text)
      ? 'a link in the caption, and captions are not clickable. Move it to the bio'
      : 'no dead links in the body',
  );

  if (asks.length === 1) add('ONE ASK', 'PASS', `one call to action: ${asks[0]}`);
  else if (!asks.length) add('ONE ASK', 'WARN', 'no call to action. Decide what this post is for');
  else add('ONE ASK', 'WARN', `${asks.length} asks (${asks.join(', ')}). Two asks is the same as none`);

  const density = (emoji * 100) / Math.max(chars, 1);
  add('EMOJI', density > 4 ? 'WARN' : 'PASS', `${emoji} emoji, ${density.toFixed(1)} per 100 characters`);

  const wanted = keywords.map((k) => k.trim()).filter(Boolean);
  if (wanted.length) {
    const low = text.toLowerCase();
    const missing = wanted.filter((k) => !low.includes(k.toLowerCase()));
    add(
      'SEARCH TERMS',
      !missing.length ? 'PASS' : missing.length < wanted.length ? 'WARN' : 'FAIL',
      `${wanted.length - missing.length}/${wanted.length} present${missing.length ? `. Missing: ${missing.join(', ')}` : ''}`,
    );
  }

  const fails = checks.filter((c) => c.status === 'FAIL').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  return {
    characters: chars,
    visible,
    truncated: chars > FOLD,
    hashtags: tags,
    asks,
    checks,
    verdict: fails ? 'FIX' : warns ? 'REVIEW' : 'READY',
  };
}

// ── the humaniser ───────────────────────────────────────────────────────────

/**
 * Characters a phone keyboard does not produce. They survive a copy-paste and
 * they are invisible in every editor anybody here owns, which is exactly why
 * they are worth stripping in code rather than asking a model not to emit them.
 */
const INVISIBLE_RE = /[\u200B\u2060\uFEFF\u00AD\u180E\u061C\u200E\u200F\u2063]|[\u{E0000}-\u{E007F}]/gu;
const HARD_SPACE_RE = /[\u00A0\u202F\u2009\u2007\u2003\u2002]/g;

/**
 * The zero-width joiner and non-joiner, which cannot go in the list above.
 *
 * A stray ZWJ is a fingerprint worth removing. A ZWJ *between two emoji* is
 * load-bearing: it is what makes a family emoji one glyph instead of three
 * people in a row, and deleting it visibly rewrites the caption. So they are
 * only stripped where an emoji is not on both sides of them \u2014 which is the one
 * place the Python this was ported from gets it wrong.
 */
const STRAY_JOINER_RE =
  /(?<![\u{1F300}-\u{1FAFF}\u2600-\u27BF])[\u200C\u200D]|[\u200C\u200D](?![\u{1F300}-\u{1FAFF}\u2600-\u27BF])/gu;

const TYPOGRAPHY: [RegExp, string][] = [
  [/\u2014/g, ', '],
  [/\u2013/g, '-'],
  [/[\u2018\u2019\u2032]/g, "'"],
  [/[\u201C\u201D]/g, '"'],
  [/\u2026/g, '...'],
  [/\u00B7/g, '-'],
  [/\u2022/g, '-'],
  [/\u2192/g, '->'],
];

/**
 * The stock vocabulary, with a plain replacement each. Short of the full 154 in
 * the original lexicon: the ones kept are the ones that actually turn up in
 * marketing copy for a ride-hailing app.
 */
const SLOP: [string, string][] = [
  ['delve into', 'look at'], ['delve', 'look'], ['dive deep into', 'get into'],
  ['deep dive', 'breakdown'], ['leverage', 'use'], ['leveraging', 'using'],
  ['utilize', 'use'], ['utilizing', 'using'], ['harness', 'use'],
  ['embark on', 'start'], ['foster', 'build'], ['facilitate', 'help'],
  ['showcase', 'show'], ['unlock', 'get'], ['elevate', 'improve'],
  ['streamline', 'simplify'], ['spearhead', 'lead'], ['underscores', 'shows'],
  ['underscore', 'show'], ['cultivate', 'build'], ['amplify', 'boost'],
  ['curated', 'picked'], ['curate', 'pick'], ['empower', 'let'],
  ['revolutionize', 'change'], ['revolutionise', 'change'], ['transformative', 'big'],
  ['robust', 'solid'], ['seamlessly', 'cleanly'], ['seamless', 'clean'],
  ['pivotal', 'key'], ['crucial', 'important'], ['vital', 'important'],
  ['comprehensive', 'complete'], ['cutting-edge', 'new'], ['game-changing', 'big'],
  ['game-changer', 'big deal'], ['groundbreaking', 'new'], ['unparalleled', 'unmatched'],
  ['invaluable', 'useful'], ['meticulously', 'carefully'], ['meticulous', 'careful'],
  ['myriad of', 'many'], ['myriad', 'many'], ['holistic', 'whole'],
  ['bespoke', 'custom'], ['innovative', 'new'], ['profound', 'big'],
  ['compelling', 'convincing'], ['tapestry', 'mix'], ['realm', 'world'],
  ['landscape', 'market'], ['testament to', 'proof of'], ['cornerstone', 'base'],
  ['paradigm', 'model'], ['synergy', 'overlap'], ['ecosystem', 'system'],
  ['plethora of', 'lots of'], ['plethora', 'lots'], ['moreover', 'also'],
  ['furthermore', 'also'], ['additionally', 'also'], ['nevertheless', 'still'],
  ['consequently', 'so'], ['in essence', 'basically'], ['in conclusion', 'so'],
  ['when it comes to', 'with'], ['in order to', 'to'], ['a wide range of', 'many'],
  ['supercharge', 'speed up'], ['skyrocket', 'raise'], ['unleash', 'release'],
  ['effortlessly', 'easily'], ['captivating', 'interesting'], ['breathtaking', 'striking'],
  ['must-have', 'worth having'], ['no-brainer', 'obvious'], ['hidden gem', 'good one'],
  ['secret sauce', 'the actual method'], ['ultimate guide', 'guide'], ['level up', 'improve'],
  ["in today's fast-paced world", 'right now'], ["in today's digital age", 'right now'],
  ["let's face it", ''], ["here's the thing", ''], ['picture this', ''],
  ["it's no secret that", ''], ["we've all been there", ''], ['let that sink in', ''],
  ['at the end of the day', ''], ['food for thought', ''], ['without further ado', ''],
  ['buckle up', ''], ['spoiler alert', ''], ['read that again', ''],
  ['save this for later', ''], ['stop scrolling', ''], ["don't scroll past this", ''],
  ["in today's video", ''], ['watch till the end', ''], ["you won't believe", ''],
  ['nobody is talking about this', 'few people do this'], ['this changed everything', 'this worked'],
  ['this is your sign to', ''], ['fast forward to today', 'now'], ['and just like that', ''],
  ['the rest is history', ''], ["run don't walk", ''], ["don't sleep on this", ''],
  ['follow for more', ''], ['double tap if', ''], ['tag someone who needs this', ''],
  ['let me know in the comments', ''], ['the algorithm loves', 'Instagram pushes'],
  ['beat the algorithm', 'get reach'], ['go viral overnight', 'get reach'],
];

/** Shapes that need judgement to fix, so they are reported, never rewritten. */
const STRUCTURES: { id: string; re: RegExp; name: string }[] = [
  { id: 'not-just', re: /\bit'?s not (?:just|only) [^.!?\n]{2,60}[,.] it'?s\b/i, name: '"It\'s not just X, it\'s Y"' },
  { id: 'not-only', re: /\bnot only\b[^.!?\n]{2,80}\bbut also\b/i, name: '"Not only X but also Y"' },
  { id: 'isnt-about', re: /\b(?:this|it) is(?:n'?t| not) about [^.!?\n]{2,60}[.!] it'?s about\b/i, name: '"It isn\'t about X. It\'s about Y."' },
  { id: 'the-result', re: /^\s*(?:the result|the best part|the kicker|the catch)\?\s*$/im, name: 'a one-word rhetorical line' },
  { id: 'heres-what', re: /\bhere'?s what (?:i|we) learned\b/i, name: '"Here\'s what I learned"' },
  { id: 'triad', re: /\b\w+, \w+,? and \w+\./, name: 'a rule-of-three triad' },
  { id: 'hashtag-wall', re: /(?:#\w+[ \t]*){6,}/, name: 'a hashtag wall' },
  { id: 'in-summary', re: /^\s*(?:in summary|to summarize|in conclusion)\b/im, name: 'an essay closer' },
  { id: 'engagement-bait', re: /\b(?:agree\?|thoughts\?|who else\b|am i wrong\?)\s*$/i, name: 'reflex engagement bait' },
  { id: 'stop-scroll', re: /^\s*(?:stop scrolling|don'?t scroll|wait[,.]? don'?t scroll)\b/im, name: 'a "stop scrolling" opener' },
  { id: 'in-this-video', re: /\b(?:in (?:this|today'?s) (?:video|reel|post)|today i'?m going to show you|i'?m going to (?:show|teach) you how)\b/i, name: 'a video preamble' },
  { id: 'emoji-bullets', re: /^\s*[\u{1F300}-\u{1FAFF}\u2705\u27A1\u2B05\u2714\u2728]\s*\S/mu, name: 'emoji used as bullet points' },
  { id: 'caps-shout', re: /\b[A-Z]{3,}\b(?:\s+\b[A-Z]{3,}\b){2,}/, name: 'three or more shouted words in a row' },
  { id: 'follow-bait', re: /\b(?:follow for more|tag someone who|double tap if|share this if|comment below if)\b/i, name: 'reflex follow or tag bait' },
  { id: 'as-an-ai', re: /\bas an ai\b|\bas a language model\b/i, name: 'a model self-reference' },
];

export interface Humanised {
  text: string;
  /** What was changed, in words, for the work log. */
  changes: string[];
  /** Shapes a regex must not touch. These go back to the writer. */
  flagged: string[];
}

/**
 * Strip what can be stripped safely, and report what cannot.
 *
 * Deliberately conservative: it edits characters and stock phrases, never the
 * shape of a sentence. A regex that rewrites structure mangles exactly the
 * sentences worth keeping.
 */
export function humanise(input: string): Humanised {
  let text = input;
  const changes: string[] = [];

  const invisible = count(text, INVISIBLE_RE) + count(text, STRAY_JOINER_RE);
  if (invisible) {
    text = text.replace(INVISIBLE_RE, '').replace(STRAY_JOINER_RE, '');
    changes.push(`${invisible} invisible character(s) removed`);
  }

  const hard = count(text, HARD_SPACE_RE);
  if (hard) {
    text = text.replace(HARD_SPACE_RE, ' ');
    changes.push(`${hard} hard space(s) replaced`);
  }

  for (const [re, to] of TYPOGRAPHY) {
    const n = count(text, re);
    if (n) {
      text = text.replace(re, to);
      changes.push(`${n} typographic character(s) replaced`);
    }
  }

  const replaced: string[] = [];
  for (const [find, to] of SLOP) {
    const re = new RegExp(`\\b${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'gi');
    if (re.test(text)) {
      text = text.replace(re, to);
      replaced.push(find);
    }
  }
  if (replaced.length) changes.push(`stock wording replaced: ${replaced.slice(0, 6).join(', ')}`);

  // Punctuation orphaned by a deletion, and the double spaces a replacement
  // leaves behind.
  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?]){2,}/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const flagged = STRUCTURES.filter((s) => s.re.test(text)).map((s) => s.name);
  return { text, changes, flagged };
}

// ── the five-check panel ────────────────────────────────────────────────────

export interface HumanScore {
  score: number;
  verdict: 'PASS' | 'REVIEW' | 'FLAGGED';
  checks: Check[];
  weakest: string | null;
}

const SENTENCE_RE = /[^.!?\n]+[.!?]*/g;
const CONTRACTION_RE = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi;
const PRONOUN_RE = /\b(i|me|my|mine|we|us|our|you|your)\b/gi;
const NUMBERS_RE = /\b\d[\d,.]*%?\b|\$\d/g;

function sentences(text: string): string[] {
  return (text.match(SENTENCE_RE) ?? []).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 2);
}

/** Score how machine-written a draft looks, on signals public detectors key on. */
export function detectHuman(text: string): HumanScore {
  const w = text.match(/[A-Za-z']+/g) ?? [];
  const checks: Check[] = [];

  // Burstiness. Humans vary sentence length hard; models write even.
  const lens = sentences(text).map((s) => s.split(/\s+/).length);
  if (lens.length < 4) {
    checks.push({ name: 'BURSTINESS', score: null, detail: 'too short to judge' });
  } else {
    const m = mean(lens);
    const cv = m ? stdev(lens) / m : 0;
    checks.push({
      name: 'BURSTINESS',
      score: scale(cv, 0.7, 0.22),
      detail: `variation ${cv.toFixed(2)} across ${lens.length} sentences (want 0.55+)`,
    });
  }

  // Specificity. Numbers, names, things that can be checked.
  if (w.length < 25) {
    checks.push({ name: 'SPECIFICITY', score: null, detail: 'too short to judge' });
  } else {
    const hits = count(text, NUMBERS_RE) + new Set(text.match(PROPER_RE) ?? []).size;
    const density = (hits * 100) / w.length;
    checks.push({
      name: 'SPECIFICITY',
      score: scale(density, 6, 0.5),
      detail: `${hits} concrete markers, ${density.toFixed(1)} per 100 words (want 4+)`,
    });
  }

  // Stock vocabulary density.
  if (!w.length) {
    checks.push({ name: 'SLOP', score: null, detail: 'empty' });
  } else {
    let hits = 0;
    const found: string[] = [];
    for (const [find] of SLOP) {
      const re = new RegExp(`\\b${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'gi');
      const n = count(text, re);
      if (n) {
        hits += n;
        found.push(find);
      }
    }
    const density = (hits * 100) / w.length;
    checks.push({
      name: 'SLOP',
      score: scale(density, 0, 4),
      detail: `${hits} stock term(s), ${density.toFixed(1)} per 100 words${found.length ? ` (${found.slice(0, 4).join(', ')})` : ''}`,
    });
  }

  // The typographic fingerprint.
  const invisible = count(text, INVISIBLE_RE) + count(text, STRAY_JOINER_RE);
  const em = count(text, /\u2014/g);
  const curly = count(text, /[\u2018\u2019\u201C\u201D]/g);
  const ellipsis = count(text, /\u2026/g);
  const nbsp = count(text, HARD_SPACE_RE);
  const per1k = ((invisible * 4 + em * 2 + curly + ellipsis + nbsp) * 1000) / Math.max(text.length, 1);
  checks.push({
    name: 'FINGERPRINT',
    score: scale(per1k, 0, 12),
    detail: `${invisible} invisible, ${em} em dash, ${curly} curly quote, ${ellipsis} ellipsis, ${nbsp} hard space`,
  });

  // Voice: contractions, person, and the shapes models default to.
  const tells = STRUCTURES.filter((s) => s.re.test(text));
  if (w.length < 25) {
    checks.push({
      name: 'VOICE',
      score: tells.length ? clamp(100 - tells.length * 22) : null,
      detail: tells.length ? `${tells.length} structural tell(s): ${tells.map((t) => t.id).join(', ')}` : 'too short to judge',
    });
  } else {
    const per100 = 100 / w.length;
    const contractions = count(text, CONTRACTION_RE) * per100;
    const person = count(text, PRONOUN_RE) * per100;
    checks.push({
      name: 'VOICE',
      score: clamp(
        scale(contractions, 3, 0) * 0.35 + scale(person, 8, 1) * 0.35 + clamp(100 - tells.length * 22) * 0.3,
      ),
      detail: `${contractions.toFixed(1)} contractions, ${person.toFixed(1)} personal pronouns per 100 words, ${tells.length} structural tell(s)`,
    });
  }

  const { score, weakest } = combine(checks);
  const judged = checks.map((c) => c.score).filter((s): s is number => s !== null);
  const low = judged.length ? Math.min(...judged) : 100;
  return {
    score,
    verdict: score >= 70 && low >= 55 ? 'PASS' : score >= 50 ? 'REVIEW' : 'FLAGGED',
    checks,
    weakest,
  };
}

// ── the beat sheet ──────────────────────────────────────────────────────────

/** Past three seconds, the thumb has already decided. */
const HOOK_WINDOW = 3;
/** Seconds on one idea with nothing changing on screen. */
const MAX_BEAT = 4;
const WPM = 165;

export interface Beat {
  n: number;
  start: number;
  duration: number;
  line: string;
  concrete: boolean;
}

export interface BeatSheet {
  beats: Beat[];
  totalWords: number;
  totalSeconds: number;
  target: number | null;
  notes: string[];
  overruns: boolean;
}

/**
 * Time a script before anybody shoots it. The commonest failure on this desk is
 * not a bad script, it is ninety words written for a twenty-second reel.
 */
export function beatSheet(script: string, target: number | null = null): BeatSheet {
  const wps = WPM / 60;
  const lines = script
    .split(/(?<=[.!?])\s+|\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const beats: Beat[] = [];
  let at = 0;
  lines.forEach((line, i) => {
    const n = line.split(/\s+/).filter(Boolean).length;
    const duration = n / wps;
    beats.push({
      n: i + 1,
      start: at,
      duration,
      line,
      concrete: /\d/.test(line) || PROPER_RE.test(line),
    });
    at += duration;
  });

  const totalWords = script.split(/\s+/).filter(Boolean).length;
  const totalSeconds = totalWords / wps;
  const notes: string[] = [];

  if (beats.length && beats[0].duration > HOOK_WINDOW) {
    notes.push(
      `The hook takes ${beats[0].duration.toFixed(1)}s to say and it has ${HOOK_WINDOW}. Cut it to about ${Math.floor(HOOK_WINDOW * wps)} words.`,
    );
  }

  const long = beats.filter((b) => b.duration > MAX_BEAT).map((b) => b.n);
  if (long.length) {
    notes.push(
      `Beat(s) ${long.join(', ')} run past ${MAX_BEAT}s with nothing changing on screen. Split the line, or say what changes inside it.`,
    );
  }

  // Three beats in a row with nothing checkable in them is where people leave.
  let run = 0;
  for (const b of beats) {
    run = b.concrete ? 0 : run + 1;
    if (run >= 3) {
      notes.push('Three beats in a row with no number, name or object in them. Put something concrete in one of them.');
      break;
    }
  }

  if (beats.length > 1) {
    const firstWords = new Set(
      beats[0].line.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [],
    );
    const lastWords = beats[beats.length - 1].line.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
    if (!lastWords.some((w) => firstWords.has(w))) {
      notes.push('The last line does not loop back to the first. A rewatch is free reach; give it a reason.');
    }
  }

  let overruns = false;
  if (target) {
    const over = totalSeconds - target;
    if (over > 1.5) {
      overruns = true;
      notes.push(
        `${totalSeconds.toFixed(1)}s of script for a ${target}s cut. Cut about ${Math.ceil(over * wps)} words.`,
      );
    } else if (over < -4) {
      notes.push(`${Math.abs(over).toFixed(1)}s under target. Shoot it short rather than padding it.`);
    }
  }

  return { beats, totalWords, totalSeconds, target, notes, overruns };
}

// ── the one call the pipeline makes ─────────────────────────────────────────

export interface QualityReport {
  atMs: number;
  /** 0-100, the hook and the caption weighted evenly. */
  score: number;
  verdict: 'READY' | 'REVIEW' | 'FIX';
  hook: { text: string; score: number; verdict: HookScore['verdict']; weakest: string | null };
  caption: { score: number; verdict: CaptionLint['verdict']; visible: string; hashtags: number };
  human: { score: number; verdict: HumanScore['verdict']; weakest: string | null };
  timing: { seconds: number; target: number | null; overruns: boolean } | null;
  /** What is wrong, in the words the writer is handed to fix it. */
  notes: string[];
}

/**
 * Score one finished draft and say, in one line each, what would have to change.
 *
 * The notes are the output that matters: they are written to be pasted straight
 * into a rewrite prompt, which is what `script.ts` does with them when the
 * verdict comes back FIX.
 */
export function reviewDraft(params: {
  hook: string;
  caption: string;
  hashtags: string[];
  voiceover?: string;
  /** Seconds the format allows, for video. Null for stills. */
  seconds?: number | null;
  /** The search desk's phrases, when there are any. */
  keywords?: string[];
}): QualityReport {
  const assembled = params.hashtags.length
    ? `${params.caption}\n\n${params.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`
    : params.caption;

  const hook = scoreHook(params.hook);
  const caption = lintCaption(assembled, params.keywords ?? []);
  const human = detectHuman(`${params.caption}\n${params.voiceover ?? ''}`);
  const timing =
    params.voiceover && params.seconds ? beatSheet(params.voiceover, params.seconds) : null;

  const notes: string[] = [];

  for (const why of hook.dealbreakers) notes.push(`HOOK: ${why}`);
  if (hook.verdict === 'WEAK') {
    const weak = hook.checks.find((c) => c.name === hook.weakest);
    notes.push(
      `HOOK: "${params.hook}" scores ${Math.round(hook.score)}/100. Weakest is ${hook.weakest} — ${weak?.detail}. Rewrite it or use one of the alternatives you offered.`,
    );
  }

  for (const check of caption.checks) {
    if (check.status === 'FAIL') notes.push(`CAPTION: ${check.name} — ${check.detail}`);
  }
  if (caption.verdict === 'REVIEW') {
    const warn = caption.checks.find((c) => c.status === 'WARN');
    if (warn) notes.push(`CAPTION: ${warn.name} — ${warn.detail}`);
  }

  if (human.verdict === 'FLAGGED') {
    const weak = human.checks.find((c) => c.name === human.weakest);
    notes.push(`VOICE: reads as machine-written (${Math.round(human.score)}/100). ${human.weakest}: ${weak?.detail}`);
  }

  if (timing) for (const note of timing.notes) notes.push(`TIMING: ${note}`);

  // The hook and the caption are weighted evenly because they fail in the same
  // place: a stranger scrolling who gives the piece one second.
  const score = clamp(hook.score * 0.4 + (caption.verdict === 'FIX' ? 35 : caption.verdict === 'REVIEW' ? 70 : 95) * 0.4 + human.score * 0.2);
  const verdict: QualityReport['verdict'] =
    hook.dealbreakers.length || caption.verdict === 'FIX' || hook.verdict === 'WEAK' || (timing?.overruns ?? false)
      ? 'FIX'
      : notes.length
        ? 'REVIEW'
        : 'READY';

  return {
    atMs: Date.now(),
    score,
    verdict,
    hook: { text: params.hook, score: hook.score, verdict: hook.verdict, weakest: hook.weakest },
    caption: {
      score: caption.verdict === 'READY' ? 95 : caption.verdict === 'REVIEW' ? 70 : 35,
      verdict: caption.verdict,
      visible: caption.visible,
      hashtags: caption.hashtags.length,
    },
    human: { score: human.score, verdict: human.verdict, weakest: human.weakest },
    timing: timing ? { seconds: timing.totalSeconds, target: timing.target, overruns: timing.overruns } : null,
    notes,
  };
}
