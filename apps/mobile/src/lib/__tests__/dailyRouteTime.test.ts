import { describe, expect, it } from 'vitest';

import { clockLabel, fromHHMM, legByClock, toHHMM } from '../dailyRouteTime';

describe('legByClock', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m);

  it('shows the trip there in the morning and home after midday for 9 to 5', () => {
    expect(legByClock('09:00', '17:00', at(7, 30))).toBe('go');
    expect(legByClock('09:00', '17:00', at(12, 59))).toBe('go');
    expect(legByClock('09:00', '17:00', at(13))).toBe('back');
    expect(legByClock('09:00', '17:00', at(18))).toBe('back');
    expect(legByClock('09:00', '17:00', at(1, 30))).toBe('go');
  });

  it('wraps a night shift past midnight', () => {
    expect(legByClock('22:00', '06:00', at(20))).toBe('go');
    expect(legByClock('22:00', '06:00', at(5))).toBe('back');
  });

  it('goes there when a time is missing', () => {
    expect(legByClock(null, '17:00', at(18))).toBe('go');
  });
});

describe('clockLabel', () => {
  it('reads a stored time on a 12-hour clock', () => {
    expect(clockLabel('08:30')).toBe('8:30 AM');
    expect(clockLabel('17:05')).toBe('5:05 PM');
  });

  it('puts midnight and noon at 12', () => {
    expect(clockLabel('00:15')).toBe('12:15 AM');
    expect(clockLabel('12:00')).toBe('12:00 PM');
  });

  it('treats no time, or a time it cannot read, as any time', () => {
    expect(clockLabel(null)).toBeNull();
    expect(clockLabel(undefined)).toBeNull();
    expect(clockLabel('24:00')).toBeNull();
    expect(clockLabel('8.30')).toBeNull();
  });
});

describe('toHHMM / fromHHMM', () => {
  it('round-trips a picked time', () => {
    const picked = new Date(2026, 9, 24, 7, 5);
    expect(toHHMM(picked)).toBe('07:05');
    const back = fromHHMM('07:05', new Date(2026, 9, 24, 13, 40));
    expect([back.getHours(), back.getMinutes()]).toEqual([7, 5]);
  });

  it('opens on the fallback when the route has no time', () => {
    const now = new Date(2026, 9, 24, 13, 40);
    expect(fromHHMM(null, now).getTime()).toBe(now.getTime());
  });
});
