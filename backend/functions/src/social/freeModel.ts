/**
 * The free engine: any OpenAI-compatible endpoint, Groq by default.
 *
 * This is the third of the four ways the desk can think — Claude when a paid
 * key exists, then Gemini's free tier, then this, then the local writer when
 * there is no key at all. `engine.ts` picks; this file only knows how to ask
 * an OpenAI-shaped API a question.
 *
 * It is below Gemini for one reason and it is in point 1: Gemini can search
 * and this cannot, so a deployment with both keys should be getting a real
 * market read. Everything else about it — the dialect, the quality, the
 * limits — is a matter of taste between two free models.
 *
 * **Why it is not written against one vendor.** Free tiers move: they change
 * their limits, their models and their terms, and the one thing you can
 * predict about the provider we are on today is that it is not the one we will
 * be on in a year. Nearly all of them speak the same dialect — `POST
 * {base}/chat/completions` with `messages` — so the provider here is three
 * environment variables rather than a file. Switching is a secret change, not
 * a deploy of new code, and nobody has to rewrite this adapter again.
 *
 *   FREE_MODEL_KEY  the API key. Its presence is what turns this engine on.
 *   FREE_MODEL_URL  base URL, default Groq's.
 *   FREE_MODEL_ID   model id, default a production Llama on Groq.
 *
 * Three things are worth knowing before changing anything:
 *
 * 1. **It cannot search the web, and it says so rather than guessing.** No
 *    OpenAI-compatible free endpoint has a server-side search tool — Gemini's
 *    does, which is the whole reason it sits above this one. A grounded request is
 *    refused outright so that `research.ts` returns the "could not read" shape
 *    the type already carries. What must never happen is a market read
 *    composed without a search: an invented trend is worse than an absent one,
 *    and that rule is older than this file.
 * 2. **JSON mode is asked for, and dropped if the provider refuses it.** Most
 *    of them support `response_format: {"type":"json_object"}` and a smaller
 *    model is markedly more reliable with it. One that does not answers 400,
 *    so the first such refusal turns it off for the life of the instance and
 *    the call is retried without it — `extractJson` was always the real net.
 * 3. **Free tiers are rate-limited, so retries are not optional.** A single
 *    piece is nine or ten calls in a row. A *daily* refusal is told apart from
 *    a per-minute one and is not retried: waiting fifty seconds to be refused
 *    again just burns the clock of a run that has one.
 */
import { logger } from 'firebase-functions';

import { DEFAULT_FREE_MODEL, DEFAULT_FREE_MODEL_URL } from './types';
import type { TextRequest, TextResult } from './engine';

/**
 * One ceiling for every call, matching the Claude path. Well inside the
 * completion limit of every model this is likely to point at, and generous
 * enough that a reply is never truncated into unparseable JSON.
 */
const MAX_TOKENS = 16_000;

/** Long enough for a slow free endpoint; short enough to never hang a run. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * How long to wait before trying again, per attempt. Tuned for a per-minute
 * ceiling rather than for a flaky network: the first wait is long enough for a
 * minute window to roll over.
 */
const BACKOFF_MS = [8_000, 20_000, 40_000];

export class FreeModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FreeModelError';
  }
}

