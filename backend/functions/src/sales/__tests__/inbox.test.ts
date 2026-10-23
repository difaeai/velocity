/**
 * The close: which reply belongs to which lead, what they actually wrote, and
 * when a follow-up is allowed — the rules that keep the agent from writing to
 * someone who already answered.
 */
import { describe, expect, it } from 'vitest';

import { followUpDue, freshText, imapHostFor, matchLead, textPart, type LeadRef } from '../inbox';
import { textOf } from '../site';
import { emailProblems } from '../write';

describe('imapHostFor', () => {
  it('pairs the mailboxes people actually use', () => {
    expect(imapHostFor('smtp.gmail.com')).toBe('imap.gmail.com');
    expect(imapHostFor('smtp.office365.com')).toBe('outlook.office365.com');
    expect(imapHostFor('smtp-mail.outlook.com')).toBe('outlook.office365.com');
    expect(imapHostFor('smtp.zoho.com')).toBe('imap.zoho.com');
    expect(imapHostFor('mail.bakehouse.pk')).toBe('mail.bakehouse.pk');
  });
});

describe('freshText', () => {
  it('keeps what they wrote and drops the thread quoted under it', () => {
    const gmail = 'Yes, send me the prices.\nThanks\n\nOn Tue, 21 Oct 2026 at 10:02, Sana <sana@bloom.pk>\nwrote:\n> Saw that you bake at 5am';
    expect(freshText(gmail)).toBe('Yes, send me the prices.\nThanks');
    const outlook = 'Call me on Monday.\r\n\r\nFrom: Sana <sana@bloom.pk>\r\nSent: Tuesday\r\nSubject: your 5am bake';
    expect(freshText(outlook)).toBe('Call me on Monday.');
  });

  it('does not cut a reply that merely mentions who it is from', () => {
    expect(freshText('From: the head office, yes we are interested.')).toBe('From: the head office, yes we are interested.');
  });
});

describe('textPart', () => {
  it('prefers plain text, and falls back to HTML', () => {
    const alt = { type: 'multipart/alternative', childNodes: [{ part: '1', type: 'text/plain' }, { part: '2', type: 'text/html' }] };
    expect(textPart(alt)).toEqual({ part: '1', html: false });
    expect(textPart({ type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/html' }] })).toEqual({ part: '1', html: true });
  });

  it('reads a single-part message from part 1 and ignores attachments', () => {
    expect(textPart({ type: 'text/plain' })).toEqual({ part: '1', html: false });
    expect(textPart({ type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain', disposition: 'attachment' }] })).toBeNull();
  });

  it('turns an HTML-only reply into words', () => {
    expect(textOf('<div>Yes&nbsp;please <b>call</b></div><script>x()</script>')).toBe('Yes please call');
  });
});

describe('matchLead', () => {
  const leads: LeadRef[] = [
    { id: 'a', email: 'orders@bakehouse.pk', threadIds: ['<m1@bloom.pk>'] },
    { id: 'b', email: 'owner@gmail.com', threadIds: [] },
  ];

  it('matches by the thread first, then the address, then the company domain', () => {
    expect(matchLead({ from: 'someone@else.com', inReplyTo: '<m1@bloom.pk>' }, leads)?.id).toBe('a');
    expect(matchLead({ from: 'OWNER@gmail.com', inReplyTo: '' }, leads)?.id).toBe('b');
    expect(matchLead({ from: 'manager@bakehouse.pk', inReplyTo: '' }, leads)?.id).toBe('a');
  });

  it('never matches a stranger on a free-mail domain', () => {
    expect(matchLead({ from: 'stranger@gmail.com', inReplyTo: '' }, leads)).toBeNull();
  });
});

describe('followUpDue', () => {
  const day = 86_400_000;
  const t0 = Date.UTC(2026, 9, 1);
  const sent = { status: 'sent', messageId: '<m1@bloom.pk>', followUps: 0, lastSentAtMs: t0 };

  it('waits three days for the first and four more for the second, and never sends a third', () => {
    expect(followUpDue(sent, t0 + 2 * day)).toBeNull();
    expect(followUpDue(sent, t0 + 3 * day)).toBe(1);
    const once = { ...sent, followUps: 1, lastSentAtMs: t0 + 3 * day };
    expect(followUpDue(once, t0 + 6 * day)).toBeNull();
    expect(followUpDue(once, t0 + 7 * day)).toBe(2);
    expect(followUpDue({ ...sent, followUps: 2 }, t0 + 30 * day)).toBeNull();
  });

  it('never follows up a lead that answered, or an email we did not send ourselves', () => {
    expect(followUpDue({ ...sent, status: 'replied' }, t0 + 30 * day)).toBeNull();
    expect(followUpDue({ ...sent, messageId: null }, t0 + 30 * day)).toBeNull();
  });
});

describe('emailProblems for a follow-up', () => {
  it('holds a follow-up to its own, shorter limits', () => {
    const short = { subject: 'Re: your 5am bake', body: 'Would a sample reel of the morning bake help this week?' };
    expect(emailProblems(short)).toContain('too short to say anything');
    expect(emailProblems(short, { min: 10, max: 60, target: 50 })).toEqual([]);
    expect(emailProblems({ ...short, body: `${short.body} Just checking in.` }, { min: 10, max: 60, target: 50 })).toContain(
      '"just checking in"',
    );
  });
});
