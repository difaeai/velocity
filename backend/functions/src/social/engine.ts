/**
 * The one door to a model — whichever one this deployment actually has.
 *
 * Every agent on the desk thinks through this file. It does not know how to
 * talk to anybody; it decides who answers and hands the reply back in one
 * shape, so that no stage upstream contains the name of a vendor.
 *
 * **The order, and why it is this order:**
 *
 * 1. **Claude** (`ANTHROPIC_API_KEY`) — the best writing on the desk and the
 *    only one that is paid for. If it is configured, somebody chose to pay for
 *    it and it wins.
 * 2. **Gemini's free tier** (`GEMINI_KEY_RESEARCH`) — the only engine here
 *    that is free *and* can search, which is why it goes above the next one:
 *    with this key the morning market read is a real read again rather than an
 *    honest refusal. See `gemini.ts`.
 * 3. **A free model** (`FREE_MODEL_KEY`) — any OpenAI-compatible endpoint,
 *    Groq by default. A real model with real judgement, which is the whole
 *    difference from the fourth option. It has one cost that is not money and
 *    is stated plainly on the overview: it cannot search the web, so there is
 *    still no market read. See `freeModel.ts` for why the provider is three
 *    environment variables rather than a file.
 * 4. **Local** — no key at all. `local/` composes from the brand material and
 *    scores every candidate with `lint.ts`. Reliable, free, and plainer; it
 *    cannot read a change request or have an idea nobody wrote down.
 *
 * Whichever one is first is the one that answers *everything* that day — the
 * desk is deliberately not split by task. A deployment where Claude writes and
 * Gemini searches would be cheaper by a few cents a month and would cost the
 * one property this file exists to keep: that one engine, named in one place,
 * answered every stage of a piece.
 *
 * Stages ask `modelReady()` and take their local branch when it is false. They
 * do **not** ask which engine answered: a stage that behaves differently for
 * the free model than for Claude is a stage that will be wrong for the next
 * provider.
 * The one legitimate place to care is the console, which says which one is
 * running. `research.ts` looks like an exception and is not: it cares whether
 * the answer was *grounded*, which is a property of the request, and it
 * already treats a refusal as "no market read today".
 */
import { logger } from 'firebase-functions';

import { overBudget, warmAi } from '../ai/config';
import { claudeReady, claudeText } from './claude';
import { geminiReady, geminiText } from './gemini';
import { freeModelReady, freeModelText } from './freeModel';
import { HOUSE, currentWorkspace } from './scope';

export type Engine = 'claude' | 'gemini' | 'free' | 'local';

export interface GroundedSource {
  title: string;
  url: string;
}

export interface TextResult {
  text: string;
  /** Populated only on grounded calls — what the model actually read. */
  sources: GroundedSource[];
  searches: string[];
}

