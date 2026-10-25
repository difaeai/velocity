/**
 * Phone audio ⇄ Gemini audio.
 *
 * Twilio speaks G.711 μ-law at 8 kHz, one byte a sample. Gemini Live takes
 * 16-bit PCM at any rate it is told (8 kHz is fine, it resamples) and speaks
 * 16-bit PCM at 24 kHz. So the way in is a table lookup; the way out is a
 * 3:1 decimation (averaging the three, which is the low-pass that keeps it
 * from sounding like a tin can) and then the μ-law encoder.
 */

/** μ-law byte → 16-bit linear sample. */
const DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  DECODE[i] = sign ? -magnitude : magnitude;
}

/** μ-law bytes → 16-bit little-endian PCM. */
export function mulawToPcm16(mulaw) {
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) out.writeInt16LE(DECODE[mulaw[i]], i * 2);
  return out;
}

const BIAS = 0x84;
const CLIP = 32635;

/** One 16-bit sample → μ-law byte (G.711). */
export function linearToMulaw(sample) {
  let s = Math.max(-CLIP, Math.min(CLIP, sample));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/**
 * 24 kHz PCM16 → 8 kHz μ-law, across chunks: a chunk whose length is not a
 * multiple of three leaves its last samples for the next one, so nothing is
 * dropped or doubled at the seams.
 */
export class Downsampler {
  #carry = [];

  /** @param {Buffer} pcm24 16-bit LE samples at 24 kHz */
  push(pcm24) {
    const samples = this.#carry.slice();
    for (let i = 0; i + 1 < pcm24.length; i += 2) samples.push(pcm24.readInt16LE(i));
    const whole = samples.length - (samples.length % 3);
    const out = Buffer.alloc(whole / 3);
    for (let i = 0, j = 0; i < whole; i += 3, j++) {
      out[j] = linearToMulaw(Math.round((samples[i] + samples[i + 1] + samples[i + 2]) / 3));
    }
    this.#carry = samples.slice(whole);
    return out;
  }
}
