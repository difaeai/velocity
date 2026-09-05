/**
 * Sign-in codes over WhatsApp, in place of Firebase's SMS.
 *
 * WHY THIS EXISTS
 * ---------------
 * Firebase bills every verification SMS it sends, and Pakistan is not one of its
 * cheap destinations — a login costs several US cents. Meta bills an approved
 * AUTHENTICATION template to a Pakistani number at roughly a fifth of that, on a
 * business number Velocity already runs for offline-driver alerts. Same six
 * digits, same phone, a fraction of the bill.
 *
 * WHAT THAT COSTS US IN RETURN
 * ----------------------------
 * Firebase's flow has one property this one does not: Google verifies the number
 * and we merely *believe* the result. Here, **this endpoint is the verification**.
 * `verifyWhatsAppOtp` mints a session for whoever presents a matching code, so
 * every control standing between a stranger and somebody else's account is in
 * this file:
 *
 *  • the code comes from `crypto.randomInt`, never `Math.random`;
 *  • only a keyed hash of it is stored, and the comparison is constant-time;
 *  • five wrong guesses burn the challenge — one-in-a-million against five
 *    attempts is the entire security argument, and it collapses without the cap;
 *  • a challenge is single-use and dies five minutes after it is issued;
 *  • sends are rate-limited per number, because each one costs real money.
 *
 * IT MUST NEVER BE THE ONLY WAY IN
 * --------------------------------
 * An offline-driver alert that cannot be sent is a ride nobody hears about. A
 * sign-in code that cannot be sent is a customer locked out of the app. Meta can
 * pause a template, restrict a number, or simply not have the recipient on
 * WhatsApp at all — so every refusal in `startWhatsAppOtp` answers with
 * `via: 'sms'`, and the client falls back to the native Firebase flow, which is
 * still wired up and still works. WhatsApp is the cheap path, not the only path.
 */
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { auth, db, FieldValue, Timestamp } from '../lib/firebase';
import { rateLimit } from '../lib/ratelimit';
import { sendOtpTemplate, toWhatsAppNumber, whatsAppOtpConfig } from '../whatsapp/client';
import { pktDayKey } from '../whatsapp/policy';

const CHALLENGES = 'otpChallenges';
const SETTINGS_DOC = 'config/whatsappOtp';
const HEALTH_DOC = 'config/whatsappOtpHealth';
const USAGE_COLLECTION = 'whatsappUsage';

/** Digits in a code. Six is what Meta's authentication templates expect. */
export const CODE_LENGTH = 6;

/**
 * How long a code stays good. Short enough that one read over somebody's
 * shoulder is worthless by the time it is typed, long enough for a WhatsApp
 * message to land on a slow Pakistani connection and be copied across.
 *
 * Must match `code_expiration_minutes` on the approved template, or the message
 * promises the user something the server does not honour.
 */
export const CODE_TTL_SEC = 5 * 60;

/**
 * Wrong guesses before the challenge is dead.
 *
 * This is the security of the whole scheme. A six-digit code is one in a million,
 * which only means anything because guessing stops at five — without the cap a
 * script walks the space in an afternoon and the code length is decoration.
 */
export const MAX_ATTEMPTS = 5;

/**
 * How long WhatsApp OTP steps aside after Meta returns an account-level refusal.
 *
 * Deliberately NOT the alerts circuit breaker, and deliberately not permanent.
 * The alerts breaker never resets itself because sending into a quality problem
 * makes it worse. Here the failure mode is the opposite: every minute this stays
 * off is a minute of logins billed at Firebase's rate, and nobody is being
 * annoyed by a code they asked for. So it steps aside, lets SMS carry the
 * logins, and tries again later. The two features never switch each other off.
 */
export const HALT_SUPPRESSION_SEC = 30 * 60;

/* ────────────────────────────── Settings ─────────────────────────────────── */

