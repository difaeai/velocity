/**
 * The launch sequence's pure parts: what it will fetch from the owner's links,
 * the shape of the funnel the rest of the desk obeys, and where a new
 * workspace starts. The posting clock it hands the calendar is tested here too.
 */
import { describe, expect, it } from 'vitest';

import { cleanLinks, freshLaunch, MAX_LINKS, normaliseFunnel, notInPlan, STEPS } from '../launch';
import { dueAtMs, isAhead } from '../pipeline';

describe('cleanLinks', () => {
  it('keeps web addresses, adds https to a bare domain, and drops repeats and junk', () => {
    expect(
      cleanLinks(['bakehouse.pk', 'https://bakehouse.pk/', ' https://instagram.com/bakehouse ', 'not a link', 'ftp:x', '']),
    ).toEqual(['https://bakehouse.pk/', 'https://instagram.com/bakehouse']);
  });

  it(`reads at most ${MAX_LINKS}`, () => {
    expect(cleanLinks(Array.from({ length: 12 }, (_, i) => `site${i}.pk`))).toHaveLength(MAX_LINKS);
  });
});

describe('normaliseFunnel', () => {
  const funnel = normaliseFunnel({
    offer: ' First breakfast box free for offices ',
    cta: 'Order a box',
    stages: [{ stage: 'See', how: 'a reel of the 7am bake' }, { stage: 'Click' }, 'junk'],
    adBrief: 'Office managers in Gulberg, traffic to WhatsApp',
    salesKinds: ['corporate offices', 'x', 7],
    salesCity: 'Lahore',
  });

  it('keeps complete stages and real kinds of business', () => {
    expect(funnel.offer).toBe('First breakfast box free for offices');
    expect(funnel.stages).toEqual([{ stage: 'See', how: 'a reel of the 7am bake' }]);
    expect(funnel.salesKinds).toEqual(['corporate offices']);
  });

  it('treats a missing field as empty rather than undefined', () => {
    expect(funnel.landing).toBe('');
    expect(funnel.openingLine).toBe('');
  });
});

describe('a new workspace', () => {
  it('starts with all five steps waiting, in order', () => {
    const state = freshLaunch(1000);
    expect(Object.keys(state.steps)).toEqual([...STEPS]);
    expect(Object.values(state.steps).every((s) => s.status === 'waiting')).toBe(true);
  });
});

describe('notInPlan', () => {
  const left = (can: string[]) => STEPS.filter((id) => notInPlan(id, can));
  it('leaves out exactly what each plan does not pay for', () => {
    expect(left(['content'])).toEqual(['funnel', 'close']);
    expect(left(['ads'])).toEqual(['content', 'execute', 'close']);
    expect(left(['sales'])).toEqual(['content', 'execute']);
    expect(left(['content', 'ads', 'sales'])).toEqual([]);
  });
  it('says it is skipped, so the sweep can bring the step back after an upgrade', () => {
    expect(notInPlan('close', ['content'])).toMatchObject({ status: 'skipped', note: expect.stringMatching(/Everything plan/) });
    expect(notInPlan('market', [])).toBeNull();
  });
});

describe('the posting clock', () => {
  it('is the Pakistan day at the desk hour', () => {
    // 10:00 PKT on the 24th is 05:00 UTC.
    expect(new Date(dueAtMs('2026-10-24', 10)).toISOString()).toBe('2026-10-24T05:00:00.000Z');
  });

  it('holds only pieces for a later Pakistan day', () => {
    const lateEvening = Date.parse('2026-10-23T18:30:00Z'); // 23:30 PKT on the 23rd
    expect(isAhead('2026-10-24', lateEvening)).toBe(true);
    expect(isAhead('2026-10-23', lateEvening)).toBe(false);
    expect(isAhead('2026-10-24', Date.parse('2026-10-23T19:30:00Z'))).toBe(false); // already the 24th in Pakistan
  });
});
