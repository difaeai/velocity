/**
 * The WhatsApp sign-in send, end to end against the Firestore emulator, with
 * Meta mocked out.
 *
 * The checks in front of a paid send now run as one transaction instead of
 * three steps, and the challenge is written while the message is going out
 * rather than before it. Both changes are about speed, so the thing that must
 * never regress is everything else:
 *   - the rules still refuse in the same order (kill switch, reviewer number,
 *     suppression, rate limit, budget) and a refusal costs what it did before;
 *   - a sent code can be redeemed, and a code Meta refused cannot;
 *   - a wake-up ping does nothing but wake the function.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { pktDayKey } from '../../whatsapp/policy';
import { startWhatsAppOtp, verifyWhatsAppOtp } from '../whatsappOtp';

type MetaAnswer =
  | { ok: true; messageId: string }
  | { ok: false; code: number; action: string; detail: string };

// Hoisted with the mock, which runs before anything else in this file.
const meta = vi.hoisted(() => ({
  sent: [] as { to: string; code: string }[],
  answer: { ok: true, messageId: 'wamid.1' } as MetaAnswer,
}));

vi.mock('../../whatsapp/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../whatsapp/client')>();
  return {
    ...real,
    sendOtpTemplate: vi.fn(async (_cfg: unknown, to: string, code: string) => {
      meta.sent.push({ to, code });
      return meta.answer;
    }),
  };
});

const PHONE = '+923001234567';
const TO = '923001234567';

/** Unauthenticated, as a sign-in request always is. */
function req<T>(data: T): CallableRequest<T> {
  return { data, rawRequest: {} as never, acceptsStreaming: false } as unknown as CallableRequest<T>;
}

async function rateCount(): Promise<number | undefined> {
  const snap = await db().collection('rateLimits').where('action', '==', 'whatsappOtpSend').get();
  return snap.empty ? undefined : (snap.docs[0]?.get('count') as number);
}

async function reserved(): Promise<number | undefined> {
  return (await db().doc(`whatsappUsage/${pktDayKey(Date.now())}`).get()).get('otpReserved') as
    | number
    | undefined;
}

beforeEach(async () => {
  await clearFirestore();
  meta.sent.length = 0;
  meta.answer = { ok: true, messageId: 'wamid.1' };
  process.env.WHATSAPP_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234';
  process.env.WHATSAPP_OTP_TEMPLATE_NAME = 'velocity_login_code';
});

describe('startWhatsAppOtp', () => {
  it('answers a wake-up ping without sending, counting or storing anything', async () => {
    await expect(startWhatsAppOtp.run(req({ warm: true }))).resolves.toEqual({ warm: true });
    expect(meta.sent).toHaveLength(0);
    expect(await rateCount()).toBeUndefined();
    expect(await reserved()).toBeUndefined();
    expect((await db().collection('otpChallenges').get()).size).toBe(0);
  });

  it('sends a code that verifies, and counts it once against the number and the day', async () => {
    const res = await startWhatsAppOtp.run(req({ phone: PHONE }));
    expect(res).toMatchObject({ sent: true, via: 'whatsapp' });
    if (!('challengeId' in res)) throw new Error('expected a challenge');

    expect(meta.sent).toEqual([{ to: TO, code: expect.stringMatching(/^\d{6}$/) }]);
    expect(await rateCount()).toBe(1);
    expect(await reserved()).toBe(1);

    const challenge = await db().doc(`otpChallenges/${res.challengeId}`).get();
    expect(challenge.get('phone')).toBe(TO);
    expect(challenge.get('messageId')).toBe('wamid.1');

    const signedIn = await verifyWhatsAppOtp.run(
      req({ challengeId: res.challengeId, code: meta.sent[0]!.code }),
    );
    expect(signedIn).toEqual({ customToken: expect.any(String) });
  });

  it('refuses past the hourly limit without spending budget on the refusal', async () => {
    await db().doc('config/whatsappOtp').set({ maxSendsPerNumberPerHour: 2 });
    await startWhatsAppOtp.run(req({ phone: PHONE }));
    await startWhatsAppOtp.run(req({ phone: PHONE }));

    await expect(startWhatsAppOtp.run(req({ phone: PHONE }))).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(meta.sent).toHaveLength(2);
    expect(await rateCount()).toBe(2);
    expect(await reserved()).toBe(2);
  });

  it('falls back once the day is spent, still counting the attempt against the number', async () => {
    await db().doc('config/whatsappOtp').set({ dailyCap: 1 });
    await startWhatsAppOtp.run(req({ phone: PHONE }));

    await expect(startWhatsAppOtp.run(req({ phone: PHONE }))).resolves.toEqual({
      sent: false,
      via: 'sms',
      reason: 'capped',
    });
    expect(meta.sent).toHaveLength(1);
    expect(await rateCount()).toBe(2);
    expect(await reserved()).toBe(1);
  });

  it('switched off, sends nothing and counts nothing', async () => {
    await db().doc('config/whatsappOtp').set({ enabled: false });
    await expect(startWhatsAppOtp.run(req({ phone: PHONE }))).resolves.toMatchObject({
      reason: 'disabled',
    });
    expect(meta.sent).toHaveLength(0);
    expect(await rateCount()).toBeUndefined();
    expect(await reserved()).toBeUndefined();
  });

  it('never rate-limits the reviewer number, however often it asks', async () => {
    await db().doc('config/whatsappOtp').set({ maxSendsPerNumberPerHour: 1 });
    for (let i = 0; i < 3; i += 1) {
      await expect(startWhatsAppOtp.run(req({ phone: '+923000000000' }))).resolves.toMatchObject({
        reason: 'undeliverable',
      });
    }
    expect(meta.sent).toHaveLength(0);
    expect(await rateCount()).toBeUndefined();
  });

  it('sits out a suppression without counting against the number', async () => {
    await db().doc('config/whatsappOtpHealth').set({ suppressedUntil: Date.now() + 60_000 });
    await expect(startWhatsAppOtp.run(req({ phone: PHONE }))).resolves.toMatchObject({
      reason: 'suppressed',
    });
    expect(meta.sent).toHaveLength(0);
    expect(await rateCount()).toBeUndefined();
  });

  it('drops the challenge when Meta refuses, so the code can never be redeemed', async () => {
    meta.answer = { ok: false, code: 131026, action: 'drop-recipient', detail: 'not on WhatsApp' };
    await expect(startWhatsAppOtp.run(req({ phone: PHONE }))).resolves.toMatchObject({
      reason: 'undeliverable',
    });
    expect((await db().collection('otpChallenges').get()).size).toBe(0);
  });
});
