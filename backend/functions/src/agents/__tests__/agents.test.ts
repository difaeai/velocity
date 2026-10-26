/**
 * The AI agents' money and rules: what a package costs and earns, when a call
 * or a message may go, whose request a webhook is, and what a call or a chat
 * does to its lead. Pure — no database, no phone line.
 */
import { describe, expect, it } from 'vitest';

import { allowance, callCostUsd, DEFAULT_RATE_CARD, quote, rateCardFrom, type AgentPlan } from '../billing';
import { endState, inHours, leadAfterCall } from '../calls';
import { dueForCall, planFrom } from '../index';
import { callInstruction, whatsappInstruction, type AgentSetup } from '../prompt';
import { dialable, pkMobileE164, twilioSignature, validTwilioRequest, xmlAttr } from '../twilio';
import { leadAfterChat, mayOpenChat, waIdOf } from '../whatsapp';

const card = DEFAULT_RATE_CARD;

describe('quote', () => {
  it('prices a month and shows the margin beside it', () => {
    const q = quote({ agents: 1, numbers: 1, callsPerDay: 20, avgCallMin: 2, waMessagesPerMonth: 300 }, card);
    expect(q.minutes).toBe(1200);
    // 10 + 3 + 1200 × 0.30 + 300 × 0.05
    expect(q.priceUsd).toBe(388);
    expect(q.pricePkr).toBe(388 * 280);
    // 1.15 + 1200 × (0.18 + 0.023) + 300 × (0.2 × 0.0473 + 0.8 × 0.015 + 0.002)
    expect(q.costUsd).toBeCloseTo(1.15 + 243.6 + 7.08, 1);
    expect(q.marginUsd).toBeCloseTo(q.priceUsd - q.costUsd, 2);
    expect(q.marginPct).toBe(35);
    expect(q.lines).toHaveLength(4);
  });

  it('a rate card stored with gaps keeps the defaults for what is missing', () => {
    const c = rateCardFrom({ price: { perMin: 0.5 } as never });
    expect(c.price.perMin).toBe(0.5);
    expect(c.price.perNumberMonth).toBe(card.price.perNumberMonth);
    expect(c.cost).toEqual(card.cost);
  });
});

describe('callCostUsd', () => {
  it('bills the line per started minute and the voice per second', () => {
    expect(callCostUsd(0, card)).toBe(0);
    expect(callCostUsd(61, card)).toBeCloseTo(2 * 0.18 + (61 / 60) * 0.023, 6);
  });
});

describe('allowance', () => {
  const now = 1_000_000;
  const plan = { callsPerDay: 10, minutesPerMonth: 100, waMessagesPerMonth: 50, paidUntilMs: now + 1 } as AgentPlan;
  const none = { callsToday: 0, month: { lineMin: 0, waOut: 0, waTemplates: 0 } };

  it('the house has no caps', () => {
    expect(allowance(null, none, 'call', now, true)).toBeNull();
  });

  it('a customer needs a paid package', () => {
    expect(allowance(null, none, 'call', now, false)).toMatch(/package/);
    expect(allowance({ ...plan, paidUntilMs: now }, none, 'call', now, false)).toMatch(/package/);
    expect(allowance(plan, none, 'call', now, false)).toBeNull();
  });

  it('stops at the day’s calls, the month’s minutes and the month’s messages', () => {
    expect(allowance(plan, { ...none, callsToday: 10 }, 'call', now, false)).toMatch(/Today’s 10 calls/);
    expect(allowance(plan, { callsToday: 0, month: { lineMin: 100, waOut: 0, waTemplates: 0 } }, 'call', now, false)).toMatch(/100 call minutes/);
    expect(allowance(plan, { callsToday: 0, month: { lineMin: 0, waOut: 40, waTemplates: 10 } }, 'whatsapp', now, false)).toMatch(/50 WhatsApp/);
  });
});

describe('planFrom', () => {
  it('turns a package into minutes and keeps an agreed price', () => {
    const p = planFrom({ agents: 1, numbers: 1, callsPerDay: 5, avgCallMin: 2, waMessagesPerMonth: 0 }, card, 9, 'admin', 1, 50);
    expect(p.minutesPerMonth).toBe(300);
    expect(p.priceUsd).toBe(50);
    expect(p.paidUntilMs).toBe(9);
  });
});