export interface WhatsAppOtpSettings {
  /** Kill switch. Off → every login goes back to Firebase SMS immediately. */
  enabled: boolean;
  /** Platform-wide ceiling on codes sent per PKT day. */
  dailyCap: number;
  /**
   * Codes one number may be sent per hour before it is refused outright.
   *
   * Kept in step with `MAX_SENDS_PER_NUMBER` in the app's own send brake
   * (`src/lib/otpThrottle.ts`), and for a specific reason: this refusal reaches
   * the screen as `auth/too-many-requests`, which the app answers by putting the
   * number in a **one-hour** local cooldown that blocks SMS as well. Set below
   * the client's ladder, this would be the thing users actually hit — an hour
   * locked out of a working app because a cheaper channel was rationed. Set to
   * match, the client's gentler ladder always trips first and this stays what it
   * is meant to be: a backstop against a caller that is not the app.
   */
  maxSendsPerNumberPerHour: number;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

/**
 * Reads `config/whatsappOtp`, clamping on the way out so a fat-fingered admin
 * edit cannot become an unbounded spend or a lockout.
 *
 * Defaults to ENABLED, unlike the alerts settings which default to off. The
 * difference is consent: alerts message people who have not asked and must be
 * armed deliberately, while a code only ever goes to somebody who just tapped
 * Continue. The real switch is `WHATSAPP_OTP_TEMPLATE_NAME` — with no approved
 * template there is nothing to send and this never runs.
 */
export function readOtpSettings(
  raw: Record<string, unknown> | undefined | null,
): WhatsAppOtpSettings {
  const d = raw ?? {};
  return {
    enabled: d.enabled !== false,
    dailyCap: clamp(d.dailyCap, 0, 100_000, 3_000),
    maxSendsPerNumberPerHour: clamp(d.maxSendsPerNumberPerHour, 1, 20, 10),
  };
}

/* ──────────────────────────── Pure helpers ───────────────────────────────── */

/**
 * A code, from the CSPRNG.
 *
 * `Math.random` is seeded predictably enough that its output can be
 * reconstructed from a handful of observed values — which, for the only thing
 * guarding an account, is the difference between one-in-a-million and one guess.
 *
 * Leading zeros are kept: dropping them would shrink the space and make short
 * codes recognisable on sight.
 */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * The stored form of a code.
 *
 * Keyed with `OTP_PEPPER` when it is configured, so a leaked database snapshot
 * is not a list of live codes — six digits fall to a brute force in
 * milliseconds without a key, and the challenge id salts but does not protect.
 * The pepper is optional because a login must not break on a missing secret;
 * without it this is domain separation and nothing more, which is exactly what
 * the docs say it is.
 *
 * The phone number is bound in, so a hash cannot be replayed against a challenge
 * issued for a different number.
 */
export function hashCode(challengeId: string, phone: string, code: string): string {
  return createHmac('sha256', process.env.OTP_PEPPER || 'velocity.whatsapp.otp')
    .update(`${challengeId}:${phone}:${code}`)
    .digest('hex');
}

/** Constant-time, so a code cannot be walked digit by digit off the clock. */
function hashesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export interface ChallengeState {
  codeHash: string;
  attempts: number;
  consumed: boolean;
  validUntilMs: number;
}

export type ChallengeVerdict =
  /** The code is right and the challenge was still live. */
  | 'ok'
  /** Past its five minutes. */
  | 'expired'
  /** Already redeemed — a second sign-in must not ride the same code. */
  | 'spent'
  /** Five wrong guesses. Dead regardless of what is presented now. */
  | 'locked'
  /** Live challenge, wrong digits. */
  | 'wrong';

/**
 * The whole decision, pure, so the rules that carry the security weight are
 * testable without an emulator, a token or a clock.
 *
 * Order matters. `consumed` and `expired` are checked before the attempt cap so
 * a spent challenge never reports as "too many attempts", and the code itself is
 * compared last so a dead challenge never leaks whether the digits were right.
 */
export function checkChallenge(
  state: ChallengeState,
  expectedHash: string,
  nowMs: number,
): ChallengeVerdict {
  if (state.consumed) return 'spent';
  if (nowMs >= state.validUntilMs) return 'expired';
  if (state.attempts >= MAX_ATTEMPTS) return 'locked';
  return hashesMatch(state.codeHash, expectedHash) ? 'ok' : 'wrong';
}

/* ─────────────────────────── Budget and health ───────────────────────────── */

function toMillis(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/**
 * Takes one slot out of today's budget, or reports that there is none left.
 *
 * Transactional because the alternative — read, decide, write — lets a burst of
 * concurrent logins all read the same count and every one of them believe it is
 * under the cap.
 */
async function reserveOtpBudget(day: string, cap: number): Promise<boolean> {
  if (cap <= 0) return false;
  const ref = db.doc(`${USAGE_COLLECTION}/${day}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = (snap.get('otpReserved') as number | undefined) ?? 0;
    if (used >= cap) return false;
    tx.set(ref, { otpReserved: used + 1, day }, { merge: true });
    return true;
  });
}

/** Fire-and-forget counters, surfaced by `adminGetWhatsAppStatus`. */
function countOtpUsage(field: 'otpSent' | 'otpFailed', day: string): void {
  db.doc(`${USAGE_COLLECTION}/${day}`)
    .set({ [field]: FieldValue.increment(1), day }, { merge: true })
    .catch(() => undefined);
}

/** Steps WhatsApp OTP aside for a while after an account-level refusal. */
async function suppressWhatsAppOtp(reason: string, code: number | null): Promise<void> {
  logger.error('WhatsApp OTP: suppressed after account-level refusal', { code, reason });
  await db
    .doc(HEALTH_DOC)
    .set(
      {
        suppressedUntil: Timestamp.fromMillis(Date.now() + HALT_SUPPRESSION_SEC * 1000),
        reason,
        code: code ?? null,
        at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => undefined);
}

/* ──────────────────────────── Send the code ──────────────────────────────── */

const startSchema = z.object({
  phone: z.string().min(6).max(24),
});

/**
 * Why WhatsApp did not carry this code. Reported back so the client knows to use
 * the SMS path, and so a support conversation has something to go on other than
 * "it went to SMS again".
 */
export type OtpFallbackReason =
  /** No approved template configured on the backend. */
  | 'not-configured'
  /** Admin kill switch. */
  | 'disabled'
  /** Meta refused at the account level recently; sitting it out. */
  | 'suppressed'
  /** Today's platform-wide budget is gone. */
  | 'capped'
  /** This number is not on WhatsApp. */
  | 'undeliverable'
  /** Meta refused this one send for some other reason. */
  | 'send-failed';

/**
 * Sends a sign-in code over WhatsApp, or says why it could not.
 *
 * Unauthenticated by necessity — the caller is signing in and has no session
 * yet. That makes it a paid endpoint anyone on the internet can call, so the
 * per-number rate limit and the daily cap are not tidiness, they are the bill.
 *
 * Never throws for a WhatsApp-side problem: the caller has to be able to fall
 * through to SMS. It throws only when the *request* is wrong (a bad number) or
 * when the number has asked for too many codes — and that last one is
 * deliberately not a fallback, because handing a dearer SMS to a number that has
 * already had five codes in an hour rewards exactly the behaviour the limit
 * exists to stop.
 */
export const startWhatsAppOtp = onCall(async (req) => {
  const parsed = startSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Enter your mobile number.');

  const to = toWhatsAppNumber(parsed.data.phone);
  if (!to) throw new HttpsError('invalid-argument', 'Enter a valid Pakistani mobile number.');

  const fallback = (reason: OtpFallbackReason) => ({
    sent: false as const,
    via: 'sms' as const,
    reason,
  });

  const cfg = whatsAppOtpConfig();
  if (!cfg) return fallback('not-configured');

  const [settingsSnap, healthSnap] = await Promise.all([
    db.doc(SETTINGS_DOC).get(),
    db.doc(HEALTH_DOC).get(),
  ]);
  const settings = readOtpSettings(settingsSnap.data());
  if (!settings.enabled) return fallback('disabled');

  const suppressedUntil = toMillis(healthSnap.get('suppressedUntil'));
  if (suppressedUntil !== null && suppressedUntil > Date.now()) return fallback('suppressed');

  // Keyed on the number rather than a uid — there is no uid yet, and the number
  // is what the spend is attached to.
  await rateLimit(to, 'whatsappOtpSend', settings.maxSendsPerNumberPerHour, 3600);

  const day = pktDayKey(Date.now());
  if (!(await reserveOtpBudget(day, settings.dailyCap))) return fallback('capped');

  // A resend issues a NEW challenge and leaves the previous one alone to expire,
  // which Firebase does not do. It means somebody who tapped Resend and then
  // typed the first code still gets in, instead of being told a code they are
  // reading off their own screen is wrong. The cost is a handful of live codes
  // per number for five minutes — and since each carries its own five-attempt
  // cap, the ceiling that matters (guesses per hour against a million) barely
  // moves.
  const code = generateCode();
  const ref = db.collection(CHALLENGES).doc();
  const nowMs = Date.now();

  await ref.set({
    phone: to,
    e164: `+${to}`,
    codeHash: hashCode(ref.id, to, code),
    attempts: 0,
    consumed: false,
    validUntilMs: nowMs + CODE_TTL_SEC * 1000,
    createdAt: FieldValue.serverTimestamp(),
    // Swept by the Firestore TTL policy (see docs/HARDENING.md). An hour past
    // the code's own life, so a challenge is always dead by the rules above long
    // before the sweeper is what stops it.
    expireAt: Timestamp.fromMillis(nowMs + 60 * 60 * 1000),
  });

  const res = await sendOtpTemplate(cfg, to, code);

  if (!res.ok) {
    // Nothing was delivered, so the challenge is a live code nobody has. Drop it
    // rather than leave one redeemable by whoever guesses six digits.
    await ref.delete().catch(() => undefined);
    countOtpUsage('otpFailed', day);
    if (res.action === 'halt') await suppressWhatsAppOtp(res.detail, res.code);
    return fallback(res.action === 'drop-recipient' ? 'undeliverable' : 'send-failed');
  }

  countOtpUsage('otpSent', day);
  return {
    sent: true as const,
    via: 'whatsapp' as const,
    challengeId: ref.id,
    expiresInSec: CODE_TTL_SEC,
  };
});

/* ─────────────────────────── Redeem the code ─────────────────────────────── */

const verifySchema = z.object({
  challengeId: z.string().min(1).max(128),
  code: z.string().regex(new RegExp(`^\\d{${CODE_LENGTH}}$`)),
});

/**
 * Finds the account this number already belongs to, or opens one.
 *
 * `getUserByPhoneNumber` is what keeps every existing account intact through
 * this change: a passenger who signed up through Firebase's SMS flow has a user
 * record keyed on the same E.164 number, so they come back with the same uid,
 * the same trips, the same wallet and the same claims. Nothing is migrated
 * because nothing needs to be — only the way the number was proved has changed.
 */
async function userForPhone(
  e164: string,
): Promise<{ uid: string; created: boolean; disabled: boolean }> {
  try {
    const existing = await auth.getUserByPhoneNumber(e164);
    return { uid: existing.uid, created: false, disabled: existing.disabled };
  } catch (e) {
    if ((e as { code?: string } | null)?.code !== 'auth/user-not-found') throw e;
  }

  try {
    const made = await auth.createUser({ phoneNumber: e164 });
    return { uid: made.uid, created: true, disabled: false };
  } catch (e) {
    // Two taps of Verify landing together: whoever loses the race still gets the
    // account the winner made, rather than an error on a correct code.
    if ((e as { code?: string } | null)?.code === 'auth/phone-number-already-exists') {
      const existing = await auth.getUserByPhoneNumber(e164);
      return { uid: existing.uid, created: false, disabled: existing.disabled };
    }
    throw e;
  }
}

/**
 * Trades a correct code for a session.
 *
 * The custom token is minted for the uid the phone number resolves to, exactly
 * as `exchangePhoneSession` does for the native flow — same project, same uid,
 * same claims, so every security rule and every screen keeps working untouched.
 */
export const verifyWhatsAppOtp = onCall(async (req) => {
  const parsed = verifySchema.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', `Enter the ${CODE_LENGTH}-digit code.`);
  }
  const { challengeId, code } = parsed.data;

  // Belt to the attempt counter's braces. That counter lives in the challenge
  // document, so it can only ever stop guesses against a challenge that still
  // exists; this stops the hammering itself.
  await rateLimit(challengeId, 'whatsappOtpVerify', MAX_ATTEMPTS * 3, 900);

  const ref = db.doc(`${CHALLENGES}/${challengeId}`);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // A challenge that has been swept, deleted after a failed send, or simply
    // never existed is indistinguishable from an expired one — and that is the
    // right answer anyway: "request a new code" is what the user has to do.
    if (!snap.exists) return { verdict: 'expired' as ChallengeVerdict, e164: null };

    const phone = (snap.get('phone') as string | undefined) ?? '';
    const state: ChallengeState = {
      codeHash: (snap.get('codeHash') as string | undefined) ?? '',
      attempts: (snap.get('attempts') as number | undefined) ?? 0,
      consumed: snap.get('consumed') === true,
      validUntilMs: (snap.get('validUntilMs') as number | undefined) ?? 0,
    };

    const verdict = checkChallenge(state, hashCode(challengeId, phone, code), Date.now());

    if (verdict === 'ok') {
      // Marked spent inside the transaction, so two requests carrying the same
      // correct code cannot both be told yes.
      tx.update(ref, { consumed: true, consumedAt: FieldValue.serverTimestamp() });
    } else if (verdict === 'wrong') {
      tx.update(ref, { attempts: state.attempts + 1 });
    }

    return { verdict, e164: (snap.get('e164') as string | undefined) ?? null };
  });

  if (outcome.verdict === 'expired' || outcome.verdict === 'spent') {
    throw new HttpsError('unauthenticated', 'That code has expired. Please request a new one.');
  }
  if (outcome.verdict === 'locked') {
    throw new HttpsError('resource-exhausted', 'Too many incorrect codes. Please request a new one.');
  }
  if (outcome.verdict === 'wrong') {
    throw new HttpsError('permission-denied', 'Incorrect code.');
  }
  if (!outcome.e164) {
    throw new HttpsError('internal', 'Sign-in could not be completed. Please try again.');
  }

  const user = await userForPhone(outcome.e164);
  if (user.disabled) {
    throw new HttpsError('permission-denied', 'This account has been disabled. Contact support.');
  }

  if (user.created) {
    // `onUserCreate` provisions the profile, the wallet and this same claim —
    // but it is a background trigger, and this flow reaches signInWithCustomToken
    // in a fraction of the time a cold start takes. Setting the claim here means
    // the first ID token already carries `role`, so a brand-new passenger is not
    // bounced by the role guard on the screen they land on. The trigger writes
    // the identical value, so the two cannot disagree.
    await auth.setCustomUserClaims(user.uid, { role: 'passenger' }).catch((err) => {
      logger.warn('WhatsApp OTP: could not pre-set role claim', { uid: user.uid, err });
    });
  }

  logger.info('WhatsApp OTP: signed in', { uid: user.uid, created: user.created });
  const customToken = await auth.createCustomToken(user.uid);
  return { customToken };
});
