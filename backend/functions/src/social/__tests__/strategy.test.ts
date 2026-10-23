/**
 * The month plan is model output that the daily run then obeys, so what it may
 * contain is held in code: real dates, known formats, one of each format a day
 * (a post id is date + format), and no more slots than the desk posts.
 */
import { describe, expect, it } from 'vitest';

import { daysOf, localMonthPlan, normalisePlan } from '../strategy';
import { DEFAULT_SETTINGS } from '../types';

describe('daysOf', () => {
  it('knows how long a month is, leap years included', () => {
    expect(daysOf('2026-10')).toHaveLength(31);
    expect(daysOf('2028-02')).toHaveLength(29);
    expect(daysOf('2026-02').at(-1)).toBe('2026-02-28');
  });
});

describe('normalisePlan', () => {
  const raw = {
    goal: ' More sends than last month ',
    pillars: ['Cash fares', '', 'Women drivers'],
    weeks: [{ theme: 'Payday', focus: 'what a fare costs' }, { focus: 'no theme, dropped' }],
    days: {
      '2026-11-01': [
        { format: 'reel', topic: 'A driver counts the day', hook: 'Rs?', pillar: 'Cash fares' },
        { format: 'reel', topic: 'second reel, same day', hook: '', pillar: '' },
        { format: 'hologram', topic: 'not a format', hook: '', pillar: '' },
        { format: 'post', topic: '', hook: 'no topic', pillar: '' },
        { format: 'carousel', topic: 'How the split works', hook: '', pillar: '' },
        { format: 'story', topic: 'over the daily count', hook: '', pillar: '' },
      ],
      '2026-12-01': [{ format: 'reel', topic: 'next month', hook: '', pillar: '' }],
      '2026-11-31': [{ format: 'reel', topic: 'no such day', hook: '', pillar: '' }],
    },
    ads: ['Drivers in Lahore, 7 days'],
    sales: 'not a list',
  };

  const plan = normalisePlan(raw, '2026-11', 2);

  it('keeps only real formats with a topic, one of each, up to the daily count', () => {
    expect(plan.days['2026-11-01'].map((s) => s.format)).toEqual(['reel', 'carousel']);
    expect(plan.days['2026-11-01'][0].topic).toBe('A driver counts the day');
  });

  it('drops days outside the month', () => {
    expect(Object.keys(plan.days)).toEqual(['2026-11-01']);
  });

  it('trims the rest and drops what is empty or the wrong shape', () => {
    expect(plan.goal).toBe('More sends than last month');
    expect(plan.pillars).toEqual(['Cash fares', 'Women drivers']);
    expect(plan.weeks).toEqual([{ theme: 'Payday', focus: 'what a fare costs' }]);
    expect(plan.ads).toEqual(['Drivers in Lahore, 7 days']);
    expect(plan.sales).toEqual([]);
  });
});

describe('localMonthPlan', () => {
  it('lays the rotation over every day, never the same format twice a day', () => {
    const plan = localMonthPlan('2026-11', { ...DEFAULT_SETTINGS, postsPerDay: 2, formats: ['reel', 'reel', 'post'] });
    expect(Object.keys(plan.days)).toHaveLength(30);
    for (const slots of Object.values(plan.days)) {
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.length).toBeLessThanOrEqual(2);
      expect(new Set(slots.map((s) => s.format)).size).toBe(slots.length);
    }
  });
});
