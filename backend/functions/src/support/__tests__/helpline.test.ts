/**
 * The phone helpline: the agent is told who is calling, the Gemini key never
 * leaves the server, and a call that needs a person becomes a ticket in the
 * desk queue — including when the caller asked for one and the model never
 * reached for the tool.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import {
  HELPLINE_MODEL,
  HELPLINE_VOICE,
  helplineInstruction,
  helplineSetup,
  logHelplineCall,
  startHelplineCall,
} from '../helpline';

describe('helplineInstruction', () => {
  it('briefs a driver call and a passenger call differently, with the caller’s own facts', () => {
    const driver = helplineInstruction('driver', 'BRIEF', 'Name: Imran');
    const passenger = helplineInstruction('passenger', 'BRIEF', 'Name: Sara');

    expect(driver).toContain('This caller is a DRIVER');
    expect(driver).toContain('Name: Imran');
    expect(passenger).toContain('This caller is a PASSENGER');
    expect(passenger).not.toContain('This caller is a DRIVER');
  });

  it('speaks as a woman, says it is an AI, and never promises money', () => {
    const text = helplineInstruction('passenger', 'BRIEF', 'facts');
    expect(text).toContain('main dekh rahi hoon');
    expect(text).toContain('AI assistant');
    expect(text).toContain('Never promise money');
  });
});

describe('helplineSetup', () => {
  it('locks the model, the voice, the hand-over tool and patient turn-taking into the session', () => {
    const setup = helplineSetup('instructions');
    expect(setup.model).toBe(`models/${HELPLINE_MODEL}`);
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(HELPLINE_VOICE);
    expect(setup.tools[0].functionDeclarations[0].name).toBe('hand_to_human');
    expect(setup.realtimeInputConfig.automaticActivityDetection.endOfSpeechSensitivity).toBe('END_SENSITIVITY_LOW');
    expect(setup.systemInstruction.parts[0].text).toBe('instructions');
  });
});

describe('startHelplineCall', () => {
  beforeEach(clearFirestore);
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_KEY_RESEARCH;
    delete process.env.GEMINI_LIVE_KEY;
  });

  it('says "not available" instead of failing when there is no key', async () => {
    const res = await startHelplineCall.run(makeReq({}, 'hl-nokey'));
    expect(res).toEqual({ available: false });
  });

  it('hands the phone a locked one-use token, never the key, and briefs a driver as a driver', async () => {
    process.env.GEMINI_LIVE_KEY = 'secret-key';
    await db().doc('users/hl-driver').set({ displayName: 'Imran', role: 'driver' });
    await db().doc('drivers/hl-driver').set({ verificationStatus: 'approved' });

    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ name: 'auth_tokens/abc123' }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = await startHelplineCall.run(makeReq({}, 'hl-driver'));
    expect(res).toMatchObject({ available: true, token: 'auth_tokens/abc123', role: 'driver' });
    expect(JSON.stringify(res)).not.toContain('secret-key');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/v1beta/auth_tokens');
    const body = JSON.parse(String(init.body));
    expect(body.uses).toBe(1);
    expect(body.bidiGenerateContentSetup.systemInstruction.parts[0].text).toContain('This caller is a DRIVER');
    // No field mask: every field is locked, so the phone cannot rewrite the brief.
    expect(body.fieldMask).toBeUndefined();

    const callId = (res as { callId: string }).callId;
    expect((await db().doc(`helplineCalls/${callId}`).get()).data()).toMatchObject({
      uid: 'hl-driver',
      role: 'driver',
      status: 'live',
    });
  });
});

describe('logHelplineCall', () => {
  beforeEach(clearFirestore);

  async function seedCall(id: string, uid: string) {
    await db().doc(`helplineCalls/${id}`).set({
      uid,
      role: 'passenger',
      status: 'live',
      ticketId: null,
      context: { displayName: 'Sara', role: 'passenger', activeTripId: 'trip-9' },
      startedAt: new Date(),
    });
  }

  it('refuses a call that is not yours', async () => {
    await seedCall('c0', 'hl-owner');
    await expect(
      logHelplineCall.run(makeReq({ callId: 'c0', transcript: [], ended: true }, 'hl-someone-else')),
    ).rejects.toThrow(/not your call/);
  });

  it('turns a hand-over into a desk ticket with the transcript as a labelled note', async () => {
    await seedCall('c1', 'hl-caller');
    const res = await logHelplineCall.run(
      makeReq(
        {
          callId: 'c1',
          transcript: [
            { who: 'caller' as const, text: 'Driver ne 500 extra liye' },
            { who: 'agent' as const, text: 'Main yeh team ko de rahi hoon.' },
          ],
          handover: { category: 'payment', summary: 'Rider says the driver charged PKR 500 extra.' },
          ended: false,
        },
        'hl-caller',
      ),
    );
    expect(res).toMatchObject({ ok: true, ticketId: 'c1' });
    expect(res.message).toContain('Help & complaints');

    const ticket = (await db().doc('supportTickets/c1').get()).data()!;
    expect(ticket).toMatchObject({
      userId: 'hl-caller',
      category: 'payment',
      status: 'waiting_human',
      channel: 'phone',
      tripId: 'trip-9',
    });
    const msgs = await db().collection('supportTickets/c1/messages').get();
    expect(msgs.size).toBe(1);
    // Never stored as the AI speaking: the lines came from the phone.
    expect(msgs.docs[0].get('sender')).toBe('system');
    expect(msgs.docs[0].get('text')).toContain('Caller: Driver ne 500 extra liye');
  });

  it('opens a ticket when the caller asked for a person, even if the model never handed over', async () => {
    await seedCall('c2', 'hl-asker');
    await logHelplineCall.run(
      makeReq(
        {
          callId: 'c2',
          transcript: [{ who: 'caller' as const, text: 'mujhe insaan se baat karao' }],
          ended: true,
        },
        'hl-asker',
      ),
    );
    expect((await db().doc('supportTickets/c2').get()).get('status')).toBe('waiting_human');
    expect((await db().doc('helplineCalls/c2').get()).get('status')).toBe('ended');
  });

  it('keeps a solved call off the desk', async () => {
    await seedCall('c3', 'hl-happy');
    const res = await logHelplineCall.run(
      makeReq(
        {
          callId: 'c3',
          transcript: [{ who: 'caller' as const, text: 'Shukriya, samajh aa gaya' }],
          ended: true,
        },
        'hl-happy',
      ),
    );
    expect(res.ticketId).toBeNull();
    expect((await db().doc('supportTickets/c3').get()).exists).toBe(false);
  });
});
