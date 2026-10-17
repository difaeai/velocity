/**
 * The local writer itself — the part that chooses words without a model.
 *
 * It does not try to write like Claude. It does something a template engine can
 * actually do well, which `lint.ts` made possible: **generate every piece the
 * material allows, score them all, and keep the best one.**
 *
 * That inversion is the whole idea. The desk already owned a 900-line
 * deterministic critic — it scores a hook on length, specificity, stakes,
 * frontloading and whether the viewer is addressed; it lints the caption
 * against the fold, the hashtag cap and the one-ask rule; it times a voiceover
 * at 165 words a minute and fails a beat that runs past four seconds. All of
 * that was built to mark a model's homework. Pointed the other way it is a
 * fitness function, and a fitness function plus a few dozen honest candidates
 * is a writer. Not an imaginative one. A reliably publishable one.
 *
 * What that buys, concretely:
 *
 * - **It cannot invent a number.** Every candidate line declares the facts it
 *   needs and is discarded when they are missing, so the liability `script.ts`
 *   was built to avoid is structurally impossible here rather than merely
 *   discouraged. On a platform whose counters are still near zero this matters
 *   more than it did with a model.
 * - **It cannot have a bad day.** The chosen draft is the argmax over the
 *   candidate set, so the floor and the ceiling are the same piece.
 * - **It costs nothing and cannot fail.** No key, no network, no quota, no
 *   refusal, no 180-second timeout. It runs in a millisecond or two.
 *
 * And the honest limits, because they are the reason this is the fallback and
 * not the default: the ceiling is the material in `material.ts`. It will never
 * write a sentence nobody wrote down, it will never notice that today is
 * different, and across a long enough run the feed will read as a family of
 * shapes. Variety here is rotation plus selection, which is not the same thing
 * as having an idea. `claudeReady()` still wins whenever a key exists.
 */
import {
  beatSheet,
  humanise,
  reviewDraft,
  scoreHook,
  type QualityReport,
} from '../lint';
import { FORMAT_SPECS, type ContentFormat, type Frame } from '../types';
import { CITIES, ROUTES, materialFor, type AngleMaterial, type FactKey } from './material';

/** Spoken words per second, matching `lint.ts`'s 165 wpm. */
const WPS = 165 / 60;

