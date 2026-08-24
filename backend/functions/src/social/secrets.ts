/**
 * Access tokens at rest.
 *
 * A Facebook page token is a password: anyone holding it can post as Velocity
 * to 158k followers. Firestore is encrypted on disk, but a token sitting in a
 * document is readable by anything with database access — an admin session in
 * the console included. So tokens live in a subcollection the security rules
 * close to every client, and they are encrypted there with a key that only
 * Cloud Functions has.
 *
 * The key is `SOCIAL_TOKEN_KEY`, its own GitHub Actions secret (32 bytes,
 * base64 or hex). Without it the desk fails closed: accounts cannot be
 * connected and nothing publishes. That is the deliberate choice — the
 * alternative is storing publishing credentials in the clear.
 *
 * Generate one with:  openssl rand -base64 32
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface SealedSecret {
  /** base64 ciphertext */
  c: string;
  /** base64 initialisation vector */
  iv: string;
  /** base64 GCM auth tag */
  t: string;
}

function key(): Buffer | null {
  const raw = process.env.SOCIAL_TOKEN_KEY?.trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

/** True when tokens can be stored and read back. */
export function tokenVaultReady(): boolean {
  return key() !== null;
}

function requireKey(): Buffer {
  const k = key();
  if (!k) {
    throw new HttpsError(
      'failed-precondition',
      'Social publishing is not configured: the SOCIAL_TOKEN_KEY secret is missing, so access ' +
        'tokens cannot be stored safely. Add it in GitHub → Settings → Secrets and redeploy.',
    );
  }
  return k;
}

export function seal(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, requireKey(), iv);
  const c = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { c: c.toString('base64'), iv: iv.toString('base64'), t: cipher.getAuthTag().toString('base64') };
}

export function open(sealed: SealedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, requireKey(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.t, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.c, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** Last four characters of a token, for "is this the one I pasted?" in the UI. */
export function fingerprint(token: string): string {
  return token.length <= 4 ? '••••' : `••••${token.slice(-4)}`;
}
