/**
 * The phone helpline: the agent is told who is calling, the Gemini key never
 * leaves the server, the agent fixes what the ride record proves instead of
 * passing the caller on, and every call lands on the desk on the caller's side.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import {
  HELPLINE_MODEL,
  HELPLINE_VOICE,
  helplineInstruction,
  helplineSetup,
  logHelplineCall,
  startHelplineCall,
} from '../helpline';
import { helplineAction } from '../helplineActions';

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

  it('solves on the call and never transfers it, with or without the tools', () => {
    for (const canAct of [true, false]) {
      const text = helplineInstruction('driver', 'BRIEF', 'facts', canAct);
      expect(text).toContain('not a switchboard');
      expect(text).toContain('Never say you are transferring');
    }
    expect(helplineInstruction('driver', 'BRIEF', 'facts', true)).toContain('end_stuck_ride');
    expect(helplineInstruction('driver', 'BRIEF', 'facts', false)).not.toContain('end_stuck_ride');
  });
});

describe('helplineSetup', () => {
  it('locks the model, the voice, the tools and patient turn-taking into the session', () => {
    const setup = helplineSetup('instructions');
    expect(setup.model).toBe(`models/${HELPLINE_MODEL}`);
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(HELPLINE_VOICE);
    expect(setup.tools[0].functionDeclarations.map((f) => f.name)).toEqual([
      'end_stuck_ride',
      'waive_cancellation_fee',
      'report_lost_item',
      'register_complaint',
    ]);
    expect(setup.realtimeInputConfig.automaticActivityDetection.endOfSpeechSensitivity).toBe('END_SENSITIVITY_LOW');
    expect(setup.systemInstruction.parts[0].text).toBe('instructions');
  });

  it('gives an app that cannot run the tools its one hand-over tool', () => {
    expect(helplineSetup('i', false).tools[0].functionDeclarations.map((f) => f.name)).toEqual(['hand_to_human']);
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

    const res = await startHelplineCall.run(makeReq({ actions: true }, 'hl-driver'));
    expect(res).toMatchObject({ available: true, token: 'auth_tokens/abc123', role: 'driver' });
    expect(JSON.stringify(res)).not.toContain('secret-key');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/v1beta/auth_tokens');
    const body = JSON.parse(String(init.body));
    expect(body.uses).toBe(1);
    expect(body.bidiGenerateContentSetup.systemInstruction.parts[0].text).toContain('This caller is a DRIVER');
    expect(body.bidiGenerateContentSetup.tools[0].functionDeclarations[0].name).toBe('end_stuck_ride');
    // No field mask: every field is locked, so the phone cannot rewrite the brief.
    expect(body.fieldMask).toBeUndefined();

    const callId = (res as { callId: string }).callId;
    expect((await db().doc(`helplineCalls/${callId}`).get()).data()).toMatchObject({
      uid: 'hl-driver',
      role: 'driver',
      status: 'live',
      canAct: true,
    });
  });
});

/** A call in progress, as startHelplineCall leaves it. */
async function seedCall(id: string, uid: string, role = 'passenger', extra: Record<string, unknown> = {}) {
  await db().doc(`helplineCalls/${id}`).set({
    uid,
    role,
    status: 'live',
    ticketId: null,
    context: { displayName: role === 'driver' ? 'Imran' : 'Sara', role, activeTripId: 'trip-9' },
    startedAt: new Date(),
    expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000),
    ...extra,
  });
}

const ago = (min: number) => Timestamp.fromMillis(Date.now() - min * 60_000);
const ISB = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const RWP = { lat: 33.5651, lng: 73.0169, address: 'Saddar, Rawalpindi' };

async function seedTrip(id: string, fields: Record<string, unknown>) {
  await db().doc(`trips/${id}`).set({
    passengerId: 'hl-rider',
    driverId: 'hl-drv',
    pickup: ISB,
    dropoff: RWP,
    fare: 800,
    createdAt: ago(60),
    ...fields,
  });
}

function act(uid: string, callId: string, name: string, args: Record<string, unknown>) {
  return helplineAction.run(makeReq({ callId, name, args }, uid)) as Promise<{
    ok: boolean;
    result: string;
    ticketId: string;
  }>;
}

