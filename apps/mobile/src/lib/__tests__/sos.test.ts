/**
 * The SOS rules, pinned.
 *
 * Two of these are load-bearing in a way that is easy to miss. A WhatsApp deep
 * link built from a number in the wrong shape opens an error page instead of a
 * chat, so `toWhatsAppNumber` failing silently means the SOS reaches nobody at
 * the one moment it matters. And the SMS fallback's recipient separator differs
 * between iOS and Android: get it wrong and five messages become one message to
 * one impossible number.
 */
import { describe, it, expect } from 'vitest';

import {
  MAX_EMERGENCY_CONTACTS,
  buildSosMessage,
  contactIntroMessage,
  formatPhone,
  mapsUrl,
  pktStamp,
  prepareContact,
  smsAllUrl,
  toWhatsAppNumber,
  whatsAppChatUrls,
  type EmergencyContact,
} from '../sos';

const contact = (over: Partial<EmergencyContact> = {}): EmergencyContact => ({
  id: 'c1',
  name: 'Ammi',
  phone: '923001234567',
  whatsappCheckedAt: null,
  ...over,
});

describe('toWhatsAppNumber', () => {
  it('accepts every way a Pakistani writes their own number', () => {
    for (const written of [
      '03001234567',
      '0300 1234567',
      '0300-123-4567',
      '+923001234567',
      '+92 300 1234567',
      '0092 300 1234567',
      '3001234567',
      '92 0300 1234567',
    ]) {
      expect(toWhatsAppNumber(written), written).toBe('923001234567');
    }
  });

  it('keeps a foreign number the user wrote in full', () => {
    expect(toWhatsAppNumber('+44 7700 900123')).toBe('447700900123');
    expect(toWhatsAppNumber('+1 202 555 0143')).toBe('12025550143');
  });

  it('normalises a Pakistani landline', () => {
    expect(toWhatsAppNumber('042 35712345')).toBe('924235712345');
  });

  it('rejects what cannot be a phone number', () => {
    for (const junk of ['', '   ', 'abcd', '12345', '0000000000', '+9230012345678901234']) {
      expect(toWhatsAppNumber(junk), junk).toBeNull();
    }
  });
});

describe('formatPhone', () => {
  it('spaces a Pakistani mobile the way people read it', () => {
    expect(formatPhone('923001234567')).toBe('+92 300 1234567');
  });

  it('leaves anything else as plain international', () => {
    expect(formatPhone('447700900123')).toBe('+447700900123');
  });
});

