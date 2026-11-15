/**
 * The closer, where it decides what goes out on somebody's own WhatsApp number.
 *
 * Four of these tests are the product promise rather than unit coverage: a
 * message is never long, a reply is in the language the person wrote in, "stop"
 * is absolute, and business-initiated messages are rationed while replies never
 * are. If one of them regresses the client's number is the thing that pays for
 * it, and a restricted number cannot be fixed by a deploy.
 */
import { describe, expect, it } from 'vitest';

import {
  canFreeForm,
  cleanStage,
  findNumber,
  isQuiet,
  isStop,
  languageOf,
  LANGUAGE_RULE,
  MAX_REPLY_CHARS,
  newChat,
  parseSheet,
  sendBudget,
  toNumber,
  transcript,
  trimReply,
  wantsHuman,
  type SalesChat,
} from '../closer';
import { holdReason } from '../engagement';

const NOW = Date.parse('2026-11-15T09:00:00Z'); // 14:00 in Pakistan

describe('languageOf', () => {
  it('answers Urdu script in Urdu script', () => {
    expect(languageOf('قیمت کیا ہے')).toBe('urdu-script');
  });

  it('reads Roman Urdu the way people actually type it', () => {
    expect(languageOf('bhai rate kya hai')).toBe('roman-urdu');
    expect(languageOf('kitna hai')).toBe('roman-urdu');
    expect(languageOf('mujhe booking karna hai')).toBe('roman-urdu');
  });

  it('leaves a real English sentence in English', () => {
    expect(languageOf('Hi, can you tell me the price for a two bedroom?')).toBe('english');
  });

  it('does not change a conversation’s language because somebody typed "ok"', () => {
    // The thing that would make a Roman Urdu chat suddenly answer in English
    // halfway through, which reads as two different people replying.
    expect(languageOf('ok', 'roman-urdu')).toBe('roman-urdu');
    expect(languageOf('2', 'roman-urdu')).toBe('roman-urdu');
    expect(languageOf('thanks', 'urdu-script')).toBe('urdu-script');
  });

  it('still switches when the message is long enough to be decisive', () => {
    expect(languageOf('yes please send me the full list today', 'roman-urdu')).toBe('english');
  });

  it('has a rule for every language it can return', () => {
    for (const lang of ['english', 'roman-urdu', 'urdu-script'] as const) {
      expect(LANGUAGE_RULE[lang].length).toBeGreaterThan(20);
    }
  });
});

describe('trimReply', () => {
  it('keeps a short reply exactly as it is', () => {
    expect(trimReply('Rate 2500 hai. Kab chahiye?')).toBe('Rate 2500 hai. Kab chahiye?');
  });

  it('cuts a model that wrote an essay down to two sentences', () => {
    const essay =
      'Thank you so much for reaching out to us today. We have a wide range of options available for you. ' +
      'Our prices start from 2500 rupees. We also offer delivery. Let me know what you think.';
    const out = trimReply(essay);
    expect(out.split(/[.!?]/).filter((x) => x.trim()).length).toBeLessThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
  });

  it('never sends a wall of text, whatever the model did', () => {
    const wall = `**Options:**\n- one\n- two\n- three\n\n${'a'.repeat(900)}`;
    const out = trimReply(wall);
    expect(out.length).toBeLessThanOrEqual(MAX_REPLY_CHARS + 1);
    expect(out).not.toContain('\n');
    expect(out).not.toContain('**');
  });

  it('cuts between words, not through one', () => {
    const out = trimReply(`${'word '.repeat(80)}end`);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wo…$/);
  });

  it('is empty for nothing at all', () => {
    expect(trimReply('')).toBe('');
    expect(trimReply('   \n  ')).toBe('');
  });
});

describe('toNumber and findNumber', () => {
  it('reads a Pakistani number however it was typed', () => {
    for (const raw of ['03175812623', '0317 581 2623', '+92 317 581 2623', '0092 317 5812623', '3175812623']) {
      expect(toNumber(raw)).toBe('923175812623');
    }
  });

  it('keeps a full international number as it is', () => {
    expect(toNumber('+971 50 123 4567')).toBe('971501234567');
    expect(toNumber('+1 415 555 0123')).toBe('14155550123');
  });

  it('refuses what cannot be messaged', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber('hello')).toBeNull();
    expect(toNumber('042 111 222')).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it('pulls the number out of a sentence somebody typed it into', () => {
    expect(findNumber('mera number 0317 581 2623 hai, message kardo')).toBe('923175812623');
    expect(findNumber('call me on +92-317-5812623 please')).toBe('923175812623');
    expect(findNumber('no number here, sorry')).toBeNull();
  });

  it('does not mistake a price for a phone number', () => {
    expect(findNumber('rate 2500 hai')).toBeNull();
  });
});

describe('isStop and wantsHuman', () => {
  it('honours stop in English, Roman Urdu and Urdu', () => {
    expect(isStop('STOP')).toBe(true);
    expect(isStop('band karo')).toBe(true);
    expect(isStop('بند')).toBe(true);
    expect(isStop('unsubscribe')).toBe(true);
  });

  it('does not take the word stop inside a sentence as consent withdrawn', () => {
    expect(isStop('where does the bus stop')).toBe(false);
  });

  it('hands over anything that is not Vexa’s to answer', () => {
    expect(wantsHuman('I want a refund')).toBe(true);
    expect(wantsHuman('mujhe owner se baat karao')).toBe(true);
    expect(wantsHuman('call me')).toBe(true);
    expect(wantsHuman('shikayat hai')).toBe(true);
    expect(wantsHuman('kitne ka hai')).toBe(false);
  });
});

