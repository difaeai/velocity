/**
 * The picture under the words, and the voice over the reel.
 *
 * The two complaints this guards: every post was "a black screen with green on
 * it", and "sometimes there is no voice". So a frame must get a drawn picture
 * when the model can draw one, a stock photo when it cannot, and the model must
 * be told never to draw words or fake a real person. And a voice the full
 * speech model refused must be read by the lite one before a reel goes silent.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stockPhoto } = vi.hoisted(() => ({ stockPhoto: vi.fn() }));
vi.mock('../footage', async (load) => ({ ...(await load<typeof import('../footage')>()), stockPhoto }));

import { geminiImage, geminiSpeech, geminiText, IMAGE_MODEL, SPEECH_FALLBACK_MODEL, SPEECH_MODEL } from '../gemini';
import { pictureFor, picturePrompt } from '../picture';

const saved = process.env.GEMINI_KEY_RESEARCH;
let dir = '';

const ok = (steps: unknown[]) =>
  ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ status: 'completed', steps }) }) as unknown as Response;
const refused = (status: number, message: string) =>
  ({ ok: false, status, statusText: 'error', text: async () => JSON.stringify({ error: { message } }) }) as unknown as Response;
const block = (type: string, data: string) => ({ type: 'model_output', content: [{ type, data }] });
const sent = (mock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse((mock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

beforeEach(async () => {
  process.env.GEMINI_KEY_RESEARCH = 'test-key';
  dir = await mkdtemp(path.join(tmpdir(), 'pictures-test-'));
  stockPhoto.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (saved === undefined) delete process.env.GEMINI_KEY_RESEARCH;
  else process.env.GEMINI_KEY_RESEARCH = saved;
  await rm(dir, { recursive: true, force: true });
});

describe('the prompt a picture is drawn from', () => {
  it('forbids words and real-looking portraits, and leaves room for the headline', () => {
    const prompt = picturePrompt('a rickshaw at dusk in Karachi', '4:5', 'bottom');
    expect(prompt).toContain('a rickshaw at dusk in Karachi');
    expect(prompt).toMatch(/no text, letters, numbers, logos/i);
    expect(prompt).toMatch(/anonymous/i);
    expect(prompt).toMatch(/bottom third calm/);
    expect(picturePrompt('x', '9:16', 'top')).toMatch(/top third calm/);
  });
});

describe('geminiImage', () => {
  it('asks for one 1K JPEG in the frame’s shape and reads the picture back', async () => {
    const fetchMock = vi.fn(async () => ok([block('image', Buffer.from('jpeg-bytes').toString('base64'))]));
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await geminiImage('a scene', '9:16');
    expect(bytes.toString()).toBe('jpeg-bytes');
    expect(sent(fetchMock)).toMatchObject({
      model: IMAGE_MODEL,
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '9:16', image_size: '1K' },
      store: false,
    });
  });

  it('says so rather than returning an empty picture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([block('text', '')])));
    await expect(geminiImage('a scene', '4:5')).rejects.toThrow(/no picture/);
  });
});

describe('pictureFor', () => {
  it('draws the frame when the model can', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([block('image', Buffer.from('drawn').toString('base64'))])));
    const out = path.join(dir, 'a.jpg');
    const pic = await pictureFor({ scene: 'a driver at a fuel pump', query: 'driver fuel', aspect: '4:5', out });
    expect(pic).toEqual({ path: out, source: 'drawn' });
    expect((await readFile(out)).toString()).toBe('drawn');
    expect(stockPhoto).not.toHaveBeenCalled();
  });

  it('falls back to a stock photo when the model refuses, searched with the frame’s words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => refused(400, 'The picture was blocked by a safety filter')));
    const out = path.join(dir, 'b.jpg');
    stockPhoto.mockResolvedValueOnce(out);
    const pic = await pictureFor({ scene: 'a driver at a fuel pump', query: 'driver fuel', aspect: '9:16', out });
    expect(pic).toEqual({ path: out, source: 'stock' });
    expect(stockPhoto).toHaveBeenCalledWith(expect.objectContaining({ query: 'driver fuel', orientation: 'vertical' }));
  });

  it('is null — the card paints its gradient — when neither has one, and never throws', async () => {
    delete process.env.GEMINI_KEY_RESEARCH;
    stockPhoto.mockRejectedValueOnce(new Error('Pixabay said 500'));
    await expect(pictureFor({ scene: 's', query: 'q', aspect: '4:5', out: path.join(dir, 'c.jpg') })).resolves.toBeNull();
  });
});

describe('the voice-over', () => {
  it('is read by the lite model when the full one refuses, rather than leaving the reel silent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refused(400, 'This model is not available in your region'))
      .mockResolvedValueOnce(ok([block('audio', Buffer.from('wav').toString('base64'))]));
    vi.stubGlobal('fetch', fetchMock);

    const wav = await geminiSpeech('Hello there.', 'warm');
    expect(wav.toString()).toBe('wav');
    expect(sent(fetchMock, 0).model).toBe(SPEECH_MODEL);
    expect(sent(fetchMock, 1).model).toBe(SPEECH_FALLBACK_MODEL);
  });

  it('throws only when both refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => refused(400, 'nope')));
    await expect(geminiSpeech('Hello.', 'warm')).rejects.toThrow(/nope/);
  });

  it('a refused voice leaves the writing alone: the next text call is sent as it always is', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refused(400, 'response_format audio mime_type is not supported'))
      .mockResolvedValueOnce(refused(400, 'response_format audio mime_type is not supported'))
      .mockResolvedValueOnce(ok([{ type: 'model_output', content: [{ type: 'text', text: '{"ok":true}' }] }]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(geminiSpeech('Hello.', 'warm')).rejects.toThrow();
    const out = await geminiText({ model: '', system: 's', prompt: 'p', json: true });
    expect(out.text).toBe('{"ok":true}');
    expect(sent(fetchMock, 2).model).not.toBe(SPEECH_MODEL);
  });
});