export interface TextRequest {
  /** The configured model id. Each engine corrects one that is not its own. */
  model: string;
  system: string;
  prompt: string;
  /** Let the model search the web first. Costs calls; buys today's facts. */
  grounded?: boolean;
  /** The reply must be one JSON object. Set by `generateJson`, never by hand. */
  json?: boolean;
  /**
   * A video to watch with the prompt. Only Gemini can, so a caller that sets
   * this calls `geminiText` directly rather than going through the router.
   */
  video?: { data: string; mimeType: string } | { uri: string };
  /** What is being asked for, for the AI meter ("The market read"). `generateJson` fills it. */
  what?: string;
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

/**
 * Engines whose account refused for money or a spent quota, and until when.
 * Per instance on purpose: each instance pays one failed call to learn it, and
 * nothing needs clearing when the credit comes back — the hour simply runs out.
 */
const benchedUntil: Partial<Record<Engine, number>> = {};
const BENCH_MS = 3600_000;
const benched = (e: Engine): boolean => (benchedUntil[e] ?? 0) > Date.now();

/**
 * A refusal that trying again this hour will not change: no credit left,
 * billing off, a spent quota. Gemini answered "402: Your prepayment credits are
 * depleted" on 2026-10-24 and, with nothing behind it, the desk stopped writing.
 */
export function outOfCredit(message: string): boolean {
  return /^(402|429)\b|credit|quota|billing|RESOURCE_EXHAUSTED/i.test(message);
}

/**
 * The provider no longer serves the model we asked for. Groq shut down
 * `llama-3.3-70b-versatile` on 2026-08-16; every story in the November batch
 * then failed on "404: The model … does not exist" instead of falling through
 * to the local writer. Retrying this hour changes nothing, so it sits out too.
 */
export function modelGone(message: string): boolean {
  return /^404\b|does not exist|decommissioned|model_not_found|no longer (available|supported)/i.test(message);
}

/**
 * Which engine a call made right now would go to. Gemini also sits out for a
 * workspace that has spent this month's AI budget (`ai/config.ts`), so the
 * desk carries on, on the free model or the local writer, instead of the bill.
 */
export function activeEngine(wid: string = currentWorkspace()): Engine {
  // The house only: a customer's month is priced and metered on Gemini, and an
  // unmetered Claude call would let their plan's allowance run without limit.
  if (claudeReady() && !benched('claude') && wid === HOUSE) return 'claude';
  if (geminiReady() && !benched('gemini') && !overBudget(wid)) return 'gemini';
  if (freeModelReady() && !benched('free')) return 'free';
  return 'local';
}

/**
 * True when a real model will answer. The name is deliberately not
 * `claudeReady` any more: the question every stage is actually asking is
 * "will something think about this, or should I compose it myself?"
 */
export function modelReady(wid?: string): boolean {
  return activeEngine(wid) !== 'local';
}

/**
 * Ask whichever engine is first. One that is out of credit sits out for an hour
 * and the next one answers the same request — the desk keeps writing on the
 * free model rather than stopping because one account ran dry.
 */
export async function generateText(req: TextRequest): Promise<TextResult> {
  await warmAi();
  for (;;) {
    const engine = activeEngine();
    try {
      switch (engine) {
        case 'claude':
          return await claudeText(req);
        case 'gemini':
          return await geminiText(req);
        case 'free':
          return await freeModelText(req);
        default:
          // Reached only by a caller that skipped `modelReady()`. Every stage
          // checks, so this is a programming error rather than a configuration
          // one, and it says so.
          throw new ModelError(
            'No model is configured. Every stage is meant to check modelReady() and compose locally instead.',
          );
      }
    } catch (e) {
      const message = (e as Error).message ?? '';
      if (engine === 'local' || !(outOfCredit(message) || modelGone(message))) throw e;
      benchedUntil[engine] = Date.now() + BENCH_MS;
      // `error`, not `message`: the logger's own message field overwrote the refusal, so nobody could read why.
      logger.warn('social: an engine refused; the next one answers', { engine, error: message.slice(0, 300) });
      // Only the local writer left: the stage composes it itself on its next call.
      if (activeEngine() === 'local') throw e;
    }
  }
}

/** Tests only: forget every bench. */
export function resetEngineBench(): void {
  for (const e of Object.keys(benchedUntil) as Engine[]) delete benchedUntil[e];
}

/**
 * Pull the first JSON object out of a reply. A model that has just been
 * searching the web tends to answer in prose with the object somewhere inside
 * it, and a fenced ```json block is the common shape, so both are handled
 * rather than insisted against.
 */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter((s): s is string => typeof s === 'string');

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/** Ask for one JSON object and get it back, or fail with what came instead. */
export async function generateJson<T>(
  req: TextRequest & { what: string },
): Promise<{ data: T; sources: GroundedSource[] }> {
  const result = await generateText({ ...req, json: true });
  const data = extractJson<T>(result.text);
  if (!data) {
    logger.error('social: could not parse a reply', { what: req.what, text: result.text.slice(0, 600) });
    throw new ModelError(`${req.what} came back in a shape that could not be read.`);
  }
  return { data, sources: result.sources };
}