/** True when this deployment has a free-model key. */
export function freeModelReady(): boolean {
  const key = process.env.FREE_MODEL_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

/** Where the calls go. One trailing slash here has broken this twice before. */
function baseUrl(): string {
  const url = (process.env.FREE_MODEL_URL ?? '').trim() || DEFAULT_FREE_MODEL_URL;
  return url.replace(/\/+$/, '');
}

let saidSo = false;

/**
 * The model id, in order: whatever the console box holds if it is not the
 * other engine's, then the deployment's own default, then ours.
 *
 * `textModel` is one console field shared with the other engines, so the value
 * sitting in it is usually `claude-…` or `gemini-…`. That is not an error
 * worth stopping for — it is the normal state of a desk that changed engines —
 * but it must never be forwarded to this provider, which would answer 404 for
 * a model that does exist somewhere else.
 */
export function resolveFreeModel(configured: string | undefined): string {
  const model = (configured ?? '').trim();
  if (model && !model.startsWith('claude-') && !model.startsWith('gemini-')) return model;
  const fallback = (process.env.FREE_MODEL_ID ?? '').trim() || DEFAULT_FREE_MODEL;
  // Once per instance, not once per call: ten identical log lines in a run
  // teach everybody to ignore the eleventh.
  if (model && !saidSo) {
    saidSo = true;
    logger.info('social: the configured text model belongs to another engine, using the free default', {
      configured: model,
      using: fallback,
    });
  }
  return fallback;
}

/** A refusal that waiting will not fix: the day's allowance is gone. */
function isDailyQuota(message: string): boolean {
  return /per day|daily|RPD|TPD/i.test(message);
}

/** A refusal caused by asking for JSON mode on a provider that lacks it. */
function isJsonModeRefusal(message: string): boolean {
  return /response_format|json_object|json mode/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "Limit 8000, Requested 8287" → 287: the provider's own count of how far over its per-minute window a request is. */
export function tokensOver(message: string): number | null {
  const m = message.match(/Limit (\d+), Requested (\d+)/i);
  return m ? Math.max(0, Number(m[2]) - Number(m[1])) : null;
}

/** `text` with `chars` taken out of its middle: the task opens a prompt and the reply format closes it. Pure. */
export function cutMiddle(text: string, chars: number): string {
  const keep = text.length - chars;
  if (chars <= 0 || keep < 200) return text;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}\n…\n${text.slice(text.length - (keep - head))}`;
}

/**
 * Turned off for the life of the instance the first time a provider refuses
 * it. Deliberately module state rather than a setting: it is a fact about the
 * endpoint, not a preference, and nobody should have to know it exists.
 */
let jsonMode = true;

interface ChatResponse {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
  error?: { message?: string; code?: string };
}

/** One call, with the free tier's rate limit survived rather than hit. */
async function post(body: unknown): Promise<ChatResponse> {
  const key = (process.env.FREE_MODEL_KEY ?? '').trim();
  let shrinks = 0;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      // A dropped connection is worth one more go; a timeout is not, because
      // the next attempt would start another two-minute wait inside a run that
      // has a clock of its own.
      if (attempt < BACKOFF_MS.length && (e as Error).name !== 'TimeoutError') {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new FreeModelError((e as Error).message);
    }

    const text = await res.text();
    let parsed: ChatResponse | null = null;
    try {
      parsed = text ? (JSON.parse(text) as ChatResponse) : null;
    } catch {
      /* a non-JSON body is handled as an error below */
    }

    if (res.ok) {
      if (!parsed) throw new FreeModelError('The model replied with something that was not JSON.');
      return parsed;
    }

    const message = parsed?.error?.message ?? text.slice(0, 300) ?? res.statusText;

    // Asked for JSON mode and this provider does not have it. Drop it for good
    // and go again — the same call, one field lighter.
    if (res.status === 400 && jsonMode && isJsonModeRefusal(message)) {
      jsonMode = false;
      logger.info('social: this endpoint has no JSON mode, falling back to reading the object out of the reply');
      const { response_format: _dropped, ...rest } = body as Record<string, unknown>;
      body = rest;
      continue;
    }

    // It has JSON mode, but this one reply failed its own check (Groq's
    // json_validate_failed, which failed a story on 2026-10-30). Ask once more
    // without it for this call only; extractJson reads the object out.
    if (
      res.status === 400 &&
      'response_format' in (body as Record<string, unknown>) &&
      /failed to generate json|json_validate_failed/i.test(`${message} ${parsed?.error?.code ?? ''}`)
    ) {
      const { response_format: _dropped, ...rest } = body as Record<string, unknown>;
      body = rest;
      continue;
    }

    // Too big for the free tier's per-minute window (Groq's 413 on 2026-10-29 sent a story to the
    // local writer, which never posts on its own). Cut the overflow out of the prompt and go again.
    const over = res.status === 413 ? tokensOver(message) : null;
    if (over !== null && shrinks < 2) {
      shrinks++;
      const b = body as { messages: { role: string; content: string }[] };
      const user = b.messages[b.messages.length - 1];
      // About three characters a token, with a margin, because the second try is the last.
      const content = cutMiddle(user.content, (over + 300) * 3);
      logger.info('social: the prompt was too big for the free model; shortened', { over, chars: user.content.length - content.length });
      body = { ...b, messages: [...b.messages.slice(0, -1), { ...user, content }] };
      continue;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < BACKOFF_MS.length && !isDailyQuota(message)) {
      logger.info('social: the free model is rate limiting, waiting', { attempt, status: res.status });
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }

    throw new FreeModelError(`${res.status}: ${message}`);
  }
}

/**
 * Ask the free model, and come back in the same shape the Claude path returns
 * so that no stage upstream can tell which engine answered.
 */
export async function freeModelText(req: TextRequest): Promise<TextResult> {
  if (!freeModelReady()) {
    throw new FreeModelError('FREE_MODEL_KEY is not configured.');
  }

  // The one request this engine must never fulfil quietly. research.ts turns
  // this into the honest "no market read today" rather than a fabricated one.
  if (req.grounded) {
    throw new FreeModelError(
      'The free engine cannot search the web, so there is no market read today. Everything in this piece comes from the brand material and the facts.',
    );
  }

  const data = await post({
    model: resolveFreeModel(req.model),
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.prompt },
    ],
    max_tokens: MAX_TOKENS,
    ...(req.json && jsonMode ? { response_format: { type: 'json_object' } } : {}),
  });

  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';

  if (!text) {
    throw new FreeModelError(
      choice?.finish_reason === 'length'
        ? 'The reply ran past its length before anything usable came out.'
        : choice?.finish_reason === 'content_filter'
          ? 'The provider’s filter stopped this one. Rewrite the angle and run it again.'
          : 'The free model returned nothing usable.',
    );
  }

  // No sources and no searches, always: this engine does not read the web, and
  // an empty list is the truthful answer rather than a missing field.
  return { text, sources: [], searches: [] };
}
