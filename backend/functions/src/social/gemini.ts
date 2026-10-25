/**
 * Gemini's free tier — the only engine here that is free *and* can search.
 *
 * It sits between Claude and the OpenAI-compatible free model in `engine.ts`,
 * and it exists for the one hole the desk had: with no paid key there was no
 * market read at all. The free model cannot search and says so; the local
 * writer cannot either. Google's free tier can, and the number that matters is
 * on their own pricing page — grounding with Google Search is free of charge
 * up to 500 requests a day on `gemini-2.5-flash`. The desk needs one read a
 * morning, which is 0.2% of that.
 *
 * The secret is `GEMINI_KEY_RESEARCH`. The name says research because that is
 * the hole it was added to fill, but this is a whole engine rather than one
 * stage: when it is the one that answers, it also plans, writes, briefs,
 * optimises and replies. A key typed on Manage social → AI keys & usage beats
 * it (`ai/config.ts`), and every answered call is priced onto the meter
 * (`ai/usage.ts`): the key runs on prepaid credit, so none of this is free.
 *
 * Six things are worth knowing before changing anything:
 *
 * 1. **This is the Interactions API, not `generateContent`.** One POST to
 *    `/v1beta/interactions` carrying `model`, `system_instruction` and
 *    `input`, with the key in an `x-goog-api-key` header. What comes back is a
 *    list of *steps* — the searches it ran, then its answer — rather than a
 *    list of candidates, which is why the reply is walked rather than indexed.
 * 2. **`store: false` on every call.** Stateless: Google keeps no copy of the
 *    thread, which is one fewer place a prompt lives. The rest of it is worth
 *    being plain about — on the *free* tier Google may use what is sent to
 *    improve their products. What is sent is brand material, a competitor list
 *    and public figures. No rider or driver data goes near this file, and
 *    nothing here reads the database.
 * 3. **A grounded call is pinned to the free-grounding model.** Text is free
 *    on every current Flash, but free *grounding* exists on 2.5 Flash alone;
 *    on the newer ones it is "not available" on the free tier, so the same
 *    request would either be refused or billed. `GROUNDED_GEMINI_MODEL`
 *    therefore beats the console's model box on a grounded request, whatever
 *    somebody typed in it. The box still chooses the writer.
 * 4. **JSON mode is asked for, and dropped if it is refused** — the same
 *    bargain `freeModel.ts` makes, for the same reason: `extractJson` was
 *    always the real net. It is never asked for on a grounded call, because
 *    structured output alongside a built-in tool is a Gemini 3 preview feature
 *    and the grounded model here is 2.5.
 * 5. **Free tiers are rate-limited, so retries are not optional.** One piece
 *    is nine or ten calls in a row. A per-minute refusal is waited out; a
 *    per-day one is reported rather than slept through, because waiting out a
 *    day inside a run that has a clock is just a slower failure.
 * 6. **The sources are the model's own citations.** A grounded answer carries
 *    `url_citation` annotations — the pages it actually read — which is
 *    exactly what `research.ts` stores next to the script. Nothing is scraped
 *    and nobody's app is read.
 */
import { logger } from 'firebase-functions';

import { geminiKey, noteKeyError, textSlot, type KeySlot } from '../ai/config';
import { costUsd, readUsage, recordAi } from '../ai/usage';
import { DEFAULT_GEMINI_MODEL, GROUNDED_GEMINI_MODEL } from './types';
// Type-only, and deliberately so: engine.ts imports this file at runtime, and
// a value import back would be a cycle. Types are erased.
import type { GroundedSource, TextRequest, TextResult } from './engine';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** One ceiling for every call, matching the other two engines. */
const MAX_TOKENS = 16_000;

/** Long enough for a grounded read; short enough to never hang a run. */
const REQUEST_TIMEOUT_MS = 180_000;

/** How long to wait before trying again. The first wait rolls a minute over. */
const BACKOFF_MS = [8_000, 20_000, 40_000];

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

/** True when this workspace has a Gemini key: typed in the console, or the deploy secret. */
export function geminiReady(): boolean {
  return geminiKey() !== '';
}

let saidSo = false;
let saidPinned = false;

/**
 * Which model this call goes to.
 *
 * `textModel` is one console box shared by every engine, so the value sitting
 * in it is often another vendor's — the normal state of a desk that changed
 * engines, not an error worth stopping for. A grounded call ignores the box
 * entirely: see point 3 in the header.
 */