describe('the service window and the ration', () => {
  it('allows a free reply only inside 24 hours of their message', () => {
    expect(canFreeForm(NOW - 3600_000, NOW)).toBe(true);
    expect(canFreeForm(NOW - 25 * 3600_000, NOW)).toBe(false);
    expect(canFreeForm(null, NOW)).toBe(false);
  });

  it('counts today’s business-initiated messages against the cap', () => {
    const day = new Date(NOW + 5 * 3600_000).toISOString().slice(0, 10);
    expect(sendBudget({ dailyCap: 100, sentDay: null, sentToday: 0 }, NOW)).toBe(100);
    expect(sendBudget({ dailyCap: 100, sentDay: day, sentToday: 40 }, NOW)).toBe(60);
    expect(sendBudget({ dailyCap: 100, sentDay: day, sentToday: 100 }, NOW)).toBe(0);
    // Yesterday's count does not spend today's.
    expect(sendBudget({ dailyCap: 100, sentDay: '2026-01-01', sentToday: 100 }, NOW)).toBe(100);
  });

  it('never lets a cap above a thousand through, whatever is stored', () => {
    expect(sendBudget({ dailyCap: 99_999, sentDay: null, sentToday: 0 }, NOW)).toBe(1000);
  });

  it('sends nothing in the middle of the night', () => {
    expect(isQuiet(Date.parse('2026-11-15T09:00:00Z'))).toBe(false); // 14:00 PKT
    expect(isQuiet(Date.parse('2026-11-15T22:00:00Z'))).toBe(true); // 03:00 PKT
    expect(isQuiet(Date.parse('2026-11-15T02:00:00Z'))).toBe(true); // 07:00 PKT
  });
});

describe('parseSheet', () => {
  it('takes a column of numbers however they were pasted', () => {
    const rows = parseSheet('0317 581 2623\n+923001234567\n0300-9876543');
    expect(rows.map((r) => r.number)).toEqual(['923175812623', '923001234567', '923009876543']);
  });

  it('finds the number in whichever column it is in, and keeps the name', () => {
    const rows = parseSheet('Ali,03175812623,wants a 5 marla\nSana;03009876543;called last week');
    expect(rows[0]).toEqual({ number: '923175812623', name: 'Ali', note: 'wants a 5 marla' });
    expect(rows[1].name).toBe('Sana');
  });

  it('drops rubbish rows and duplicates', () => {
    const rows = parseSheet('not a number\n03175812623\n0317 5812623\n\n042 111 222');
    expect(rows).toHaveLength(1);
  });

  it('caps a huge paste', () => {
    const many = Array.from({ length: 900 }, (_, i) => `030012${String(i).padStart(5, '0')}`).join('\n');
    expect(parseSheet(many, 500)).toHaveLength(500);
  });
});

describe('the chat record', () => {
  it('starts a lead off with nothing assumed', () => {
    const chat = newChat({ waId: '923175812623', source: 'whatsapp', nowMs: NOW });
    expect(chat.stage).toBe('new');
    expect(chat.blocked).toBe(false);
    expect(chat.handover).toBe(false);
    expect(chat.messages).toEqual([]);
  });

  it('renders the conversation for the prompt, oldest first', () => {
    const chat: SalesChat = {
      ...newChat({ waId: '923175812623', source: 'whatsapp', nowMs: NOW }),
      messages: [
        { from: 'them', text: 'rate kya hai', atMs: NOW },
        { from: 'us', text: '2500 se shuru', atMs: NOW + 1 },
      ],
    };
    expect(transcript(chat)).toBe('THEM: rate kya hai\nUS: 2500 se shuru');
  });

  it('holds the stage to the ones that exist', () => {
    expect(cleanStage('pitched', 'new')).toBe('pitched');
    expect(cleanStage('closing-hard', 'talking')).toBe('talking');
    expect(cleanStage(undefined, 'new')).toBe('new');
  });
});

describe('a lead comment may carry our own number, and only ours', () => {
  it('no longer holds a reply for carrying the business’s own WhatsApp', () => {
    const reply = 'Rate 2500 se shuru hota hai. WhatsApp us on +92 317 581 2623.';
    expect(holdReason(reply, '+92 317 581 2623')).toBeNull();
    expect(holdReason(reply, '923175812623')).toBeNull();
  });

  it('still holds a reply carrying somebody else’s number', () => {
    expect(holdReason('Call 0300 111 2233 instead.', '923175812623')).toBe('it carries a phone number');
  });

  it('still holds a number when no number is connected at all', () => {
    expect(holdReason('WhatsApp us on 0317 581 2623.')).toBe('it carries a phone number');
  });

  it('still holds a link, whatever number is connected', () => {
    expect(holdReason('See example.com for prices', '923175812623')).toBe('it carries a link');
  });
});
