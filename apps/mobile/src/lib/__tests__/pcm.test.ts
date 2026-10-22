import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  bytesToBase64,
  bytesToSamples,
  createResampler,
  decodeUtf8,
  samplesToBytes,
} from '../pcm';

describe('base64', () => {
  it('round-trips bytes, including a buffer longer than one slice', () => {
    const bytes = Uint8Array.from({ length: 20_000 }, (_, i) => (i * 7) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('createResampler', () => {
  const ramp = Int16Array.from({ length: 4800 }, (_, i) => i);

  it('turns 24 kHz into two samples for every three', () => {
    const out = createResampler(24000, 16000)(ramp);
    expect(out.length).toBe(3200);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 2, 3, 5]);
  });

  it('gives the same audio whether it arrives in one piece or in ragged chunks', () => {
    const whole = createResampler(24000, 16000)(ramp);

    const chunked = createResampler(24000, 16000);
    const parts: number[] = [];
    let at = 0;
    for (const size of [1, 2, 997, 500, 1, 1300, 333, 1666]) {
      parts.push(...chunked(ramp.slice(at, at + size)));
      at += size;
    }
    expect(at).toBe(ramp.length);
    expect(parts).toEqual(Array.from(whole));
  });
});

describe('samples', () => {
  it('reads little-endian 16-bit samples, even from an odd offset', () => {
    const bytes = new Uint8Array([0, 0x34, 0x12, 0xff, 0xff]).subarray(1);
    expect(Array.from(bytesToSamples(bytes))).toEqual([0x1234, -1]);
    expect(Array.from(samplesToBytes(Int16Array.from([0x1234])))).toEqual([0x34, 0x12]);
  });
});

describe('decodeUtf8', () => {
  it('decodes Urdu transcripts the way TextDecoder would', () => {
    const text = '{"text":"مجھے انسان سے بات کرنی ہے 👍 ok"}';
    expect(decodeUtf8(new TextEncoder().encode(text))).toBe(text);
  });
});
