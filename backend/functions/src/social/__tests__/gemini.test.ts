/**
 * Gemini's free tier — the engine that put the market read back.
 *
 * Four things here are worth a test and none of them is about the writing.
 *
 * **It must actually be grounded, and it must report what it read.** This is
 * the only free engine that can search, which is the entire reason it exists
 * and sits above the other one. So the request has to carry the search tool
 * and the reply has to come back with the pages it cited and the queries it
 * ran — `research.ts` stores both next to the script, and a read with no
 * sources is indistinguishable from an invented one.
 *
 * **A grounded call must stay on the model whose grounding is free.** Text is
 * free on every current Flash; free *grounding* is 2.5 Flash only. The console
 * has one model box, so the day somebody types a newer id into it the morning
 * read must not quietly follow the writer onto a paid or refused route.
 *
 * **JSON mode must be survivable**, the same bargain `freeModel.ts` makes, and
 * never asked for on a grounded call — structured output alongside a built-in
 * tool is a Gemini 3 preview feature and the grounded model here is 2.5.
 *
 * **Nothing but the model's own output may become the post.** A reply is a
 * list of steps: the searches, their results, then the answer. A walker that
 * scoops up every step with text in it would publish a thought summary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { geminiReady, geminiText, resolveGeminiModel } from '../gemini';
import { activeEngine } from '../engine';
import { DEFAULT_GEMINI_MODEL, GROUNDED_GEMINI_MODEL } from '../types';

const saved = {
  gemini: process.env.GEMINI_KEY_RESEARCH,
  anthropic: process.env.ANTHROPIC_API_KEY,
  free: process.env.FREE_MODEL_KEY,
};

/** The documented shape: the answer is a step, not a top-level field. */
function reply(steps: unknown[], status = 'completed') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ status, steps }),
  } as unknown as Response;
}

const answer = (text: string, annotations?: unknown[]) => ({
  type: 'model_output',
  content: [{ type: 'text', text, ...(annotations ? { annotations } : {}) }],
});

function failure(status: number, message: string) {
  return {
    ok: false,
    status,
    statusText: 'error',
    text: async () => JSON.stringify({ error: { message } }),
  } as unknown as Response;
}

