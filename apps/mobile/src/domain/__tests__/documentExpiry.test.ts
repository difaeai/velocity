/**
 * The document countdown on the driver home.
 *
 * Asked for in so many words: once a driver is registered, the only timer they
 * see is "your CNIC or licence expires in N days", and only inside the last 30
 * days. These pin that — and that the number matches the server's push.
 */
import { describe, expect, it } from 'vitest';

import { EXPIRY_WARN_DAYS, documentsExpiringSoon } from '../documentExpiry';

/** 24 October 2026, 15:00 in Pakistan (10:00 UTC). */
const NOW = Date.UTC(2026, 9, 24, 10, 0);

describe('documentsExpiringSoon', () => {
  it('says nothing about papers with more than a month left', () => {
    expect(documentsExpiringSoon({ licenseExpiry: '2026-11-24', cnicExpiry: '2035-12-31' }, NOW)).toEqual([]);
  });

  it('counts down inside the last month, soonest first', () => {
    expect(documentsExpiringSoon({ licenseExpiry: '2026-11-20', cnicExpiry: '2026-10-29' }, NOW)).toEqual([
      { key: 'cnic', label: 'CNIC', daysLeft: 5 },
      { key: 'license', label: 'driving licence', daysLeft: 27 },
    ]);
  });

  it('includes the 30th day and today itself', () => {
    expect(documentsExpiringSoon({ licenseExpiry: '2026-11-23' }, NOW)[0]?.daysLeft).toBe(EXPIRY_WARN_DAYS);
    expect(documentsExpiringSoon({ licenseExpiry: '2026-10-24' }, NOW)[0]?.daysLeft).toBe(0);
  });

  it('believes the date read off the card over the one the driver typed', () => {
    // The server stops a driver on the printed date; the app must count to the same day.
    const profile = {
      licenseExpiry: '2030-01-01',
      verification: { expiries: { license: { resolved: '2026-11-03' } } },
    };
    expect(documentsExpiringSoon(profile, NOW)).toEqual([{ key: 'license', label: 'driving licence', daysLeft: 10 }]);
  });

  it('leaves a lapsed paper to the server, and ignores dates it cannot read', () => {
    expect(documentsExpiringSoon({ licenseExpiry: '2026-10-20', cnicExpiry: 'soon' }, NOW)).toEqual([]);
    expect(documentsExpiringSoon(null, NOW)).toEqual([]);
  });

  it('reads the unpadded dates older records carry', () => {
    expect(documentsExpiringSoon({ vehicleDocExpiry: '2026-11-1' }, NOW)).toEqual([
      { key: 'vehicleRegistration', label: 'vehicle registration', daysLeft: 8 },
    ]);
  });
});