describe('twilio', () => {
  it('signs a request the way Twilio documents it (their own example)', () => {
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    expect(twilioSignature('12345', url, params)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    expect(validTwilioRequest('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(true);
  });

  it('refuses a forged, tampered or unsigned request', () => {
    const url = 'https://x.test/agentVoiceStatus?wid=velocity&callId=c1';
    const params = { CallStatus: 'completed', CallDuration: '30' };
    const good = twilioSignature('tok', url, params);
    expect(validTwilioRequest('tok', url, { ...params, CallDuration: '3000' }, good)).toBe(false);
    expect(validTwilioRequest('other', url, params, good)).toBe(false);
    expect(validTwilioRequest('tok', url.replace('c1', 'c2'), params, good)).toBe(false);
    expect(validTwilioRequest('tok', url, params, undefined)).toBe(false);
    expect(validTwilioRequest('', url, params, good)).toBe(false);
  });

  it('dials Pakistani mobiles and landlines in any shape people write them', () => {
    expect(pkMobileE164('0300-1234567')).toBe('+923001234567');
    expect(pkMobileE164('+92 300 1234567')).toBe('+923001234567');
    expect(pkMobileE164('00923001234567')).toBe('+923001234567');
    expect(pkMobileE164('3001234567')).toBe('+923001234567');
    expect(pkMobileE164('042-35761234')).toBeNull();
    expect(dialable('042-35761234')).toBe('+924235761234');
    expect(dialable('+44 20 7946 0958')).toBe('+442079460958');
    expect(dialable('call us')).toBeNull();
    expect(dialable(null)).toBeNull();
  });

  it('escapes what goes into TwiML', () => {
    expect(xmlAttr('a"<b>&')).toBe('a&quot;&lt;b&gt;&amp;');
  });
});

describe('calls', () => {
  it('keeps to the calling hours, including a window across midnight', () => {
    expect(inHours({ hoursFrom: 10, hoursTo: 18 }, 9)).toBe(false);
    expect(inHours({ hoursFrom: 10, hoursTo: 18 }, 10)).toBe(true);
    expect(inHours({ hoursFrom: 10, hoursTo: 18 }, 18)).toBe(false);
    expect(inHours({ hoursFrom: 20, hoursTo: 2 }, 23)).toBe(true);
    expect(inHours({ hoursFrom: 20, hoursTo: 2 }, 1)).toBe(true);
    expect(inHours({ hoursFrom: 20, hoursTo: 2 }, 12)).toBe(false);
  });

  it('moves the lead by how the call went, and "do not call" sticks', () => {
    expect(leadAfterCall('deal', 'sent')).toEqual({ status: 'won', doNotContact: false });
    expect(leadAfterCall('interested', 'new')).toEqual({ status: 'replied', doNotContact: false });
    expect(leadAfterCall('interested', 'lost')).toEqual({ status: 'lost', doNotContact: false });
    expect(leadAfterCall('not_interested', 'new').status).toBe('lost');
    expect(leadAfterCall('do_not_call', 'won')).toEqual({ status: 'lost', doNotContact: true });
    expect(leadAfterCall(null, 'sent')).toEqual({ status: 'sent', doNotContact: false });
  });

  it('reads how Twilio says a call ended', () => {
    expect(endState('completed', 40)).toBe('ended');
    expect(endState('completed', 0)).toBe('no-answer');
    expect(endState('busy', 0)).toBe('busy');
    expect(endState('canceled', 0)).toBe('no-answer');
    expect(endState('failed', 0)).toBe('failed');
  });

  it('calls a new lead once, and a missed one once more after three hours', () => {
    const now = 10 * 3600_000;
    const lead = { status: 'new' as const, phone: '03001234567', doNotContact: false, lastCall: null, aiCalls: 0 };
    expect(dueForCall(lead, now)).toBe(true);
    expect(dueForCall({ ...lead, phone: null }, now)).toBe(false);
    expect(dueForCall({ ...lead, doNotContact: true }, now)).toBe(false);
    expect(dueForCall({ ...lead, status: 'replied' }, now)).toBe(false);
    const missed = { ...lead, aiCalls: 1, lastCall: { atMs: now - 4 * 3600_000, outcome: 'no_answer' } };
    expect(dueForCall(missed, now)).toBe(true);
    expect(dueForCall({ ...missed, lastCall: { atMs: now - 3600_000, outcome: 'no_answer' } }, now)).toBe(false);
    expect(dueForCall({ ...missed, aiCalls: 2 }, now)).toBe(false);
    expect(dueForCall({ ...missed, lastCall: { atMs: 0, outcome: 'interested' } }, now)).toBe(false);
  });
});

describe('prompts', () => {
  const agent: AgentSetup = { id: 'sara', name: 'Sara', voice: 'female', language: 'urdu', goal: 'a demo', opener: '', points: '', knowledge: 'Basic plan: Rs 5,000 a month.' };
  const seller = { product: 'Bakery software', offer: '', senderName: 'Ali', senderCompany: 'Bake.pk', senderAddress: '', language: 'English' };
  const lead = { name: 'Bloom Bakers', website: null, title: '', description: '', signals: [] };

  it('a call says it is an AI, states only what it was given and asks before WhatsApp', () => {
    const s = callInstruction(agent, seller, lead);
    expect(s).toMatch(/AI sales assistant/);
    expect(s).toMatch(/ONLY facts you may state:\nBasic plan: Rs 5,000 a month\./);
    expect(s).toMatch(/whatsapp_ok when they say yes/);
    expect(s).toMatch(/do_not_call/);
    expect(s).toContain('Bloom Bakers');
  });

  it('WhatsApp answers in their language and hands over what it does not know', () => {
    const s = whatsappInstruction(agent, seller, null);
    expect(s).toMatch(/language and script they write in/);
    expect(s).toMatch(/intent "human"/);
    expect(s).toMatch(/"intent"/);
  });
});

describe('whatsapp', () => {
  it('moves the lead by the chat, and "stop" sticks', () => {
    expect(leadAfterChat('deal')).toEqual({ status: 'won' });
    expect(leadAfterChat('meeting')).toEqual({ status: 'replied' });
    expect(leadAfterChat('stop')).toEqual({ status: 'lost', doNotContact: true });
    expect(leadAfterChat('question')).toEqual({});
  });

  it('turns a dialled number into a WhatsApp id', () => {
    expect(waIdOf('+923001234567')).toBe('923001234567');
    expect(waIdOf('03001234567')).toBe('923001234567');
  });

  it('opens no new chat once Meta marks the number down', () => {
    expect(mayOpenChat('GREEN')).toBe(true);
    expect(mayOpenChat(undefined)).toBe(true);
    expect(mayOpenChat('YELLOW')).toBe(false);
    expect(mayOpenChat('RED')).toBe(false);
  });
});