const body = (mock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse((mock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

beforeEach(() => {
  process.env.GEMINI_KEY_RESEARCH = 'test-key';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.FREE_MODEL_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const [name, value] of [
    ['GEMINI_KEY_RESEARCH', saved.gemini],
    ['ANTHROPIC_API_KEY', saved.anthropic],
    ['FREE_MODEL_KEY', saved.free],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('the key turns it on', () => {
  it('is the engine when it is the only key', () => {
    expect(geminiReady()).toBe(true);
    expect(activeEngine()).toBe('gemini');
  });

  it('is off without a key, rather than failing mid-call', () => {
    delete process.env.GEMINI_KEY_RESEARCH;
    expect(geminiReady()).toBe(false);
    expect(activeEngine()).toBe('local');
  });
});

describe('which model', () => {
  it('uses the console box when it holds a Gemini id', () => {
    expect(resolveGeminiModel('gemini-3.8-flash')).toBe('gemini-3.8-flash');
  });

  it('ignores another engine’s id rather than sending it to Google', () => {
    expect(resolveGeminiModel('claude-opus-5')).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveGeminiModel('')).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('pins a grounded call to the model whose grounding is free', () => {
    // The box may well hold a better writer. Free grounding does not exist on
    // it, and a market read that starts costing money — or 400s — because
    // somebody upgraded the writer is the failure this line prevents.
    expect(resolveGeminiModel('gemini-3.8-flash', true)).toBe(GROUNDED_GEMINI_MODEL);
    expect(resolveGeminiModel('claude-opus-5', true)).toBe(GROUNDED_GEMINI_MODEL);
  });
});

describe('a grounded read', () => {
  it('asks for the search tool and reports the pages and the queries', async () => {
    const fetchMock = vi.fn(async () =>
      reply([
        { type: 'google_search_call', arguments: { queries: ['pakistan ride hailing october 2026', ''] } },
        { type: 'google_search_result', result: [{ search_suggestions: '<div/>' }] },
        answer('{"trends":[]}', [
          { type: 'url_citation', url: 'https://dawn.com/a', title: 'Ride-hailing permits' },
          { type: 'url_citation', url: 'https://dawn.com/a', title: 'a duplicate' },
          { type: 'url_citation', url: 'https://tribune.com.pk/b' },
          { type: 'something_else', url: 'https://not-a-source.example' },
        ]),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await geminiText({
      model: 'gemini-3.8-flash',
      system: 'you are the research assistant',
      prompt: 'read the market',
      grounded: true,
      json: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');

    const sent = body(fetchMock);
    expect(sent.tools).toEqual([{ type: 'google_search' }]);
    expect(sent.model).toBe(GROUNDED_GEMINI_MODEL);
    expect(sent.system_instruction).toBe('you are the research assistant');
    expect(sent.input).toBe('read the market');
    // Nothing is kept on Google's side for anyone to read back.
    expect(sent.store).toBe(false);
    // Structured output alongside a built-in tool is a Gemini 3 preview
    // feature; this model is 2.5, so it is never asked for here.
    expect(sent.response_format).toBeUndefined();

    expect(out.text).toBe('{"trends":[]}');
    expect(out.searches).toEqual(['pakistan ride hailing october 2026']);
    expect(out.sources).toEqual([
      { title: 'Ride-hailing permits', url: 'https://dawn.com/a' },
      { title: 'https://tribune.com.pk/b', url: 'https://tribune.com.pk/b' },
    ]);
  });

  it('publishes the answer only — not a search result or a thought', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply([
          { type: 'thought_summary', content: [{ type: 'text', text: 'I should search first.' }] },
          { type: 'google_search_result', content: [{ type: 'text', text: 'SERP noise' }] },
          answer('the hook'),
        ]),
      ),
    );

    const out = await geminiText({ model: '', system: 's', prompt: 'p', grounded: true });
    expect(out.text).toBe('the hook');
  });

  it('claims no sources when it was not grounded', async () => {
    const fetchMock = vi.fn(async () => reply([answer('a caption')]));
    vi.stubGlobal('fetch', fetchMock);

    const out = await geminiText({ model: '', system: 's', prompt: 'p' });
    expect(body(fetchMock).tools).toBeUndefined();
    expect(out).toEqual({ text: 'a caption', sources: [], searches: [] });
  });
});

describe('JSON mode', () => {
  it('asks for it on an ordinary call', async () => {
    const fetchMock = vi.fn(async () => reply([answer('{"ok":true}')]));
    vi.stubGlobal('fetch', fetchMock);

    await geminiText({ model: '', system: 's', prompt: 'p', json: true });
    expect(body(fetchMock).response_format).toEqual({ type: 'text', mime_type: 'application/json' });
  });

  it('drops it once and carries on, rather than failing every call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure(400, 'response_format is not supported for this model'))
      .mockResolvedValueOnce(reply([answer('{"ok":true}')]))
      .mockResolvedValueOnce(reply([answer('{"ok":true}')]));
    vi.stubGlobal('fetch', fetchMock);

    await geminiText({ model: '', system: 's', prompt: 'p', json: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body(fetchMock, 0).response_format).toBeDefined();
    expect(body(fetchMock, 1).response_format).toBeUndefined();

    // And it is remembered: the next call does not pay for the lesson again.
    await geminiText({ model: '', system: 's', prompt: 'p', json: true });
    expect(body(fetchMock, 2).response_format).toBeUndefined();
  });
});

describe('the free tier’s limits', () => {
  it('waits and tries again on a per-minute refusal', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure(429, 'Quota exceeded for requests per minute'))
      .mockResolvedValueOnce(reply([answer('second time lucky')]));
    vi.stubGlobal('fetch', fetchMock);

    const pending = geminiText({ model: '', system: 's', prompt: 'p' });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({ text: 'second time lucky' });
  });

  it('does not wait out a daily quota — the day is gone, not the minute', async () => {
    const fetchMock = vi.fn(async () =>
      failure(429, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier quota exceeded'),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(geminiText({ model: '', system: 's', prompt: 'p' })).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says what stopped it rather than returning an empty piece', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply([answer('')], 'incomplete')));
    await expect(geminiText({ model: '', system: 's', prompt: 'p' })).rejects.toThrow(/past its length/);
  });

  it('reports a failed interaction with Google’s own words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () =>
              JSON.stringify({ status: 'failed', errors: [{ message: 'the model is overloaded' }] }),
          }) as unknown as Response,
      ),
    );
    await expect(geminiText({ model: '', system: 's', prompt: 'p' })).rejects.toThrow(/overloaded/);
  });
});