export function resolveGeminiModel(configured: string | undefined, grounded?: boolean): string {
  const model = (configured ?? '').trim();

  if (grounded) {
    if (model.startsWith('gemini-') && model !== GROUNDED_GEMINI_MODEL && !saidPinned) {
      saidPinned = true;
      logger.info('social: the market read stays on the model whose grounding is free', {
        configured: model,
        using: GROUNDED_GEMINI_MODEL,
      });
    }
    return GROUNDED_GEMINI_MODEL;
  }

  if (model.startsWith('gemini-')) return model;
  // Once per instance, not once per call: ten identical lines in one run teach
  // everybody to ignore the eleventh.
  if (model && !saidSo) {
    saidSo = true;
    logger.info('social: the configured text model belongs to another engine, using the Gemini default', {
      configured: model,
      using: DEFAULT_GEMINI_MODEL,
    });
  }
  return DEFAULT_GEMINI_MODEL;
}

/** A refusal that waiting will not fix: the day's allowance is gone. */
function isDailyQuota(message: string): boolean {
  return /per ?day|daily|RPD|TPD/i.test(message);
}

/** A refusal caused by asking for JSON on a model or route that lacks it. */
function isJsonRefusal(message: string): boolean {
  return /response_format|response_mime_type|mime_type|json/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Turned off for the life of the instance the first time it is refused.
 * Module state rather than a setting: it is a fact about the endpoint, not a
 * preference, and nobody should have to know it exists.
 */
let jsonMode = true;

interface Annotation {
  type?: string;
  url?: unknown;
  title?: unknown;
}

interface Block {
  type?: string;
  text?: unknown;
  /** Base64 audio, on a block of type `audio`. */
  data?: unknown;
  annotations?: Annotation[];
}

interface Step {
  type?: string;
  content?: Block[];
  arguments?: { queries?: unknown };
}

interface Interaction {
  status?: string;
  steps?: Step[];
  /** Only read as a fallback; the documented place is a step. */
  model_output?: { content?: Block[] };
  errors?: { message?: string }[];
  error?: { message?: string; status?: string };
  /** Tokens in, out and thought, and how many searches — what the meter prices. */
  usage?: unknown;
}

/** A refusal a person has to fix on the key itself: no credit, billing off, revoked. */
const KEY_TROUBLE = /credit|billing|prepay|API key|PERMISSION_DENIED|quota/i;

/** One call, with the free tier's rate limit survived rather than hit. */
async function post(body: Record<string, unknown>, slot: KeySlot = textSlot()): Promise<Interaction> {
  const key = geminiKey(slot);
  let sent = body;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(sent),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      // A dropped connection is worth one more go; a timeout is not, because
      // the next attempt would start another three-minute wait inside a run
      // that has a clock of its own.
      if (attempt < BACKOFF_MS.length && (e as Error).name !== 'TimeoutError') {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new GeminiError((e as Error).message);
    }

    const text = await res.text();
    let parsed: Interaction | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Interaction) : null;
    } catch {
      /* a non-JSON body is handled as an error below */
    }

    if (res.ok) {
      if (!parsed) throw new GeminiError('Gemini replied with something that was not JSON.');
      return parsed;
    }

    const message = parsed?.error?.message ?? text.slice(0, 300) ?? res.statusText;

    // Asked for JSON and this model or route does not take it. Drop it for
    // good and go again: the same call, one field lighter.
    if (res.status === 400 && jsonMode && 'response_format' in sent && isJsonRefusal(message)) {
      jsonMode = false;
      logger.info('social: Gemini refused JSON mode, falling back to reading the object out of the reply');
      const { response_format: _dropped, ...rest } = sent;
      sent = rest;
      continue;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < BACKOFF_MS.length && !isDailyQuota(message)) {
      logger.info('social: Gemini is rate limiting, waiting', { attempt, status: res.status });
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }

    if ([401, 402, 403].includes(res.status) || (res.status === 429 && isDailyQuota(message)) || KEY_TROUBLE.test(message)) {
      noteKeyError(slot, `${res.status}: ${message}`);
    }
    throw new GeminiError(`${res.status}: ${message}`);
  }
}

/** Put one answered call on the meter. */
function meter(model: string, data: Interaction, what?: string): void {
  const u = readUsage(data.usage);
  void recordAi({ model, usd: costUsd(model, u), inTok: u.inTok, outTok: u.outTok, grounded: u.grounded, what });
}

