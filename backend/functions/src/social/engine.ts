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

import { claudeReady, claudeText } from './claude';
import { geminiReady, geminiText } from './gemini';
import { freeModelReady, freeModelText } from './freeModel';

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
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

/** Which engine a call made right now would go to. */
export function activeEngine(): Engine {
  if (claudeReady()) return 'claude';
  if (geminiReady()) return 'gemini';
  if (freeModelReady()) return 'free';
  return 'local';
}

/**
 * True when a real model will answer. The name is deliberately not
 * `claudeReady` any more: the question every stage is actually asking is
 * "will something think about this, or should I compose it myself?"
 */
export function modelReady(): boolean {
  return activeEngine() !== 'local';
}

export async function generateText(req: TextRequest): Promise<TextResult> {
  switch (activeEngine()) {
    case 'claude':
      return claudeText(req);
    case 'gemini':
      return geminiText(req);
    case 'free':
      return freeModelText(req);
    default:
      // Reached only by a caller that skipped `modelReady()`. Every stage
      // checks, so this is a programming error rather than a configuration
      // one, and it says so.
      throw new ModelError(
        'No model is configured. Every stage is meant to check modelReady() and compose locally instead.',
      );
  }
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