/** Group a figure the way a Pakistani reader expects to see it. */
function grouped(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Facts arrive as a loose bag; only a positive number counts as present. */
function factNumber(facts: Record<string, number | string>, key: string): number | null {
  const raw = facts[key];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface Vars {
  /** Placeholder values, already formatted for reading aloud. */
  values: Record<string, string>;
  /** Facts that are genuinely present, so a line may name them. */
  present: Set<FactKey>;
}

/**
 * Build the placeholder bag, and record which facts are real.
 *
 * A fact that is zero, missing or unparseable is simply absent: no line that
 * names it survives the filter, which is HARD_RULES #1 made structural.
 */
export function factVars(facts: Record<string, number | string>, seed: number): Vars {
  const present = new Set<FactKey>();
  const values: Record<string, string> = {};

  const keys: [FactKey, string, (n: number) => string][] = [
    ['commissionRatePercent', 'rate', (n) => `${Math.round(n)}%`],
    ['averageFarePKR', 'fare', (n) => grouped(n)],
    ['approvedDrivers', 'drivers', (n) => grouped(n)],
    ['totalTripsCompleted', 'trips', (n) => grouped(n)],
    ['tripsLast7Days', 'weekTrips', (n) => grouped(n)],
    ['grossFaresLast7DaysPKR', 'gross', (n) => grouped(n)],
    ['totalDriverPayoutPKR', 'payout', (n) => grouped(n)],
  ];

  for (const [key, slot, format] of keys) {
    const n = factNumber(facts, key);
    if (n === null) continue;
    present.add(key);
    values[slot] = format(n);
  }

  // Rotated rather than random: the same date writes the same piece, which is
  // what makes a run reproducible when somebody asks why a post said Multan.
  values.city = CITIES[seed % CITIES.length];
  values.route = ROUTES[seed % ROUTES.length];

  return { values, present };
}

/**
 * The run's own date, taken from the facts it was handed.
 *
 * `gatherFacts` already stamps the day on every fact bag, and the stages are
 * called from a pipeline that does not thread a date through them. Reading it
 * from the facts keeps the local stages drop-in at each call site instead of
 * requiring a new argument at nine of them.
 */
export function dateFrom(facts: Record<string, number | string>): string {
  const date = facts.date;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date().toISOString().slice(0, 10);
}

/** A date is the rotation's clock, so a fortnight is not all one city. */
export function seedFor(date: string): number {
  let n = 0;
  for (const ch of date) n = (n * 31 + ch.charCodeAt(0)) % 100_000;
  return n;
}

/** Fill `{slot}` placeholders. An unknown slot leaves the line unusable. */
function fill(text: string, vars: Vars): string | null {
  let missing = false;
  const out = text.replace(/\{(\w+)\}/g, (_, slot: string) => {
    const value = vars.values[slot];
    if (value === undefined) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : out;
}

export interface HookCandidate {
  text: string;
  formula: string;
  score: number;
}

/**
 * Every opening this angle can legally produce today, best first.
 *
 * Lines needing a fact we do not have are dropped before scoring, and anything
 * said recently is dropped after it — `recentHooks` is the only thing standing
 * between a rotation and a feed that repeats itself every nine days.
 */
export function hookCandidates(params: {
  material: AngleMaterial;
  vars: Vars;
  recentHooks: string[];
}): HookCandidate[] {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const recent = new Set(params.recentHooks.map(normalise));

  const seen = new Set<string>();
  const out: HookCandidate[] = [];

  for (const seed of params.material.hooks) {
    if (seed.needs.some((key) => !params.vars.present.has(key))) continue;
    const text = fill(seed.text, params.vars);
    if (!text) continue;

    const key = normalise(text);
    if (!key || seen.has(key) || recent.has(key)) continue;
    seen.add(key);

    out.push({ text, formula: seed.formula, score: scoreHook(text).score });
  }

  return out.sort((a, b) => b.score - a.score);
}

/** The caption arrangements worth trying, in `compose.ts`'s own order. */
function arrangements(body: string[], short: string): string[][] {
  const long = body.filter((l) => l.split(/\s+/).length >= 14);
  const brief = body.filter((l) => l.split(/\s+/).length < 14);

  // Burstiness is a real check, not a stylistic preference: `detectHuman`
  // scores sentence-length variation and marks even prose as machine-written.
  // Pairing a long sentence with a short one is the cheapest way to earn it,
  // so the arrangements below are deliberately uneven.
  return [
    [...body.slice(0, 2), short],
    [...(long.length ? [long[0]] : []), ...(brief.length ? [brief[0]] : []), short],
    [...body.slice(0, 3)],
    [body[0] ?? '', short],
  ].map((lines) => lines.filter(Boolean));
}

/** The five tags the playbook asks for: two niche, two mid, one broad. */
export function composeHashtags(material: AngleMaterial, seed: number): string[] {
  const pick = (pool: string[], n: number): string[] =>
    pool.length <= n ? pool : Array.from({ length: n }, (_, i) => pool[(seed + i) % pool.length]);

  const tags = [...pick(material.tags.niche, 2), ...pick(material.tags.mid, 2), ...pick(material.tags.broad, 1)];
  return [...new Set(tags.map((t) => t.replace(/^#/, '')))].slice(0, 5);
}

/** The shots or slides, as many as the format takes. */
export function composeFrames(material: AngleMaterial, vars: Vars, count: number): Frame[] {
  const scenes = material.scenes.map((s) => fill(s, vars) ?? s);
  const overlays = material.overlays.map((o) => fill(o, vars) ?? o);

  return Array.from({ length: Math.max(1, count) }, (_, i) => ({
    scene: scenes[i % scenes.length],
    overlay: overlays[i % overlays.length],
  }));
}

/** A beat the timer counts as checkable, by exactly the timer's own rule. */
function isConcrete(line: string): boolean {
  return /\d/.test(line) || /(?!^)\b[A-Z][a-z]{2,}\b/.test(line);
}

const sentencesOf = (s: string): string[] => s.split(/(?<=[.!?])\s+/).filter(Boolean);

/** The longest run of beats with nothing checkable in them. */
function longestBlindRun(beats: string[]): number {
  let run = 0;
  let worst = 0;
  for (const beat of beats) {
    run = isConcrete(beat) ? 0 : run + 1;
    if (run > worst) worst = run;
  }
  return worst;
}

/** Every ordering of a short list, in a fixed order so a run is reproducible. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

/**
 * Order the spoken lines so three beats never run past with nothing checkable
 * in them — a fault `beatSheet` reports, and one the material cannot prevent on
 * its own because whether a run forms depends on which hook won and on the
 * closing line, neither of which the spoken lines know about.
 *
 * The material's own order is tried first and kept whenever it works, because
 * that order is somebody's argument and reordering it is a cost. Only when it
 * would be marked down does this search the orderings for one that is not.
 *
 * Exhaustive, which sounds worse than it is: five lines is 120 orderings of a
 * string compare, and the alternative — a greedy pass that pulls the next
 * concrete line forward — provably misses the case that matters, where the run
 * forms across the last line and the close rather than in the middle.
 */
function interleave(hook: string, lines: string[], close: string): string[] {
  const head = sentencesOf(hook);
  const tail = sentencesOf(close);
  const blind = (order: string[]) => longestBlindRun([...head, ...order.flatMap(sentencesOf), ...tail]);

  if (blind(lines) <= 2) return lines;

  let best = lines;
  let worst = blind(lines);
  for (const order of permutations(lines)) {
    const run = blind(order);
    if (run <= 2) return order;
    if (run < worst) {
      worst = run;
      best = order;
    }
  }

  // Nothing reaches two, which means the material itself is short of names and
  // numbers. The least bad ordering goes out and the critic says so in a note.
  return best;
}

/** Words too common to count as a line looping back to the hook. */
const STOPWORDS = new Set(['your', 'that', 'this', 'with', 'from', 'they', 'them', 'have', 'does', 'what', 'when', 'ever', 'never', 'just', 'only', 'then', 'than', 'into', 'about']);

/** The timer's own loop test: a shared long word between first beat and last. */
function loopsBack(hook: string, close: string): boolean {
  const first = sentencesOf(hook)[0] ?? hook;
  const opening = new Set((first.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !STOPWORDS.has(w)));
  if (!opening.size) return false;
  const last = sentencesOf(close).at(-1) ?? close;
  return (last.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).some((w) => opening.has(w));
}

/**
 * Pick the closing line that actually loops back to this hook.
 *
 * A rewatch is free reach and the timer says so, but the loop can only be
 * checked once the hook is known. The written close is preferred and the
 * alternatives exist for the openings it does not reach.
 */
function chooseClose(material: AngleMaterial, vars: Vars, hook: string): string {
  const resolve = (raw: string) => fill(raw, vars) ?? raw;
  const primary = resolve(material.spokenClose);
  if (loopsBack(hook, primary)) return primary;

  for (const alt of material.spokenCloseAlts ?? []) {
    const candidate = resolve(alt);
    if (loopsBack(hook, candidate)) return candidate;
  }
  return primary;
}

/**
 * The spoken script, written to the seconds the format allows.
 *
 * Lines are added while there is time for them rather than written and then
 * cut, because `beatSheet` treats an overrun as a hard fault and a template has
 * no way to shorten its own sentence.
 */
function composeVoiceover(params: {
  material: AngleMaterial;
  vars: Vars;
  hook: string;
  seconds: number;
}): string {
  const close = chooseClose(params.material, params.vars, params.hook);
  const budget = params.seconds * WPS;

  const count = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const lines = [params.hook];
  let used = count(params.hook) + count(close);

  // Which lines fit is settled BEFORE they are ordered, and the order matters:
  // interleaving first and trimming afterwards throws away the line the
  // ordering was relying on, which silently reintroduces the very run it just
  // solved. Choose the set, then order the set.
  const affordable: string[] = [];
  for (const raw of params.material.spoken) {
    const line = fill(raw, params.vars);
    if (!line) continue;
    const n = count(line);
    if (used + n > budget) continue;
    affordable.push(line);
    used += n;
  }

  lines.push(...interleave(params.hook, affordable, close));

  lines.push(close);
  return lines.join(' ');
}

/**
 * Which of two scored drafts is actually the better one.
 *
 * Not simply the higher score, and that distinction is the whole reason this
 * function exists: `reviewDraft` computes `score` from the hook, the caption
 * verdict and the voice, and does not subtract anything for a note. So a draft
 * whose hook takes a third of a second too long to say, or whose last line
 * never loops back, scores exactly as well as one with nothing wrong with it.
 * Maximising the score alone therefore plateaus on a draft the critic still
 * has three complaints about.
 *
 * Fewer complaints wins first, and the score only breaks a tie. That is what
 * turns the candidate search from "pick the highest number" into "find the one
 * nothing is wrong with", which is the thing actually worth publishing.
 */
function better(candidate: QualityReport, incumbent: QualityReport): boolean {
  if (candidate.notes.length !== incumbent.notes.length) {
    return candidate.notes.length < incumbent.notes.length;
  }
  return candidate.score > incumbent.score;
}

export interface LocalDraft {
  hook: string;
  hookFormula: string;
  hookVariants: string[];
  frames: Frame[];
  voiceover: string;
  cta: string;
  caption: string;
  hashtags: string[];
  quality: QualityReport;
  /** One line for the console: what the search actually chose, and from how many. */
  note: string;
}

/**
 * Write the piece: build every legal candidate, score each with the desk's own
 * critic, and return the best.
 *
 * The search is small on purpose — a handful of openings against a handful of
 * caption arrangements. It is not hill-climbing towards a clever draft, it is
 * refusing to ship the worst one, which is the part a template engine can be
 * trusted with.
 */
export function composeDraft(params: {
  angle: string;
  format: ContentFormat;
  facts: Record<string, number | string>;
  date: string;
  recentHooks: string[];
  /** The search desk's phrases, so the caption is linted against them. */
  keywords: string[];
}): LocalDraft {
  const material = materialFor(params.angle);
  const spec = FORMAT_SPECS[params.format];
  const seed = seedFor(params.date);
  const vars = factVars(params.facts, seed);

  const candidates = hookCandidates({ material, vars, recentHooks: params.recentHooks });
  // Everything this angle can say has been said recently. Saying the best of
  // it again beats saying nothing, so the filter is dropped rather than the run.
  const pool = candidates.length ? candidates : hookCandidates({ material, vars, recentHooks: [] });
  if (!pool.length) {
    throw new Error(
      `The local writer has no usable opening for "${params.angle}". Every candidate needed a fact that is missing.`,
    );
  }

  // Rotate the top of the pool by date so two equally strong openings are not
  // always resolved the same way. Below the top band, order is score alone.
  const band = pool.filter((c) => c.score >= pool[0].score - 8);
  const rotated = [...band.slice(seed % band.length), ...band.slice(0, seed % band.length)];
  const ordered = [...rotated, ...pool.filter((c) => !band.includes(c))];

  const cta = fill(material.cta, vars) ?? material.cta;
  const short = fill(material.spokenClose, vars) ?? material.spokenClose;
  const body = material.body.map((l) => fill(l, vars) ?? l);
  const hashtags = composeHashtags(material, seed);
  const frames = composeFrames(material, vars, spec.kind === 'video' ? 4 : spec.slides);

  let best: LocalDraft | null = null;
  let tried = 0;

  for (const candidate of ordered) {
    const voiceover =
      spec.kind === 'video' && spec.seconds
        ? humanise(composeVoiceover({ material, vars, hook: candidate.text, seconds: spec.seconds })).text
        : '';

    for (const lines of arrangements(body, short)) {
      tried += 1;
      const caption = humanise([candidate.text, '', ...lines, '', cta].join('\n')).text;
      const quality = reviewDraft({
        hook: candidate.text,
        caption,
        hashtags,
        voiceover,
        seconds: spec.seconds,
        keywords: params.keywords,
      });

      const draft: LocalDraft = {
        hook: candidate.text,
        hookFormula: candidate.formula,
        hookVariants: ordered
          .filter((c) => c.formula !== candidate.formula && c.text !== candidate.text)
          .slice(0, 3)
          .map((c) => c.text),
        frames,
        voiceover,
        cta,
        caption,
        hashtags,
        quality,
        note: '',
      };

      if (!best || better(quality, best.quality)) best = draft;
      // READY is the ceiling the critic can award. Nothing is gained by
      // scoring the rest of the grid once something has reached it.
      if (quality.verdict === 'READY') {
        best = draft;
        best.note = `Chose "${candidate.formula}" from ${ordered.length} openings; ${tried} drafts scored, this one READY at ${Math.round(quality.score)}.`;
        return best;
      }
    }
  }

  const chosen = best as LocalDraft;
  chosen.note = `Chose "${chosen.hookFormula}" from ${ordered.length} openings; ${tried} drafts scored, best was ${chosen.quality.verdict} at ${Math.round(chosen.quality.score)}.`;
  return chosen;
}

/** The timing of a finished local script, for the console and the tests. */
export function timing(voiceover: string, seconds: number | null): ReturnType<typeof beatSheet> | null {
  return voiceover ? beatSheet(voiceover, seconds) : null;
}
