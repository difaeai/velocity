/**
 * The one door to Google — and, since the desk moved its thinking to Claude,
 * only for the things Claude cannot make: **pictures and video.**
 *
 * Rang's frames are rendered here, and `video.ts` borrows `geminiKey` and
 * `GEMINI_BASE` to drive a Veo render the same way. Everything written or
 * decided — research, scripts, SEO, captions, replies — goes through
 * `claude.ts` instead.
 *
 * Raw REST rather than an SDK, on purpose: the surface used here is two
 * endpoints wide, and a dependency that ships breaking changes on someone
 * else's schedule is a bad trade for a function that has to still work at 10am
 * unattended.
 *
 * Model ids come from settings, not from here. Google renames preview models
 * often; when `gemini-2.5-flash-image` becomes something else, that is a text
 * field in the console, not a redeploy.
 */
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

/** True when pictures (and, if switched on, video) can be rendered. */
export function geminiReady(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

export function geminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !key.trim()) {
    throw new GeminiError(
      'GEMINI_API_KEY is not configured, so nothing can be drawn or rendered. Add it as a GitHub Actions secret and redeploy.',
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

// ── the shape of a generateContent reply ────────────────────────────────────

interface Candidate {
  content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
  finishReason?: string;
}

interface GenerateResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
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
