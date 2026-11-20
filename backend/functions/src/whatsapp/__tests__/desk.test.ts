/**
 * The admin desk's ear: what an owner standing at a petrol pump types, and what
 * the number is supposed to do about it.
 *
 * These are the real phrasings, in the mix of Roman Urdu and English they
 * actually arrive in. The parser is pure, so every one of them is a test rather
 * than a WhatsApp round trip — and the two mistakes that would cost real money
 * are both covered: reading a stray sentence as a broadcast, and reading a
 * landline or a distance as somebody's mobile.
 */
import { describe, expect, it } from 'vitest';

import { findPhone, normaliseArea, readDeskCommand } from '../desk';

describe('readDeskCommand — adding a driver', () => {
  it.each([
    '03441563032 isko drivers main add kro',
    '0344 1563032 ko drivers mein add karo',
    '+92 344 1563032 add karo',
    '92-344-1563032 driver banao',
    '03441563032',
  ])('reads "%s" as an add', (text) => {
    expect(readDeskCommand(text)).toEqual({ kind: 'add', phone: '923441563032' });
  });

  it.each([
    '03441563032 hatao',
    'band karo 03441563032',
    '03441563032 ko remove kar do',
    '03441563032 block',
  ])('reads "%s" as a removal', (text) => {
    expect(readDeskCommand(text)).toEqual({ kind: 'remove', phone: '923441563032' });
  });
});

describe('readDeskCommand — area broadcast', () => {
  it.each([
    ['area f7 main sary drivers ko message bhaijo k wahan demand hai', 'F-7'],
    ['G-10 mein demand hai drivers ko batao', 'G-10'],
    ['alert F-7 ko bhejo', 'F-7'],
    ['sector i8/3 mein demand bhejo', 'I-8/3'],
    ['blue area main demand bhejo', 'Blue Area'],
    ['saddar ke drivers ko demand ka message bhejo', 'Saddar'],
    // A sector on its own is unambiguous enough to act on.
    ['F-7', 'F-7'],
    ['g10', 'G-10'],
  ])('reads "%s" as a broadcast to %s', (text, area) => {
    expect(readDeskCommand(text)).toEqual({ kind: 'area', area });
  });

  it('does not turn thinking out loud into a broadcast', () => {
    // No place and no instruction — the cost of guessing here is a paid message
    // to every driver in a sector.
    expect(readDeskCommand('hello').kind).toBe('help');
    expect(readDeskCommand('thanks bhai').kind).toBe('help');
    expect(readDeskCommand('kal baat karte hain').kind).toBe('help');
  });
});

describe('readDeskCommand — the switches', () => {
  it.each(['alerts on', 'alert chalu', 'alerts start'])('turns alerts on with "%s"', (text) => {
    expect(readDeskCommand(text)).toEqual({ kind: 'alerts', on: true });
  });

  it.each(['alerts off', 'alerts band', 'alert bandh'])('turns alerts off with "%s"', (text) => {
    expect(readDeskCommand(text)).toEqual({ kind: 'alerts', on: false });
  });

  it.each(['status', 'kitne drivers hain', 'report'])('asks for status with "%s"', (text) => {
    expect(readDeskCommand(text)).toEqual({ kind: 'status' });
  });

  it('is empty-safe', () => {
    expect(readDeskCommand('   ').kind).toBe('help');
  });
});

describe('findPhone', () => {
  it('finds a mobile however it was pasted', () => {
    expect(findPhone('add 0300-123 4567 please')).toBe('923001234567');
  });

  it('is not fooled by numbers that are not mobiles', () => {
    // A landline has no WhatsApp, and messaging one is an undeliverable —
    // which is a spam signal, not a harmless miss.
    expect(findPhone('0511234567 ko add karo')).toBeNull();
    expect(findPhone('20 km radius rakho')).toBeNull();
    expect(findPhone('F-7 mein demand hai')).toBeNull();
  });
});

describe('normaliseArea', () => {
  it.each([
    ['f7', 'F-7'],
    ['f 7', 'F-7'],
    ['F-11/4', 'F-11/4'],
    ['i8 / 3', 'I-8/3'],
    ['blue area', 'Blue Area'],
    ['bahria town', 'Bahria Town'],
  ])('writes %s as %s', (raw, written) => {
    expect(normaliseArea(raw)).toBe(written);
  });
});