describe('logHelplineCall', () => {
  beforeEach(clearFirestore);

  it('refuses a call that is not yours', async () => {
    await seedCall('c0', 'hl-owner');
    await expect(
      logHelplineCall.run(makeReq({ callId: 'c0', transcript: [], ended: true }, 'hl-someone-else')),
    ).rejects.toThrow(/not your call/);
  });

  it('registers an older app’s hand-over for the team, then adds the transcript as a labelled note', async () => {
    await seedCall('c1', 'hl-caller');
    const transcript = [
      { who: 'caller' as const, text: 'Driver ne 500 extra liye' },
      { who: 'agent' as const, text: 'Main aap ki complaint register kar rahi hoon.' },
    ];
    const res = await logHelplineCall.run(
      makeReq(
        {
          callId: 'c1',
          transcript,
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
      role: 'passenger',
      category: 'payment',
      status: 'waiting_human',
      channel: 'phone',
      tripId: 'trip-9',
    });

    await logHelplineCall.run(makeReq({ callId: 'c1', transcript, ended: true }, 'hl-caller'));
    const msgs = await db().collection('supportTickets/c1/messages').orderBy('createdAt').get();
    // Never stored as the AI speaking: the lines came from the phone.
    expect(msgs.docs.every((m) => m.get('sender') === 'system')).toBe(true);
    expect(msgs.docs.map((m) => m.get('text')).join('\n')).toContain('Caller: Driver ne 500 extra liye');
    expect((await db().doc('supportTickets/c1').get()).get('status')).toBe('waiting_human');
  });

  it('puts the caller in front of a person when they asked for one, even if the model never registered it', async () => {
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

  it('registers a call the assistant answered as resolved, on the caller’s side of the desk', async () => {
    await seedCall('c3', 'hl-happy', 'driver');
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
    expect(res.ticketId).toBe('c3');
    expect((await db().doc('supportTickets/c3').get()).data()).toMatchObject({
      status: 'resolved',
      resolvedBy: 'ai',
      role: 'driver',
      channel: 'phone',
    });
  });

  it('registers nothing for a call where the caller never spoke', async () => {
    await seedCall('c4', 'hl-silent');
    const res = await logHelplineCall.run(makeReq({ callId: 'c4', transcript: [], ended: true }, 'hl-silent'));
    expect(res.ticketId).toBeNull();
    expect((await db().doc('supportTickets/c4').get()).exists).toBe(false);
  });
});

describe('helplineAction', () => {
  beforeEach(clearFirestore);

  it('only runs on the caller’s own call while it is live', async () => {
    await seedCall('a0', 'hl-rider');
    await expect(act('hl-other', 'a0', 'register_complaint', {})).rejects.toThrow(/not your call/);
    await seedCall('a1', 'hl-rider', 'passenger', { status: 'ended' });
    await expect(act('hl-rider', 'a1', 'register_complaint', {})).rejects.toThrow(/ended/);
    await seedCall('a2', 'hl-rider', 'passenger', { expiresAt: ago(1) });
    await expect(act('hl-rider', 'a2', 'register_complaint', {})).rejects.toThrow(/ended/);
  });

  describe('end_stuck_ride', () => {
    it('releases a passenger whose driver had not arrived half an hour after accepting, with no fee', async () => {
      await seedCall('s1', 'hl-rider');
      await seedTrip('t1', { status: 'arriving', matchedAt: ago(40) });
      await db().doc('users/hl-rider').set({ activeTripId: 't1' });
      await db().doc('drivers/hl-drv').set({ activeTripId: 't1' });

      const res = await act('hl-rider', 's1', 'end_stuck_ride', { ride_id: 't1' });
      expect(res.result).toMatch(/^Done/);

      const trip = (await db().doc('trips/t1').get()).data()!;
      expect(trip).toMatchObject({ status: 'cancelled', cancellationFee: null, cancelledBy: 'helpline' });
      expect((await db().doc('users/hl-rider').get()).get('activeTripId')).toBeNull();
      expect((await db().doc('drivers/hl-drv').get()).get('activeTripId')).toBeNull();

      // On the desk, on the passenger side, with what was done.
      const ticket = (await db().doc('supportTickets/s1').get()).data()!;
      expect(ticket.role).toBe('passenger');
      expect(ticket.aiActions).toEqual([expect.objectContaining({ name: 'end_stuck_ride', done: true })]);
    });

    it('leaves a ride whose driver may still be on the way', async () => {
      await seedCall('s2', 'hl-rider');
      await seedTrip('t2', { status: 'matched', matchedAt: ago(10) });
      const res = await act('hl-rider', 's2', 'end_stuck_ride', { ride_id: 't2' });
      expect(res.result).toMatch(/^Not done/);
      expect((await db().doc('trips/t2').get()).get('status')).toBe('matched');
    });

    it('releases a driver whose passenger never came out, but never a passenger the driver is waiting for', async () => {
      await seedCall('s3', 'hl-drv', 'driver');
      await seedTrip('t3', { status: 'arrived', matchedAt: ago(30), arrivedAt: ago(12) });
      expect((await act('hl-drv', 's3', 'end_stuck_ride', { ride_id: 't3' })).result).toMatch(/^Done/);
      expect((await db().doc('trips/t3').get()).get('status')).toBe('cancelled');

      await seedCall('s4', 'hl-rider');
      await seedTrip('t4', { status: 'arrived', matchedAt: ago(30), arrivedAt: ago(25) });
      expect((await act('hl-rider', 's4', 'end_stuck_ride', { ride_id: 't4' })).result).toMatch(/^Not done/);
    });

    it('closes a city ride still "running" hours later for the passenger, never for the driver who drove it', async () => {
      await seedCall('s5', 'hl-drv', 'driver');
      await seedTrip('t5', { status: 'in_progress', matchedAt: ago(300), startedAt: ago(290) });
      expect((await act('hl-drv', 's5', 'end_stuck_ride', { ride_id: 't5' })).result).toMatch(/^Not done/);

      await seedCall('s6', 'hl-rider');
      expect((await act('hl-rider', 's6', 'end_stuck_ride', { ride_id: 't5' })).result).toMatch(/^Done/);
      expect((await db().doc('trips/t5').get()).get('status')).toBe('cancelled');

      await seedTrip('t6', { status: 'in_progress', matchedAt: ago(40), startedAt: ago(30) });
      expect((await act('hl-rider', 's6', 'end_stuck_ride', { ride_id: 't6' })).result).toMatch(/^Not done/);
    });

    it('will not touch somebody else’s ride', async () => {
      await seedCall('s7', 'hl-stranger');
      await seedTrip('t7', { status: 'requested' });
      expect((await act('hl-stranger', 's7', 'end_stuck_ride', { ride_id: 't7' })).result).toMatch(/^Not done/);
      expect((await db().doc('trips/t7').get()).get('status')).toBe('requested');
    });
  });

  describe('waive_cancellation_fee', () => {
    it('takes off a passenger’s fee when the driver had not arrived 30 minutes after accepting — once', async () => {
      await seedCall('w1', 'hl-rider');
      await seedTrip('f1', {
        status: 'cancelled',
        cancelledBy: 'hl-rider',
        cancelledByRole: 'passenger',
        cancelledFrom: 'arriving',
        matchedAt: ago(50),
        cancelledAt: ago(5),
        cancellationFee: { amount: 40, role: 'passenger', paidFromWallet: 0, paidFromCredit: 0, outstanding: 40 },
      });
      await db().doc('wallets/hl-rider').set({ balance: 0, outstanding: 340 });

      const res = await act('hl-rider', 'w1', 'waive_cancellation_fee', { ride_id: 'f1' });
      expect(res.result).toMatch(/^Done/);
      expect((await db().doc('wallets/hl-rider').get()).get('outstanding')).toBe(300);
      expect((await db().doc('trips/f1').get()).get('cancellationFee')).toMatchObject({
        amount: 40,
        waivedBy: 'helpline',
      });
      const ledger = await db().collection('platformLedger').where('tripId', '==', 'f1').get();
      expect(ledger.docs.map((d) => d.get('type'))).toEqual(['cancellation_fee_waived']);

      expect((await act('hl-rider', 'w1', 'waive_cancellation_fee', { ride_id: 'f1' })).result).toMatch(/already taken off/);
      expect((await db().doc('wallets/hl-rider').get()).get('outstanding')).toBe(300);
    });

    it('keeps a fee the record says the caller caused', async () => {
      await seedCall('w2', 'hl-rider');
      await seedTrip('f2', {
        status: 'cancelled',
        cancelledBy: 'hl-rider',
        cancelledByRole: 'passenger',
        cancelledFrom: 'matched',
        matchedAt: ago(12),
        cancelledAt: ago(7),
        cancellationFee: { amount: 40, role: 'passenger', paidFromWallet: 0, paidFromCredit: 0, outstanding: 40 },
      });
      await db().doc('wallets/hl-rider').set({ balance: 0, outstanding: 40 });

      const res = await act('hl-rider', 'w2', 'waive_cancellation_fee', { ride_id: 'f2' });
      expect(res.result).toMatch(/^Not done/);
      expect(res.result).toContain('needs_team');
      expect((await db().doc('wallets/hl-rider').get()).get('outstanding')).toBe(40);
    });

    it('gives a driver back the bonus a no-show fee took', async () => {
      await seedCall('w3', 'hl-drv', 'driver');
      await seedTrip('f3', {
        status: 'cancelled',
        cancelledBy: 'hl-drv',
        cancelledByRole: 'driver',
        cancelledFrom: 'arrived',
        matchedAt: ago(40),
        arrivedAt: ago(30),
        cancelledAt: ago(15),
        cancellationFee: { amount: 64, role: 'driver', paidFromWallet: 0, paidFromCredit: 64, outstanding: 0 },
      });
      await db().doc('drivers/hl-drv').set({ commissionCredit: 100, commissionCreditUsed: 64 });

      expect((await act('hl-drv', 'w3', 'waive_cancellation_fee', { ride_id: 'f3' })).result).toMatch(/^Done/);
      const driver = (await db().doc('drivers/hl-drv').get()).data()!;
      expect(driver).toMatchObject({ commissionCredit: 164, commissionCreditUsed: 0 });
      const rows = await db().collection('drivers/hl-drv/commissionCredits').get();
      expect(rows.docs[0].data()).toMatchObject({ type: 'admin_grant', amount: 64, ref: 'f3' });
    });

    it('never touches a fee charged to the other person', async () => {
      await seedCall('w4', 'hl-rider');
      await seedTrip('f4', {
        status: 'cancelled',
        cancelledBy: 'hl-drv',
        cancelledByRole: 'driver',
        cancelledFrom: 'arrived',
        arrivedAt: ago(30),
        cancelledAt: ago(15),
        cancellationFee: { amount: 64, role: 'driver', paidFromWallet: 0, paidFromCredit: 0, outstanding: 64 },
      });
      expect((await act('hl-rider', 'w4', 'waive_cancellation_fee', { ride_id: 'f4' })).result).toMatch(/other person/);
    });
  });

  describe('report_lost_item', () => {
    it('messages the driver in the ride chat, once a day per ride', async () => {
      await seedCall('l1', 'hl-rider');
      await seedTrip('r1', { status: 'completed' });

      expect((await act('hl-rider', 'l1', 'report_lost_item', { ride_id: 'r1', item: 'a black backpack' })).result).toMatch(/^Done/);
      const chat = await db().collection('trips/r1/chat').get();
      expect(chat.size).toBe(1);
      expect(chat.docs[0].data()).toMatchObject({ senderId: 'hl-rider', senderName: 'Sara' });
      expect(chat.docs[0].get('text')).toContain('a black backpack');

      expect((await act('hl-rider', 'l1', 'report_lost_item', { ride_id: 'r1', item: 'a phone' })).result).toMatch(/already/);
      expect((await db().collection('trips/r1/chat').get()).size).toBe(1);
    });

    it('only for a ride the caller took as a passenger', async () => {
      await seedCall('l2', 'hl-drv', 'driver');
      await seedTrip('r2', { status: 'completed' });
      expect((await act('hl-drv', 'l2', 'report_lost_item', { ride_id: 'r2', item: 'keys' })).result).toMatch(/^Not done/);
    });
  });

  describe('register_complaint', () => {
    it('files a driver’s complaint on the driver side, waiting for the team', async () => {
      await seedCall('k1', 'hl-drv', 'driver');
      await seedTrip('rk', { status: 'completed' });
      const res = await act('hl-drv', 'k1', 'register_complaint', {
        category: 'passenger_issue',
        summary: 'Passenger was abusive on the ride.',
        outcome: 'needs_team',
        ride_id: 'rk',
      });
      expect(res.result).toContain('Help & complaints');
      expect((await db().doc('supportTickets/k1').get()).data()).toMatchObject({
        role: 'driver',
        category: 'passenger_issue',
        status: 'waiting_human',
        tripId: 'rk',
        channel: 'phone',
      });
    });

    it('never lets the model close a safety report itself', async () => {
      await seedCall('k2', 'hl-rider');
      await act('hl-rider', 'k2', 'register_complaint', {
        category: 'safety',
        summary: 'Driver threatened the passenger.',
        outcome: 'resolved',
      });
      expect((await db().doc('supportTickets/k2').get()).data()).toMatchObject({
        status: 'waiting_human',
        priority: 'urgent',
      });
    });
  });
});
