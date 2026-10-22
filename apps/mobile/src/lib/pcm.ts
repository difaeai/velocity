/**
 * Raw audio plumbing for the phone helpline (app/support/call.tsx).
 *
 * Gemini Live listens to 16-bit PCM at 16 kHz and speaks it at 24 kHz, base64
 * inside JSON. The phone's echo-cancelling audio module records and plays 16 kHz.
 * These are the conversions between the two — pure, so they run under vitest.
 */

/** Bytes per millisecond of 16-bit mono audio at 16 kHz. */
export const PCM16K_BYTES_PER_MS = 32;

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  // Sliced, so a long buffer never overflows the engine's argument limit.
  for (let i = 0; i < bytes.length; i += 0x2000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(bin);
}

/**
 * A streaming resampler: chunks in, chunks out, and no click at the seams — the
 * fractional read position and the last sample carry over from one chunk to the
 * next. Linear interpolation is plenty for a voice that is already speech-band.
 */
export function createResampler(fromRate: number, toRate: number): (input: Int16Array) => Int16Array {
  const step = fromRate / toRate;
  // Read position relative to the current chunk; -1 is the carried sample.
  let pos = 0;
  let carry = 0;
  return (input) => {
    const out: number[] = [];
    const at = (i: number) => (i < 0 ? carry : input[i]!);
    while (pos + 1 < input.length) {
      const i = Math.floor(pos);
      const f = pos - i;
      out.push(Math.round(at(i) * (1 - f) + at(i + 1) * f));
      pos += step;
    }
    if (input.length > 0) {
      carry = input[input.length - 1]!;
      pos -= input.length;
    }
    return Int16Array.from(out);
  };
}

/** Little-endian 16-bit samples ↔ bytes. Every phone this app runs on is little-endian. */
export function bytesToSamples(bytes: Uint8Array): Int16Array {
  const copy = bytes.byteOffset % 2 === 0 ? bytes : bytes.slice();
  return new Int16Array(copy.buffer, copy.byteOffset, copy.byteLength >> 1);
}

export function samplesToBytes(samples: Int16Array): Uint8Array {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

/** UTF-8 bytes → string, for binary WebSocket frames on an engine with no TextDecoder. */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const next = () => (bytes[i++] ?? 0) & 0x3f;
  while (i < bytes.length) {
    const b = bytes[i++]!;
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 0x1f) << 6) | next();
    else if (b < 0xf0) cp = ((b & 0x0f) << 12) | (next() << 6) | next();
    else cp = ((b & 0x07) << 18) | (next() << 12) | (next() << 6) | next();
    out += String.fromCodePoint(cp);
  }
  return out;
}