describe('prepareContact', () => {
  it('normalises the number it stores', () => {
    const res = prepareContact({ existing: [], name: '  Ammi  jee ', phone: '0300 1234567' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.contact.phone).toBe('923001234567');
    expect(res.contact.name).toBe('Ammi jee');
    expect(res.contact.whatsappCheckedAt).toBeNull();
  });

  it('refuses a sixth contact', () => {
    const existing = Array.from({ length: MAX_EMERGENCY_CONTACTS }, (_, i) =>
      contact({ id: `c${i}`, phone: `92300123456${i}` }),
    );
    const res = prepareContact({ existing, name: 'Bhai', phone: '03211111111' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('full');
  });

  it('refuses the same number twice, however it was written', () => {
    const res = prepareContact({
      existing: [contact()],
      name: 'Ammi again',
      phone: '+92 300 1234567',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('duplicate');
    expect(res.message).toContain('Ammi');
  });

  it('refuses the user’s own number — an SOS to yourself reaches nobody', () => {
    const res = prepareContact({
      existing: [],
      name: 'Me',
      phone: '03009999999',
      ownPhone: '+923009999999',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('self');
  });

  it('refuses a nameless row', () => {
    const res = prepareContact({ existing: [], name: 'A', phone: '03001234567' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('name');
  });

  it('editing keeps the WhatsApp check on a rename and drops it on a new number', () => {
    const existing = [contact({ whatsappCheckedAt: 1_700_000_000_000 })];

    const renamed = prepareContact({
      existing,
      id: 'c1',
      name: 'Ammi (home)',
      phone: '03001234567',
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.contact.whatsappCheckedAt).toBe(1_700_000_000_000);

    const renumbered = prepareContact({
      existing,
      id: 'c1',
      name: 'Ammi',
      phone: '03217654321',
    });
    expect(renumbered.ok).toBe(true);
    if (!renumbered.ok) return;
    expect(renumbered.contact.whatsappCheckedAt).toBeNull();
  });

  it('an edit at the limit is not "full" — it replaces a row rather than adding one', () => {
    const existing = Array.from({ length: MAX_EMERGENCY_CONTACTS }, (_, i) =>
      contact({ id: `c${i}`, phone: `92300123456${i}` }),
    );
    const res = prepareContact({ existing, id: 'c2', name: 'Baba', phone: '03331112222' });
    expect(res.ok).toBe(true);
  });
});

describe('pktStamp', () => {
  it('reads in Pakistan time whatever the device clock is set to', () => {
    // 16:42 UTC is 21:42 in Karachi, same day.
    expect(pktStamp(new Date('2026-10-16T16:42:00Z'))).toBe('16 Oct 2026, 21:42 PKT');
    // 20:30 UTC has already rolled into the next day there.
    expect(pktStamp(new Date('2026-10-16T20:30:00Z'))).toBe('17 Oct 2026, 01:30 PKT');
  });
});

describe('buildSosMessage', () => {
  const when = new Date('2026-10-16T16:42:00Z');

  it('carries the location, the driver and the plate in plain text', () => {
    const msg = buildSosMessage({
      sender: { name: 'Ayesha Khan', phone: '03001234567' },
      when,
      location: { lat: 31.5204, lng: 74.3587, address: 'Gulberg III, Lahore' },
      watchUrl: 'https://velocityrides.app/watch/tok123',
      trip: {
        id: 'trip789',
        status: 'in_progress',
        pickup: 'DHA Phase 5',
        dropoff: 'Allama Iqbal Airport',
        driverName: 'Usman Khan',
        driverPhone: '03117654321',
        vehicle: 'White Toyota Corolla',
        plate: 'LEA-1234',
      },
    });

    expect(msg).toContain('Ayesha Khan');
    expect(msg).toContain('+92 300 1234567');
    expect(msg).toContain('https://maps.google.com/?q=31.520400,74.358700');
    expect(msg).toContain('Gulberg III, Lahore');
    expect(msg).toContain('https://velocityrides.app/watch/tok123');
    expect(msg).toContain('Usman Khan');
    expect(msg).toContain('+92 311 7654321');
    expect(msg).toContain('LEA-1234');
    expect(msg).toContain('Trip ID: trip789');
    expect(msg).toContain('ride in progress');
    expect(msg).toContain('16 Oct 2026, 21:42 PKT');
    // The last line is the one a relative acts on when nobody answers.
    expect(msg.trimEnd().endsWith('call the police on 15 and read them this message.')).toBe(true);
  });

  it('says so out loud when there is no location, rather than going quiet', () => {
    const msg = buildSosMessage({ sender: {}, when, location: null, trip: null });
    expect(msg).toContain('could not get a location fix');
    expect(msg).not.toContain('My driver');
    expect(msg).toContain('15');
  });

  it('off a ride, it is still a complete message', () => {
    const msg = buildSosMessage({
      sender: { name: 'Ali' },
      when,
      location: { lat: 24.8607, lng: 67.0011 },
      trip: null,
    });
    expect(msg).toContain('This is Ali.');
    expect(msg).toContain('maps.google.com');
    expect(msg).not.toContain('Trip ID');
  });
});

describe('deep links', () => {
  it('builds a WhatsApp chat link both ways, with the text pre-filled', () => {
    const { app, web } = whatsAppChatUrls('923001234567', 'help me');
    expect(app).toBe('whatsapp://send?phone=923001234567&text=help%20me');
    expect(web).toBe('https://wa.me/923001234567?text=help%20me');
  });

  it('escapes the newlines and emoji an SOS message is full of', () => {
    const { web } = whatsAppChatUrls('923001234567', 'line one\nline two');
    expect(web).toContain('line%20one%0Aline%20two');
  });

  it('separates SMS recipients the way each platform expects', () => {
    const phones = ['923001234567', '923217654321'];
    expect(smsAllUrl(phones, 'hi', 'ios')).toBe('sms:+923001234567,+923217654321&body=hi');
    expect(smsAllUrl(phones, 'hi', 'android')).toBe('smsto:+923001234567;+923217654321?body=hi');
  });

  it('pins the map link format', () => {
    expect(mapsUrl(31.5, 74.35)).toBe('https://maps.google.com/?q=31.500000,74.350000');
  });
});

describe('contactIntroMessage', () => {
  it('warns the contact before the 2am panic, and names the sender', () => {
    expect(contactIntroMessage('Ayesha')).toContain("it's Ayesha");
    expect(contactIntroMessage('Ayesha')).toContain('SOS');
    expect(contactIntroMessage(null)).not.toContain('null');
  });
});
