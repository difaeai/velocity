import { describe, expect, it } from 'vitest';

import { resolveAdUnit } from '../adUnit';

const APP = 'ca-app-pub-7627374718071924~7294012484';
const BANNER = 'ca-app-pub-7627374718071924/2200186644';
const OLD_ACCOUNT_UNIT = 'ca-app-pub-7505727874471807/9754676449';
const TEST = 'ca-app-pub-3940256099942544/6300978111';

describe('resolveAdUnit', () => {
  it('serves a unit from the same account as the app id', () => {
    expect(resolveAdUnit(BANNER, APP, TEST, false)).toEqual({ unit: BANNER });
  });

  it('never shows test ads in a release build: unset means off', () => {
    expect(resolveAdUnit(undefined, APP, TEST, false).unit).toBeNull();
    expect(resolveAdUnit('  ', APP, TEST, false).unit).toBeNull();
    expect(resolveAdUnit(undefined, APP, TEST, true).unit).toBe(TEST);
  });

  it('turns off a unit from another AdMob account', () => {
    const r = resolveAdUnit(OLD_ACCOUNT_UNIT, APP, TEST, false);
    expect(r.unit).toBeNull();
    expect(r.problem).toMatch(/different AdMob account/);
  });

  it('turns off a malformed id, e.g. the app id pasted as a unit', () => {
    expect(resolveAdUnit(APP, APP, TEST, false).unit).toBeNull();
  });

  it('a release build with no app id for its platform serves nothing', () => {
    expect(resolveAdUnit(BANNER, undefined, TEST, false).unit).toBeNull();
    // Dev keeps working without one (the build uses Google's sample app id).
    expect(resolveAdUnit(BANNER, undefined, TEST, true).unit).toBe(BANNER);
  });
});
