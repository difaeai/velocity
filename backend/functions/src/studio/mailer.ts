/**
 * The mailbox Velocity Studio sends sign-up codes from.
 *
 * There is no transactional mail service on this project, so the codes go out
 * over SMTP from a mailbox an admin connects once on Velocity AI Studio →
 * Sign-up email — the same way the sales agent sends from a customer's own
 * mailbox. Saving proves it: the server logs in, and a test message goes to the
 * admin before anything is stored. The password is sealed with the social token
 * key at `system/studioMailer/secret/credentials`, which no client rule reaches.
 *
 * Until one is connected, email sign-up refuses with a plain sentence and
 * Google sign-up (already-verified addresses) carries on. In the emulator the
 * code is logged instead, so the flow can be walked locally without a mailbox.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import nodemailer from 'nodemailer';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { open, seal, tokenVaultReady, type SealedSecret } from '../social/secrets';

const PUBLIC = 'system/studioMailer';
const SECRET = 'system/studioMailer/secret/credentials';

interface MailerConfig {
  host: string;
  port: number;
  user: string;
  from: string;
  fromName: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const transport = (c: MailerConfig, pass: string) =>
  nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true';

/** The stored mailbox and its password, or null when none is connected. */
async function loadMailer(): Promise<{ config: MailerConfig; pass: string } | null> {
  const [pub, sec] = await Promise.all([db.doc(PUBLIC).get(), db.doc(SECRET).get()]);
  const config = pub.data() as MailerConfig | undefined;
  const sealed = sec.get('pass') as SealedSecret | undefined;
  if (!config?.host || !sealed || !tokenVaultReady()) return null;
  try {
    return { config, pass: open(sealed) };
  } catch (e) {
    logger.error('studio: the sign-up mailbox password could not be opened — was SOCIAL_TOKEN_KEY rotated?', { e });
    return null;
  }
}

/**
 * Send one message from the sign-up mailbox. Throws a customer-readable
 * HttpsError when there is no mailbox, except in the emulator, where the
 * message is logged so a local walk-through still works.
 */
export async function sendStudioMail(mail: Mail): Promise<void> {
  const mailer = await loadMailer();
  if (!mailer) {
    if (isEmulator()) {
      logger.info('studio: no mailbox connected — emulator only, the message is logged instead', mail);
      return;
    }
    throw new HttpsError('failed-precondition', 'Email sign-up is not open yet. Continue with Google instead.');
  }
  const { config, pass } = mailer;
  try {
    await transport(config, pass).sendMail({ from: { name: config.fromName, address: config.from }, ...mail });
  } catch (e) {
    logger.error('studio: sending mail failed', { to: mail.to, message: (e as Error).message });
    throw new HttpsError('unavailable', 'We could not send the email just now. Try again in a minute.');
  }
}

const mailerSchema = z.object({
  host: z.string().trim().min(3).max(120).regex(/^[a-z0-9.-]+$/i),
  port: z.number().int().refine((p) => [25, 465, 587, 2525].includes(p), 'Use port 465, 587, 25 or 2525.'),
  user: z.string().trim().min(3).max(200),
  /** Empty keeps the stored password: the console never sees it again. */
  pass: z.string().max(200).optional().default(''),
  from: z.string().trim().email().max(200),
  fromName: z.string().trim().min(2).max(80),
  /** Where the proving message goes; the admin's own address. */
  testTo: z.string().trim().email().max(200),
});

/** Connect (or change) the sign-up mailbox: logs in, sends a test, then stores it. */
export const adminSetStudioMailer = onCall({ timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAdmin(req);
  const parsed = mailerSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Fill in every field.');
  const { pass: typed, testTo, ...config } = parsed.data;
  if (!tokenVaultReady()) {
    throw new HttpsError('failed-precondition', 'SOCIAL_TOKEN_KEY is not configured, so the password cannot be stored safely.');
  }

  const stored = (await db.doc(SECRET).get()).get('pass') as SealedSecret | undefined;
  const pass = typed || (stored ? open(stored) : '');
  if (!pass) throw new HttpsError('invalid-argument', 'Type the mailbox password (an app password for Gmail).');

  try {
    const t = transport(config, pass);
    await t.verify();
    await t.sendMail({
      from: { name: config.fromName, address: config.from },
      to: testTo,
      subject: 'Velocity Studio sign-up email is connected',
      text: 'This mailbox now sends the verification codes for Velocity Studio sign-ups.',
    });
  } catch (e) {
    throw new HttpsError('failed-precondition', `The mailbox refused: ${(e as Error).message.slice(0, 200)}`);
  }

  await db.doc(SECRET).set({ pass: seal(pass), updatedAt: FieldValue.serverTimestamp() });
  await db.doc(PUBLIC).set({ ...config, verifiedAtMs: Date.now(), updatedBy: ctx.uid });
  return { ok: true };
});
