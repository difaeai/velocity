import { describe, expect, it } from 'vitest';

import { compareVersions, describeUpdate, evaluateUpdate, parseBuildNumber } from '../appUpdateRules';

const URL = 'https://play.google.com/store/apps/details?id=com.velocityridzpk.app';

describe('compareVersions', () => {
  it('orders by each numeric segment', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.9', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0);
  });

  it('reads junk segments as zero rather than NaN', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
    expect(compareVersions('', '0.0.0')).toBe(0);
  });
});

describe('parseBuildNumber', () => {
  it('accepts the string expo-application actually returns', () => {
    expect(parseBuildNumber('13')).toBe(13);
    expect(parseBuildNumber('  13  ')).toBe(13);
    expect(parseBuildNumber(13)).toBe(13);
  });

  it('reads anything unparseable as unknown, never as zero', () => {
    // Zero would look older than every published build and nag forever.
    expect(parseBuildNumber(null)).toBeNull();
    expect(parseBuildNumber(undefined)).toBeNull();
    expect(parseBuildNumber('')).toBeNull();
    expect(parseBuildNumber('1.1.0')).toBeNull();
    expect(parseBuildNumber('13-beta')).toBeNull();
    expect(parseBuildNumber(0)).toBeNull();
    expect(parseBuildNumber(-4)).toBeNull();
    expect(parseBuildNumber(12.5)).toBeNull();
    expect(parseBuildNumber(NaN)).toBeNull();
  });
});

describe('evaluateUpdate — cases that must show nothing', () => {
  it('no config doc', () => {
    expect(evaluateUpdate(undefined, '1.1.0', 12, URL)).toBeNull();
    expect(evaluateUpdate(null, '1.1.0', 12, URL)).toBeNull();
  });

  it('explicitly disabled, even with a newer version published', () => {
    expect(evaluateUpdate({ enabled: false, latestVersion: '9.9.9' }, '1.1.0', 12, URL)).toBeNull();
  });

  it('nothing published to compare against', () => {
    expect(evaluateUpdate({ enabled: true }, '1.1.0', 12, URL)).toBeNull();
    expect(evaluateUpdate({ latestVersion: '   ' }, '1.1.0', 12, URL)).toBeNull();
  });

  it('running exactly the published version', () => {
    expect(evaluateUpdate({ latestVersion: '1.1.0' }, '1.1.0', 12, URL)).toBeNull();
    expect(evaluateUpdate({ latestVersion: '1.1' }, '1.1.0', 12, URL)).toBeNull();
  });

  it('running ahead of the published version (internal build)', () => {
    expect(evaluateUpdate({ latestVersion: '1.1.0' }, '1.2.0', 20, URL)).toBeNull();
  });

  it('same version, same build', () => {
    expect(
      evaluateUpdate({ latestVersion: '1.1.0', latestBuild: 12 }, '1.1.0', 12, URL),
    ).toBeNull();
  });

  it('a newer build published but this build cannot report its own number', () => {
    // Degrades to version-string comparison only — which says "current" — rather
    // than guessing and nagging every install that has no versionCode.
    expect(
      evaluateUpdate({ latestVersion: '1.1.0', latestBuild: 99 }, '1.1.0', null, URL),
    ).toBeNull();
  });
});

describe('evaluateUpdate — cases that must show the prompt', () => {
  it('a newer version string', () => {
    const res = evaluateUpdate({ latestVersion: '1.2.0' }, '1.1.0', 12, URL);
    expect(res).not.toBeNull();
    expect(res!.latestVersion).toBe('1.2.0');
    expect(res!.currentVersion).toBe('1.1.0');
    expect(res!.mandatory).toBe(false);
    expect(res!.storeUrl).toBe(URL);
  });

  it('same version string but a newer build number', () => {
    const res = evaluateUpdate({ latestVersion: '1.1.0', latestBuild: 13 }, '1.1.0', 12, URL);
    expect(res).not.toBeNull();
    expect(res!.latestVersion).toBe('1.1.0');
  });

  it('carries release notes when the admin wrote some', () => {
    const res = evaluateUpdate(
      { latestVersion: '1.2.0', releaseNotes: '  Faster booking  ' },
      '1.1.0',
      12,
      URL,
    );
    expect(res!.releaseNotes).toBe('Faster booking');
  });

  it('drops blank release notes to null', () => {
    const res = evaluateUpdate({ latestVersion: '1.2.0', releaseNotes: '   ' }, '1.1.0', 12, URL);
    expect(res!.releaseNotes).toBeNull();
  });

  it('prefers an admin-supplied store url', () => {
    const res = evaluateUpdate(
      { latestVersion: '1.2.0', storeUrl: 'https://example.test/app' },
      '1.1.0',
      12,
      URL,
    );
    expect(res!.storeUrl).toBe('https://example.test/app');
  });
});

