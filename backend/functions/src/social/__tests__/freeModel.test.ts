/**
 * The free engine, and the choice between the three.
 *
 * Three things are worth a test here and none of them is about the writing.
 *
 * **It must refuse to be grounded.** No free endpoint can search the web. The
 * danger is not that the market read fails — `research.ts` has always handled
 * that — it is that the model answers the research prompt anyway, from
 * nothing, and a composed market read reaches the standup looking exactly like
 * a real one. The refusal is the feature.
 *
 * **The rate limit.** A free tier allows a few dozen calls a minute and one
 * piece is nine or ten in a row, so a run without backoff dies halfway. A
 * *daily* refusal must not be retried: waiting a minute to be refused again
 * just burns the clock of a run that has one.
 *
 * **JSON mode must be survivable.** Most OpenAI-compatible providers have it
 * and a smaller model is much steadier with it; one that does not answers 400,
 * and that must cost one call, once, rather than every call forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freeModelReady, freeModelText, resolveFreeModel } from '../freeModel';
import { activeEngine, modelReady } from '../engine';
import { DEFAULT_FREE_MODEL } from '../types';

const saved = {
  key: process.env.FREE_MODEL_KEY,
  url: process.env.FREE_MODEL_URL,
  id: process.env.FREE_MODEL_ID,
  anthropic: process.env.ANTHROPIC_API_KEY,
  gemini: process.env.GEMINI_KEY_RESEARCH,
};

function reply(content: string, finish = 'stop') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }),
  } as unknown as Response;
}

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
  process.env.FREE_MODEL_KEY = 'test-key';
  delete process.env.FREE_MODEL_URL;
  delete process.env.FREE_MODEL_ID;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_KEY_RESEARCH;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const [name, value] of [
    ['FREE_MODEL_KEY', saved.key],
    ['FREE_MODEL_URL', saved.url],
    ['FREE_MODEL_ID', saved.id],
    ['ANTHROPIC_API_KEY', saved.anthropic],
    ['GEMINI_KEY_RESEARCH', saved.gemini],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('which engine answers', () => {
  it('prefers Claude when every key exists — somebody is paying for it', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.GEMINI_KEY_RESEARCH = 'gem-test';
    expect(activeEngine()).toBe('claude');
  });

  it('prefers Gemini over this one, because Gemini can search', () => {
    // Both are free, so the tie-breaker is the market read: one of them can
    // do it and the other has to refuse. See engine.ts for the order.
    process.env.GEMINI_KEY_RESEARCH = 'gem-test';
    expect(activeEngine()).toBe('gemini');
  });

  it('falls to the free model when only the free key exists', () => {
    expect(activeEngine()).toBe('free');
    expect(modelReady()).toBe(true);
  });

  it('falls to the local writer when neither key exists', () => {
    delete process.env.FREE_MODEL_KEY;
    expect(freeModelReady()).toBe(false);
    expect(activeEngine()).toBe('local');
    expect(modelReady()).toBe(false);
  });
});

describe('which model, and where', () => {
  it('uses the console box when it holds this engine’s id', () => {
    expect(resolveFreeModel('openai/gpt-oss-120b')).toBe('openai/gpt-oss-120b');
  });

  it('ignores another engine’s id rather than sending it to the provider', () => {
    // The normal state of a desk that changed engines: one model box, the
    // wrong vendor's value in it. A 404 from the provider is a worse answer.
    // Both of the others count — a Gemini id in that box used to be forwarded
    // to Groq, which was invisible until somebody actually typed one in.
    expect(resolveFreeModel('claude-opus-5')).toBe(DEFAULT_FREE_MODEL);
    expect(resolveFreeModel('gemini-2.5-flash')).toBe(DEFAULT_FREE_MODEL);
    expect(resolveFreeModel('')).toBe(DEFAULT_FREE_MODEL);
  });

  it('lets the deployment override the default without a deploy of code', () => {
    process.env.FREE_MODEL_ID = 'llama-3.1-8b-instant';
    expect(resolveFreeModel('claude-opus-5')).toBe('llama-3.1-8b-instant');
  });

  it('posts OpenAI-shaped chat completions to the configured base URL', async () => {
    process.env.FREE_MODEL_URL = 'https://example.test/v1/';
    const fetchMock = vi.fn(async () => reply('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    await freeModelText({ model: 'm', system: 'be useful', prompt: 'write something', json: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The trailing slash in the configured URL must not become a double one.
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');

    const sent = body(fetchMock);
    expect(sent.model).toBe('m');
    expect(sent.messages).toEqual([
      { role: 'system', content: 'be useful' },
      { role: 'user', content: 'write something' },
    ]);
    expect(sent.response_format).toEqual({ type: 'json_object' });
  });
});

describe('it cannot search, and says so', () => {
  it('refuses a grounded request instead of answering from nothing', async () => {
    const fetchMock = vi.fn(async () => reply('trends!'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      freeModelText({ model: '', system: 's', prompt: 'p', grounded: true }),
    ).rejects.toThrow(/cannot search the web/);
    // Not "it failed after trying" — it never asked. An invented market read
    // is the one output worse than no market read.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never claims sources it did not read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('the answer')));
    const out = await freeModelText({ model: '', system: 's', prompt: 'p' });
    expect(out).toEqual({ text: 'the answer', sources: [], searches: [] });
  });

  it('says what stopped it rather than returning an empty piece', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('', 'length')));
    await expect(freeModelText({ model: '', system: 's', prompt: 'p' })).rejects.toThrow(/past its length/);
  });
});

describe('a provider without JSON mode', () => {
  it('drops it once and carries on, rather than failing every call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure(400, "'response_format' is not supported by this model"))
      .mockResolvedValueOnce(reply('{"ok":true}'))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    await freeModelText({ model: '', system: 's', prompt: 'p', json: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body(fetchMock, 0).response_format).toBeDefined();
    expect(body(fetchMock, 1).response_format).toBeUndefined();

    // And it is remembered: the next call does not pay for the lesson again.
    await freeModelText({ model: '', system: 's', prompt: 'p', json: true });
    expect(body(fetchMock, 2).response_format).toBeUndefined();
  });
});

describe('the free tier’s rate limit', () => {
  it('waits and tries again on a per-minute refusal', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure(429, 'Rate limit reached for requests per minute'))
      .mockResolvedValueOnce(reply('second time lucky'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = freeModelText({ model: '', system: 's', prompt: 'p' });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({ text: 'second time lucky' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not wait out a daily quota — the day is gone, not the minute', async () => {
    const fetchMock = vi.fn(async () => failure(429, 'Rate limit reached: 1000 requests per day (RPD)'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(freeModelText({ model: '', system: 's', prompt: 'p' })).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up with the status and the message after the last wait', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => failure(503, 'the model is overloaded'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = freeModelText({ model: '', system: 's', prompt: 'p' });
    const assertion = expect(pending).rejects.toThrow('503: the model is overloaded');
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    // Three waits, four attempts: see BACKOFF_MS.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
