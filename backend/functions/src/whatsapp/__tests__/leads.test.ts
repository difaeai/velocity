import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { handleLeadMessage, leadTurn, readLeadInbound, replyPayload, type LeadInbound } from '../leads';

const pin: LeadInbound = { kind: 'location', pin: { lat: 33.68, lng: 73.0, name: null, address: null } };
const text = (t: string): LeadInbound => ({ kind: 'text', text: t });

describe('leadTurn', () => {
  it('walks pickup → office → timings → thanks', () => {
    const start = leadTurn(null, text('Hi Velocity'));
    expect(start?.replies).toEqual(['welcome', 'askPickup']);
    expect(start?.step).toBe('pickup');

    expect(leadTurn('pickup', pin)).toMatchObject({ step: 'dropoff', replies: ['askDropoff'] });
    expect(leadTurn('dropoff', pin)).toMatchObject({ step: 'timings', replies: ['askTimings'] });
    expect(leadTurn('timings', text('9am to 5pm'))).toMatchObject({
      step: 'done',
      answers: { timings: '9am to 5pm' },
      replies: ['thanks'],
    });
  });

  it('keeps asking for a pin when they type an area instead', () => {
    expect(leadTurn('pickup', text('G10'))).toMatchObject({ step: 'pickup', answers: {}, replies: ['pickupPinOnly'] });
    expect(leadTurn('dropoff', text('Blue Area'))).toMatchObject({ step: 'dropoff', replies: ['dropoffPinOnly'] });
    expect(leadTurn('pickup', { kind: 'other' })?.replies).toEqual(['pickupPinOnly']);
  });

  it('wants a time, not a word, for office timings', () => {
    expect(leadTurn('timings', text('morning'))).toMatchObject({ step: 'timings', replies: ['timingsAgain'] });
    expect(leadTurn('timings', pin)?.replies).toEqual(['timingsAgain']);
  });

  it('starts over on the QR words, clearing the old answers', () => {
    expect(leadTurn('done', text('hi velocity'))).toMatchObject({
      step: 'pickup',
      answers: { pickup: null, dropoff: null, timings: null },
    });
  });

  it('stays quiet once done, but keeps what they said', () => {
    expect(leadTurn('done', text('thanks!'))).toEqual({ step: 'done', answers: {}, extra: 'thanks!', replies: [] });
    expect(leadTurn('done', pin)).toBeNull();
  });
});

describe('readLeadInbound', () => {
  it('reads a pin with its place name', () => {
    expect(
      readLeadInbound({ type: 'location', location: { latitude: 33.7, longitude: 73.05, name: 'NUST', address: 'H-12' } }),
    ).toEqual({ kind: 'location', pin: { lat: 33.7, lng: 73.05, name: 'NUST', address: 'H-12' } });
  });

  it('refuses a (0,0) or out-of-range pin', () => {
    expect(readLeadInbound({ type: 'location', location: { latitude: 0, longitude: 0 } }).kind).toBe('other');
    expect(readLeadInbound({ type: 'location', location: { latitude: 120, longitude: 73 } }).kind).toBe('other');
  });

  it('trims and caps text, and treats media as other', () => {
    expect(readLeadInbound({ type: 'text', text: { body: '  G10  ' } })).toEqual({ kind: 'text', text: 'G10' });
    expect((readLeadInbound({ type: 'text', text: { body: 'x'.repeat(999) } }) as { text: string }).text).toHaveLength(300);
    expect(readLeadInbound({ type: 'image' }).kind).toBe('other');
  });
});

describe('replyPayload', () => {
  it('puts the Send location button on the pin questions', () => {
    expect(replyPayload('923001234567', 'askPickup')).toMatchObject({
      to: '923001234567',
      type: 'interactive',
      interactive: { type: 'location_request_message', action: { name: 'send_location' } },
    });
  });

  it('sends both store links in the welcome and the thanks', () => {
    for (const r of ['welcome', 'thanks'] as const) {
      const body = (replyPayload('923001234567', r) as { text: { body: string } }).text.body;
      expect(body).toContain('play.google.com/store/apps/details?id=com.velocityridzpk.app');
      expect(body).toContain('apps.apple.com/pk/app/velocity-rides/id6810774199');
    }
    expect((replyPayload('1', 'welcome') as { text: { body: string } }).text.body).toContain('official WhatsApp');
  });
});

describe('handleLeadMessage (emulator)', () => {
  const NUM = '923001112233';
  let sent: Record<string, unknown>[] = [];

  beforeEach(async () => {
    await clearFirestore();
    sent = [];
    vi.stubEnv('WHATSAPP_TOKEN', 't');
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'p');
    vi.stubEnv('WHATSAPP_TEMPLATE_NAME', 'x');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.out' }] }) };
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('welcomes a QR scan, saves the pickup pin, and ignores a redelivered message', async () => {
    await handleLeadMessage({ id: 'm1', from: NUM, type: 'text', text: { body: 'Hi Velocity' } }, 'Ayesha');
    expect(sent.map((p) => p.type)).toEqual(['text', 'interactive']);

    const pinMsg = { id: 'm2', from: NUM, type: 'location', location: { latitude: 33.68, longitude: 73.05 } };
    await handleLeadMessage(pinMsg, 'Ayesha');
    await handleLeadMessage(pinMsg, 'Ayesha'); // Meta retrying the same delivery
    expect(sent).toHaveLength(3);

    const doc = (await db().doc(`whatsappLeads/${NUM}`).get()).data();
    expect(doc).toMatchObject({ step: 'dropoff', phone: `+${NUM}`, name: 'Ayesha', pickup: { lat: 33.68, lng: 73.05 } });
  });

  it('leaves a driver replying to an alert alone', async () => {
    await db().doc('drivers/d1').set({ whatsappAlerts: { number: NUM } });
    await handleLeadMessage({ id: 'm1', from: NUM, type: 'text', text: { body: 'ok' } }, null);
    expect(sent).toHaveLength(0);
    expect((await db().doc(`whatsappLeads/${NUM}`).get()).exists).toBe(false);
  });
});
