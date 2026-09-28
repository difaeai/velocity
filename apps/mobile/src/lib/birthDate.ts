/**
 * Date-of-birth arithmetic for the three-part picker (src/ui/BirthDatePicker).
 *
 * Kept free of React Native so the two things that quietly go wrong with dates
 * — February, and the time zone a saved date is read back in — are unit-tested.
 */

/** `month` is 0–11, as `Date` counts it. `null` means not chosen yet. */
export interface BirthDateParts {
  day: number | null;
  month: number | null;
  year: number | null;
}

/** Days in the month, with February on 29 until a year says otherwise. */
export function daysInMonth(month: number | null, year: number | null): number {
  if (month === null) return 31;
  // 2000 was a leap year, so an unknown year never rules out the 29th.
  return new Date(year ?? 2000, month + 1, 0).getDate();
}

/**
 * Sets one part, pulling the day back when it no longer exists — 31 then
 * February keeps the closest real day rather than an impossible date.
 */
export function withPart(
  parts: BirthDateParts,
  part: keyof BirthDateParts,
  value: number,
): BirthDateParts {
  const next = { ...parts, [part]: value };
  const last = daysInMonth(next.month, next.year);
  if (next.day !== null && next.day > last) next.day = last;
  return next;
}

/**
 * The chosen parts as a Date, or null until all three are chosen.
 *
 * Built at local noon, not midnight: the profile stores `toISOString()`, and
 * midnight in Pakistan is still the previous day in UTC, so a midnight date
 * would be saved as the day before the one the person picked.
 */
export function birthDateFromParts(p: BirthDateParts): Date | null {
  if (p.day === null || p.month === null || p.year === null) return null;
  return new Date(p.year, p.month, p.day, 12);
}
