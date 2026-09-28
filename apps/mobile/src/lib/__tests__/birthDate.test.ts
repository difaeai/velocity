import { describe, expect, it } from 'vitest';

import { birthDateFromParts, daysInMonth, withPart, type BirthDateParts } from '../birthDate';

const EMPTY: BirthDateParts = { day: null, month: null, year: null };

describe('daysInMonth', () => {
  it('knows the length of every month', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => daysInMonth(m, 2001))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
  });

  it('gives February 29 in a leap year and 28 otherwise', () => {
    expect(daysInMonth(1, 2004)).toBe(29);
    expect(daysInMonth(1, 2000)).toBe(29);
    expect(daysInMonth(1, 1900)).toBe(28);
    expect(daysInMonth(1, 2003)).toBe(28);
  });

  // Somebody born on 29 February must be able to pick it before the year.
  it('keeps the 29th open for February while the year is unknown', () => {
    expect(daysInMonth(1, null)).toBe(29);
  });

  it('offers every day while the month is unknown', () => {
    expect(daysInMonth(null, null)).toBe(31);
    expect(daysInMonth(null, 2001)).toBe(31);
  });
});

describe('withPart', () => {
  it('pulls the 31st back to the last day of a shorter month', () => {
    const day31 = withPart(EMPTY, 'day', 31);
    expect(withPart(day31, 'month', 3)).toEqual({ day: 30, month: 3, year: null });
  });

  it('pulls 29 February back to the 28th when a non-leap year is chosen', () => {
    const feb29 = withPart(withPart(EMPTY, 'day', 29), 'month', 1);
    expect(feb29.day).toBe(29);
    expect(withPart(feb29, 'year', 1999).day).toBe(28);
    expect(withPart(feb29, 'year', 1996).day).toBe(29);
  });

  it('never touches a day that still exists', () => {
    const p = withPart(withPart(EMPTY, 'day', 14), 'month', 2);
    expect(withPart(p, 'year', 1998)).toEqual({ day: 14, month: 2, year: 1998 });
  });
});

describe('birthDateFromParts', () => {
  it('waits for all three parts', () => {
    expect(birthDateFromParts(EMPTY)).toBeNull();
    expect(birthDateFromParts({ day: 14, month: 2, year: null })).toBeNull();
    expect(birthDateFromParts({ day: null, month: 2, year: 1998 })).toBeNull();
  });

  it('builds the date that was picked', () => {
    const d = birthDateFromParts({ day: 14, month: 2, year: 1998 })!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([1998, 2, 14]);
  });

  // The profile stores toISOString(). At local midnight in Pakistan (UTC+5)
  // that would name the 13th; at noon it names the 14th in every zone a phone
  // can be set to.
  it('saves as the same calendar day in UTC', () => {
    const d = birthDateFromParts({ day: 14, month: 2, year: 1998 })!;
    expect(d.toISOString().slice(0, 10)).toBe('1998-03-14');
  });
});
