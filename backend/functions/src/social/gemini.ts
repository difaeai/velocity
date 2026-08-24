/**
 * The one door to Google. Every agent on the desk talks to Gemini through this
 * file — Qalam writes with it, Rang draws with it, Raftar's Veo renders go
 * through the same key, and Awaaz reads comments with it.
 *
 * Raw REST rather than an SDK, on purpose: the backend already calls Veo this
 * way (see video.ts), the surface used here is four endpoints wide, and a
 * dependency that ships breaking changes on someone else's schedule is a bad
 * trade for a function that has to still work at 10am unattended.
 *
 * Two things here are worth knowing before changing anything:
 *
 * 1. **Grounded calls cannot ask for JSON.** `responseMimeType:
 *    application/json` and the `google_search` tool are mutually exclusive in
 *    the API. So a grounded call asks for JSON in the prompt and the reply is
 *    parsed tolerantly — which is what `extractJson` is for, and why every
 *    caller has to survive a null.
 * 2. **Model ids come from settings, not from here.** Google renames preview
 *    models often; when `gemini-2.5-flash-image` becomes something else, that
 *    is a text field in the console, not a redeploy.
 */
import { logger } from 'firebase-functions';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

/** True when anything on this desk can run at all. */
export function geminiReady(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

export function geminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !key.trim()) {
    throw new GeminiError(
      'GEMINI_API_KEY is not configured, so the content crew cannot run. Add it as a GitHub Actions secret and redeploy.',
    );
  }
  return key.trim();
}

/** Requests can be slow (a grounded search is several seconds); none should hang. */
const REQUEST_TIMEOUT_MS = 120_000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE}/${path}?key=${encodeURIComponent(geminiKey())}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const message = (e as Error).name === 'AbortError' ? 'Gemini did not answer in two minutes.' : (e as Error).message;
    throw new GeminiError(message);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    // Google's own message names the problem — a wrong model id, a disabled
    // API, a quota. "Request failed" would send someone hunting in the wrong file.
    let detail = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; status?: string } };
      if (parsed.error?.message) detail = `${parsed.error.status ?? res.status}: ${parsed.error.message}`;
    } catch {
      /* keep the raw text */
    }
    throw new GeminiError(detail);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError('Gemini returned a response that was not JSON.');
  }
}

// ── text ────────────────────────────────────────────────────────────────────

interface Candidate {
  content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
  finishReason?: string;
  groundingMetadata?: {
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    webSearchQueries?: string[];
  };
}

interface GenerateResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
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
  /** Let the model run a Google search first. Costs a call; buys today's facts. */
  grounded?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export async function generateText(req: TextRequest): Promise<TextResult> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig: {
      temperature: req.temperature ?? 0.9,
      maxOutputTokens: req.maxOutputTokens ?? 4096,
      // See the file header: JSON mode and search grounding cannot coexist.
      ...(req.grounded ? {} : { responseMimeType: 'application/json' }),
    },
    ...(req.grounded ? { tools: [{ google_search: {} }] } : {}),
  };

  const res = await post<GenerateResponse>(`models/${encodeURIComponent(req.model)}:generateContent`, body);

  if (res.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini refused the prompt (${res.promptFeedback.blockReason}).`);
  }
  const candidate = res.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) {
    throw new GeminiError(
      `Gemini returned nothing usable${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}.`,
    );
  }

  const sources: GroundedSource[] = [];
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    const url = chunk.web?.uri;
    if (!url) continue;
    if (sources.some((s) => s.url === url)) continue;
    sources.push({ title: chunk.web?.title ?? url, url });
  }

  return { text, sources, searches: candidate?.groundingMetadata?.webSearchQueries ?? [] };
}

/**
 * Pull the first JSON object out of a reply. Grounded answers come back as
 * prose with the object somewhere inside it, and a fenced ```json block is the
 * common shape, so both are handled rather than insisted against.
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
export async function generateJson<T>(req: TextRequest & { what: string }): Promise<{ data: T; sources: GroundedSource[] }> {
  const result = await generateText(req);
  const data = extractJson<T>(result.text);
  if (!data) {
    logger.error('social: could not parse a Gemini reply', { what: req.what, text: result.text.slice(0, 600) });
    throw new GeminiError(`${req.what} came back in a shape that could not be read.`);
  }
  return { data, sources: result.sources };
}

// ── images ──────────────────────────────────────────────────────────────────

interface PredictResponse {
  predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Draw one frame.
 *
 * Two model families, one function: `imagen-*` answers on `:predict`, while the
 * Gemini image models answer on `:generateContent` with the picture in an
 * `inlineData` part. Which one is in use is a settings field, so the branch is
 * on the model id rather than on a second setting nobody would keep in sync.
 */
export async function generateImage(params: {
  model: string;
  prompt: string;
  aspect: string;
}): Promise<GeneratedImage> {
  if (params.model.startsWith('imagen')) {
    const res = await post<PredictResponse>(`models/${encodeURIComponent(params.model)}:predict`, {
      instances: [{ prompt: params.prompt }],
      parameters: { sampleCount: 1, aspectRatio: params.aspect, personGeneration: 'allow_adult' },
    });
    const first = res.predictions?.[0];
    if (!first?.bytesBase64Encoded) throw new GeminiError('Imagen returned no image.');
    return { bytes: Buffer.from(first.bytesBase64Encoded, 'base64'), mimeType: first.mimeType ?? 'image/png' };
  }

  const res = await post<GenerateResponse>(`models/${encodeURIComponent(params.model)}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: params.aspect },
    },
  });

  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data);
  if (!image?.inlineData?.data) {
    const said = parts.map((p) => p.text ?? '').join(' ').trim();
    throw new GeminiError(
      said
        ? `The image model replied with words instead of a picture: ${said.slice(0, 200)}`
        : 'The image model returned no picture.',
    );
  }
  return {
    bytes: Buffer.from(image.inlineData.data, 'base64'),
    mimeType: image.inlineData.mimeType ?? 'image/png',
  };
}
