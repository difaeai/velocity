/**
 * The email agent's pure parts: which messages in the owner's inbox it opens
 * at all, how a pasted customer list is read, and what stops a customer email.
 */
import { describe, expect, it } from 'vitest';

import { parseCustomers } from '../index';
import { fromPerson } from '../inbox';
import { customerEmailProblems } from '../write';

describe('fromPerson — only mail a person wrote is opened', () => {
  const own = ['owner@bloom.pk', 'sales@bloom.pk'];

  it('takes a plain email from a customer', () => {
    expect(fromPerson({ from: 'Sana@Gmail.com', own, headers: 'Subject: order\r\n' })).toBe(true);
  });

  it('skips our own address, no-reply and system senders', () => {
    for (const from of ['owner@bloom.pk', 'noreply@shop.com', 'no-reply@x.io', 'do-not-reply@bank.pk', 'mailer-daemon@googlemail.com', 'notifications@github.com', 'news+promo@brand.com']) {
      expect(fromPerson({ from, own, headers: '' })).toBe(false);
    }
  });

  it('keeps a person whose name merely starts like a system word', () => {
    expect(fromPerson({ from: 'newsha@gmail.com', own, headers: '' })).toBe(true);
    expect(fromPerson({ from: 'alertsmith@co.uk', own, headers: '' })).toBe(true);
  });

  it('skips bulk mail by its headers', () => {
    expect(fromPerson({ from: 'hello@brand.com', own, headers: 'List-Unsubscribe: <mailto:u@brand.com>\r\n' })).toBe(false);
    expect(fromPerson({ from: 'hello@brand.com', own, headers: 'List-ID: <deals.brand.com>\r\n' })).toBe(false);
    expect(fromPerson({ from: 'hello@brand.com', own, headers: 'Precedence: bulk\r\n' })).toBe(false);
    expect(fromPerson({ from: 'hello@brand.com', own, headers: 'Auto-Submitted: auto-replied\r\n' })).toBe(false);
    expect(fromPerson({ from: 'hello@brand.com', own, headers: 'Auto-Submitted: no\r\n' })).toBe(true);
  });

  it('skips what is not an address', () => {
    expect(fromPerson({ from: 'undisclosed-recipients', own, headers: '' })).toBe(false);
  });
});

describe('parseCustomers — a pasted list', () => {
  it('reads name, email, note in either order and drops lines without an address', () => {
    expect(
      parseCustomers('Sana Khan, sana@gmail.com, bought 2 cakes in March\nali@bloom.pk\tAli\nno address here\n\nAyesha; AYESHA@yahoo.com'),
    ).toEqual([
      { email: 'sana@gmail.com', name: 'Sana Khan', note: 'bought 2 cakes in March' },
      { email: 'ali@bloom.pk', name: 'Ali', note: '' },
      { email: 'ayesha@yahoo.com', name: 'Ayesha', note: '' },
    ]);
  });

  it('keeps one row per address', () => {
    expect(parseCustomers('A, a@x.pk\nB, A@X.pk')).toHaveLength(1);
  });
});

describe('customerEmailProblems', () => {
  const good = {
    subject: 'Eid hours this week',
    body: 'Hi Sana, thank you for the two cakes in March. This week we stay open until midnight for Eid, and every order over Rs 3,000 gets free delivery in Lahore. Would you like us to keep a slot for you on Friday? Order here: https://bloom.pk/eid',
  };

  it('passes a personal email with a link', () => {
    expect(customerEmailProblems(good)).toEqual([]);
  });

  it('catches placeholders, banned lines and an empty subject', () => {
    expect(customerEmailProblems({ subject: '', body: `Hi [name], ${good.body} I hope this finds you well.` })).toEqual([
      'no subject',
      'an unfilled placeholder',
      '"i hope this finds you well"',
    ]);
  });

  it('catches one too short to say anything', () => {
    expect(customerEmailProblems({ subject: 'Eid', body: 'Open late this week.' })).toEqual(['too short to say anything']);
  });
});
