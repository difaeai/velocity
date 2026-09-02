/**
 * The one door to Claude. Every agent on the desk thinks with this file — Hina
 * researches through it, Qalam writes with it, Talha and Zara plan search with
 * it, Rang writes art direction with it, Raftar writes the cut with it, Bilal
 * writes the campaign brief with it, and Awaaz drafts every reply with it.
 *
 * Pictures and video do NOT come through here: Claude does not render images or
 * video, so `designer.ts` and `video.ts` still call Google for the frames and
 * the Veo render. The split is deliberate and it is the whole architecture —
 * **words and judgement are Claude's, pixels are Google's.**
 *
 * Four things are worth knowing before changing anything:
 *
 * 1. **The official SDK, not raw REST.** The parts of this API worth having —
 *    adaptive thinking, server-side search, refusal fallbacks — are typed,
 *    versioned and change shape. That is exactly what an SDK is for, and it is
 *    why this is the one vendor call in the desk that is not hand-rolled.
 * 2. **There is no temperature.** Current Claude models reject sampling
 *    parameters outright (HTTP 400). Variety comes from the prompt and from
 *    what each employee was told, not from a dial.
 * 3. **Thinking shares `max_tokens`.** Adaptive thinking spends part of the
 *    same budget as the answer, so there is one generous ceiling here rather
 *    than a per-caller number that used to be sized for the visible reply.
 * 4. **A refusal is survivable.** This runs unattended at 10am. If a safety
 *    classifier declines a prompt, the request re-runs on the fallback model
 *    inside the same call rather than losing the day's post — and if the whole
 *    chain declines, the run says so in words instead of failing obscurely.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions';

import { DEFAULT_TEXT_MODEL } from './types';

/** Where a refusal lands rather than killing the run. */
const FALLBACK_MODEL = 'claude-opus-4-8';

/**
 * One ceiling for every call. Thinking and the answer share it, and you are
 * billed for what is produced rather than for the cap, so a generous number
 * costs nothing and a tight one truncates a reply into unparseable JSON.
 */
const MAX_TOKENS = 16_000;

/** A grounded read is allowed this many searches before it must answer. */
const MAX_SEARCHES = 8;

/** Long enough for a grounded read with thinking; short enough to never hang. */
const REQUEST_TIMEOUT_MS = 180_000;

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeError';
  }
}

/** True when anything on this desk can think at all. */
export function claudeReady(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

let client: Anthropic | null = null;

/** Built on first use, not at import: the key is absent in tests and locally. */
function anthropic(): Anthropic {
  if (!claudeReady()) {
    throw new ClaudeError(
      'ANTHROPIC_API_KEY is not configured, so the content team cannot work. Add it to the backend secrets and redeploy.',
    );
  }
  if (!client) client = new Anthropic({ timeout: REQUEST_TIMEOUT_MS });
  return client;
}

/**
 * The model id is a console field, because model names change and a text box
 * beats a redeploy. It is also a text box, which is why a value that cannot be
 * a Claude model is corrected here rather than sent to the API to fail — the
 * common case being a Gemini id left behind from before this desk moved.
 */
export function resolveModel(configured: string | undefined): string {
  const model = (configured ?? '').trim();
  if (model.startsWith('claude-')) return model;
  if (model) {
    logger.warn('social: ignoring a text model that is not a Claude model', {
      configured: model,
      using: DEFAULT_TEXT_MODEL,
    });
  }
  return DEFAULT_TEXT_MODEL;
}

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
  model: string;
  system: string;
  prompt: string;
  /** Let the model search the web first. Costs calls; buys today's facts. */
  grounded?: boolean;
}

export async function generateText(req: TextRequest): Promise<TextResult> {
  const model = resolveModel(req.model);

  let response;
  try {
    response = await anthropic().beta.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      // Explicit rather than implied: on Opus 5 adaptive is the default, but the
      // model id above is editable, and on Opus 4.8 omitting this means no
      // thinking at all.
      thinking: { type: 'adaptive' },
      ...(req.grounded
        ? { tools: [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: MAX_SEARCHES }] }
        : {}),
      // A policy decline on an unattended run is not worth losing the day's
      // post over: the same request re-runs on the fallback inside this call.
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: FALLBACK_MODEL }],
    });
  } catch (e) {
    // The API's own message names the problem — a bad model id, a spent
    // credit balance, a rate limit. "Request failed" would send somebody
    // hunting in the wrong file.
    if (e instanceof Anthropic.APIError) {
      throw new ClaudeError(`${e.status ?? 'API'}: ${e.message}`);
    }
    throw new ClaudeError((e as Error).message);
  }

  if (response.stop_reason === 'refusal') {
    throw new ClaudeError(
      `Claude declined this one${
        response.stop_details?.category ? ` (${response.stop_details.category})` : ''
      }. Rewrite the angle or the standing instructions and run it again.`,
    );
  }

  const chunks: string[] = [];
  const sources: GroundedSource[] = [];
  const searches: string[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      chunks.push(block.text);
      continue;
    }
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const query = (block.input as { query?: unknown }).query;
      if (typeof query === 'string' && query.trim()) searches.push(query.trim());
      continue;
    }
    if (block.type === 'web_search_tool_result') {
      // A failed search is an object here, not a list — and it is not fatal:
      // the model answers from what it already has, and the caller sees a read
      // with no sources rather than a dead run.
      if (!Array.isArray(block.content)) {
        logger.warn('social: a web search failed', { error: block.content.error_code });
        continue;
      }
      for (const result of block.content) {
        if (sources.some((s) => s.url === result.url)) continue;
        sources.push({ title: result.title || result.url, url: result.url });
      }
    }
  }

  const text = chunks.join('').trim();
  if (!text) {
    throw new ClaudeError(
      response.stop_reason === 'max_tokens'
        ? 'The reply ran past its length before anything usable came out.'
        : 'Claude returned nothing usable.',
    );
  }

  return { text, sources, searches };
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
  const result = await generateText(req);
  const data = extractJson<T>(result.text);
  if (!data) {
    logger.error('social: could not parse a reply', { what: req.what, text: result.text.slice(0, 600) });
    throw new ClaudeError(`${req.what} came back in a shape that could not be read.`);
  }
  return { data, sources: result.sources };
}
