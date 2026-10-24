/**
 * Velocity Studio sign-up: who someone is, and proof the email is theirs.
 *
 * Google sign-in arrives with a verified address. An email-and-password account
 * does not, so the backend mails a six-digit code and the next screen asks for
 * it; only then does Firebase mark the address verified, and only a verified
 * address can open a workspace (and its free day) in `studioCreateWorkspace`.
 *
 * The code is stored as a keyed hash, lives ten minutes, allows five tries, and
 * a new one cannot be sent more than once every 45 seconds or five times an
 * hour. `studioUsers/{uid}` is the admin's list of everyone who started — a
 * sign-up that stops at the code is a lead the admin can still see.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { auth, db } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendStudioMail } from './mailer';

const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 45_000;
const MAX_TRIES = 5;

const codeRef = (uid: string) => db.doc(`studioEmailCodes/${uid}`);
export const studioUserRef = (uid: string) => db.doc(`studioUsers/${uid}`);

/** Keyed, and bound to the account and the address, so a leaked row is not a live code. */
export function hashEmailCode(uid: string, email: string, code: string): string {
  return createHmac('sha256', process.env.OTP_PEPPER || 'velocity.studio.email')
    .update(`${uid}:${email.toLowerCase()}:${code}`)
    .digest('hex');
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** How this person signed in, from the token Firebase issued. */
export function signInMethod(token: Record<string, unknown>): 'google' | 'email' {
  const provider = (token.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  return provider === 'google.com' ? 'google' : 'email';
}

/** Record (or refresh) a person on the admin's list. Never overwrites the first-seen time. */
export async function touchStudioUser(
  uid: string,
  token: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const ref = studioUserRef(uid);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const seen = (await tx.get(ref)).exists;
    tx.set(
      ref,
      {
        uid,
        email: (token.email as string | undefined) ?? null,
        name: (token.name as string | undefined) ?? null,
        method: signInMethod(token),
        emailVerified: token.email_verified === true,
        lastSeenAtMs: now,
        ...(seen ? {} : { createdAtMs: now }),
        ...extra,
      },
      { merge: true },
    );
  });
}

/** The sign-up page says hello: puts a person who has not finished on the admin's list. */
export const studioTouch = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (ctx.role === 'admin') return { ok: true };
  await touchStudioUser(ctx.uid, ctx.token);
  return { ok: true };
});

export const studioSendEmailCode = onCall(async (req) => {
  const ctx = requireAuth(req);
  const email = ctx.token.email as string | undefined;
  if (!email) throw new HttpsError('failed-precondition', 'This account has no email address.');
  if (ctx.token.email_verified === true) return { ok: true, alreadyVerified: true };

  const last = (await codeRef(ctx.uid).get()).get('sentAtMs') as number | undefined;
  if (last && Date.now() - last < RESEND_AFTER_MS) {
    throw new HttpsError('resource-exhausted', 'A code is on its way. You can ask for another in a minute.');
  }
  await rateLimit(ctx.uid, 'studioSendEmailCode', 5, 3600);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Date.now();
  await codeRef(ctx.uid).set({
    hash: hashEmailCode(ctx.uid, email, code),
    email: email.toLowerCase(),
    sentAtMs: now,
    expiresAtMs: now + CODE_TTL_MS,
    tries: 0,
  });
  await touchStudioUser(ctx.uid, ctx.token);

  await sendStudioMail({
    to: email,
    subject: `${code} is your Velocity Studio code`,
    text: `Your Velocity Studio verification code is ${code}.\n\nIt works for 10 minutes. If you did not sign up, ignore this email.`,
    html: `<p>Your Velocity Studio verification code is</p><p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p><p>It works for 10 minutes. If you did not sign up, ignore this email.</p>`,
  });
  return { ok: true, sentTo: email };
});

export const studioVerifyEmailCode = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Type the 6-digit code from the email.');
  const email = ((ctx.token.email as string | undefined) ?? '').toLowerCase();

  // The outcome comes out of the transaction rather than a throw inside it, so
  // a wrong try is counted even though the call fails.
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef(ctx.uid));
    const row = snap.data() as { hash: string; email: string; expiresAtMs: number; tries: number } | undefined;
    if (!row || row.email !== email) return 'missing' as const;
    if (Date.now() > row.expiresAtMs) return 'expired' as const;
    if (row.tries >= MAX_TRIES) return 'locked' as const;
    if (!same(row.hash, hashEmailCode(ctx.uid, email, parsed.data.code))) {
      tx.update(snap.ref, { tries: row.tries + 1 });
      return MAX_TRIES - row.tries - 1;
    }
    tx.delete(snap.ref);
    return 'ok' as const;
  });

  if (outcome === 'missing') throw new HttpsError('not-found', 'Send yourself a new code.');
  if (outcome === 'expired') throw new HttpsError('deadline-exceeded', 'That code has expired. Send a new one.');
  if (outcome === 'locked') throw new HttpsError('resource-exhausted', 'Too many wrong tries. Send a new code.');
  if (typeof outcome === 'number') {
    throw new HttpsError(
      'invalid-argument',
      outcome > 0 ? `That code is not right. ${outcome} ${outcome === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Send a new code.',
    );
  }

  await auth.updateUser(ctx.uid, { emailVerified: true });
  await studioUserRef(ctx.uid).set({ emailVerified: true, verifiedAtMs: Date.now() }, { merge: true });
  return { ok: true };
});