function collect(blocks: Block[] | undefined, chunks: string[], sources: GroundedSource[]): void {
  for (const block of blocks ?? []) {
    if (typeof block.text === 'string') chunks.push(block.text);
    for (const note of block.annotations ?? []) {
      if (note.type !== 'url_citation') continue;
      const url = typeof note.url === 'string' ? note.url : '';
      if (!url || sources.some((s) => s.url === url)) continue;
      sources.push({ title: typeof note.title === 'string' && note.title ? note.title : url, url });
    }
  }
}

/** Walk the steps: the answer, the pages it cited, the searches it ran. */
function readReply(data: Interaction): TextResult {
  const chunks: string[] = [];
  const sources: GroundedSource[] = [];
  const searches: string[] = [];

  for (const step of data.steps ?? []) {
    if (step.type === 'google_search_call') {
      const queries = step.arguments?.queries;
      if (Array.isArray(queries)) {
        for (const query of queries) {
          if (typeof query === 'string' && query.trim()) searches.push(query.trim());
        }
      }
      continue;
    }
    // Only the model's own output. A search result step carries its own
    // `result` list and a thought summary is not the answer, so neither is
    // allowed to leak into the text the desk is about to publish.
    if (step.type !== 'model_output') continue;
    collect(step.content, chunks, sources);
  }

  // Read only when no step carried the answer: one shape is documented and
  // the other is what a flattened reply has looked like. Neither is worth a
  // dead run over.
  if (!chunks.length) collect(data.model_output?.content, chunks, sources);

  return { text: chunks.join('').trim(), sources, searches };
}

/**
 * Ask Gemini, and come back in the shape the other engines return so that no
 * stage upstream can tell which one answered.
 */
export async function geminiText(req: TextRequest): Promise<TextResult> {
  if (!geminiReady()) {
    throw new GeminiError('GEMINI_KEY_RESEARCH is not configured.');
  }

  const model = resolveGeminiModel(req.model, req.grounded);
  const data = await post({
    model,
    system_instruction: req.system,
    // A video goes first and the words after it, which is the order Google's
    // own examples use for one video and a question about it.
    input: req.video
      ? [
          'uri' in req.video
            ? { type: 'video', uri: req.video.uri }
            : { type: 'video', data: req.video.data, mime_type: req.video.mimeType },
          { type: 'text', text: req.prompt },
        ]
      : req.prompt,
    // See point 2: nothing is kept on Google's side for anyone to read back.
    store: false,
    generation_config: { max_output_tokens: MAX_TOKENS },
    ...(req.grounded ? { tools: [{ type: 'google_search' }] } : {}),
    ...(req.json && !req.grounded && jsonMode
      ? { response_format: { type: 'text', mime_type: 'application/json' } }
      : {}),
  });

  meter(model, data, req.what);

  if (data.status === 'failed' || data.status === 'cancelled') {
    const said = data.errors?.find((e) => e.message)?.message;
    throw new GeminiError(said ? said.slice(0, 300) : `Gemini stopped with status ${data.status}.`);
  }

  const result = readReply(data);
  if (!result.text) {
    throw new GeminiError(
      data.status === 'incomplete'
        ? 'The reply ran past its length before anything usable came out.'
        : 'Gemini returned nothing usable.',
    );
  }

  return result;
}

/** Free on the same key, and the only TTS that follows a style note in plain words. */
export const SPEECH_MODEL = 'gemini-3.8-flash-tts';

/**
 * Read a line aloud: a WAV (24 kHz, mono, 16-bit) the reel mixes under its
 * words. Same endpoint and the same rate-limit handling as the text calls; the
 * audio is the last `audio` block of the model's output.
 */
export async function geminiSpeech(text: string, style: string, voice = 'Puck'): Promise<Buffer> {
  if (!geminiReady()) throw new GeminiError('GEMINI_KEY_RESEARCH is not configured.');
  const data = await post({
    model: SPEECH_MODEL,
    input: [
      {
        type: 'user_input',
        content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
    store: false,
  });
  meter(SPEECH_MODEL, data, 'Voice-over');
  const audio = (data.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((b) => b.type === 'audio' && typeof b.data === 'string')
    .pop();
  if (!audio) throw new GeminiError('Gemini returned no audio.');
  return Buffer.from(audio.data as string, 'base64');
}