describe('evaluateUpdate — mandatory updates', () => {
  it('is mandatory below the published minimum', () => {
    const res = evaluateUpdate(
      { latestVersion: '1.2.0', minSupportedVersion: '1.2.0' },
      '1.1.0',
      12,
      URL,
    );
    expect(res!.mandatory).toBe(true);
  });

  it('is optional at or above the minimum', () => {
    const res = evaluateUpdate(
      { latestVersion: '1.3.0', minSupportedVersion: '1.1.0' },
      '1.1.0',
      12,
      URL,
    );
    expect(res!.mandatory).toBe(false);
  });

  it('a minimum alone never conjures an update out of nothing', () => {
    expect(evaluateUpdate({ minSupportedVersion: '9.0.0' }, '1.1.0', 12, URL)).toBeNull();
  });
});

describe('describeUpdate — what the prompt actually says', () => {
  it('names the versions when the version moved', () => {
    const res = evaluateUpdate({ latestVersion: '1.6.0', latestBuild: 30 }, '1.5.0', 25, URL)!;
    expect(res.sameVersion).toBe(false);
    expect(describeUpdate(res)).toBe(
      "Version 1.6.0 is available on the Play Store — you're on 1.5.0.",
    );
  });

  it('names the BUILDS when only the build moved — never "1.5.0 → 1.5.0"', () => {
    // The bug this exists for: a new AAB under an unchanged version string told
    // the user an update to the version they were already running was available.
    const res = evaluateUpdate({ latestVersion: '1.5.0', latestBuild: 26 }, '1.5.0', 25, URL)!;
    expect(res.sameVersion).toBe(true);
    expect(res.latestBuild).toBe(26);
    expect(res.currentBuild).toBe(25);
    const sentence = describeUpdate(res);
    expect(sentence).toBe(
      'A newer build of Velocity Rides 1.5.0 is on the Play Store — update 25 → 26.',
    );
    expect(sentence).not.toContain('1.5.0 — ');
  });

  it('still reads sensibly when the config published no version string at all', () => {
    const res = evaluateUpdate({ latestBuild: 26 }, '1.5.0', 25, URL)!;
    expect(res.sameVersion).toBe(true);
    expect(describeUpdate(res)).toContain('update 25 → 26');
  });
});

describe('evaluateUpdate — iOS reads only its own release (App Review, Guideline 4)', () => {
  const APP_STORE = 'https://apps.apple.com/app/id6810774199';

  it('the rejection: an Android build number never prompts an iOS install', () => {
    // 1.9.0 (6) on iOS was told it was behind Android's versionCode 30 and sent
    // to Google Play. With no `ios` release published, iOS must say nothing.
    expect(
      evaluateUpdate({ latestVersion: '1.9.0', latestBuild: 30, storeUrl: URL }, '1.9.0', 6, APP_STORE, 'ios'),
    ).toBeNull();
    expect(
      evaluateUpdate({ latestVersion: '2.0.0', latestBuild: 40 }, '1.9.0', 6, APP_STORE, 'ios'),
    ).toBeNull();
  });

  it('compares against the iOS build and links only to the App Store', () => {
    const res = evaluateUpdate(
      {
        latestVersion: '1.9.0',
        latestBuild: 30,
        storeUrl: URL,
        ios: { latestVersion: '1.9.0', latestBuild: 7, storeUrl: URL },
      },
      '1.9.0',
      6,
      APP_STORE,
      'ios',
    )!;
    expect(res).not.toBeNull();
    expect(res.latestBuild).toBe(7);
    // An admin-typed (here: Play) link is ignored on iOS.
    expect(res.storeUrl).toBe(APP_STORE);
    expect(res.storeName).toBe('App Store');
    expect(describeUpdate(res)).toBe(
      'A newer build of Velocity Rides 1.9.0 is on the App Store — update 6 → 7.',
    );
  });

  it('an iOS install already at the iOS release sees nothing', () => {
    expect(
      evaluateUpdate({ latestBuild: 30, ios: { latestVersion: '1.9.0', latestBuild: 6 } }, '1.9.0', 6, APP_STORE, 'ios'),
    ).toBeNull();
  });

  it('the master switch turns iOS off too', () => {
    expect(
      evaluateUpdate({ enabled: false, ios: { latestVersion: '9.0.0' } }, '1.9.0', 6, APP_STORE, 'ios'),
    ).toBeNull();
    expect(
      evaluateUpdate({ ios: { enabled: false, latestVersion: '9.0.0' } }, '1.9.0', 6, APP_STORE, 'ios'),
    ).toBeNull();
  });

  it('Android ignores the iOS release and keeps its Play wording', () => {
    expect(
      evaluateUpdate({ ios: { latestVersion: '9.0.0', latestBuild: 99 } }, '1.9.0', 30, URL, 'android'),
    ).toBeNull();
    const res = evaluateUpdate({ latestVersion: '1.9.0', latestBuild: 31 }, '1.9.0', 30, URL)!;
    expect(res.storeName).toBe('Play Store');
  });
});
