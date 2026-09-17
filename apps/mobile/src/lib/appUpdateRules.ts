/**
 * The pure decision behind the update prompt: given what the admin published and
 * what this build is, is there actually a newer version?
 *
 * Split out from `appUpdate.ts` (which reaches for expo-constants and Firestore)
 * so the rule can be unit-tested on its own. This is the code where a mistake is
 * expensive in both directions — a false positive nags every user to "update" to
 * the version they are already running, a false negative leaves them stranded on
 * an old build — so it is deliberately free of I/O.
 */

/** Which store a build was installed from — decides what it compares against. */
export type StorePlatform = 'android' | 'ios';

/** The published release for ONE store. */
export interface PlatformVersionConfig {
  enabled?: boolean;
  latestVersion?: string;
  latestBuild?: number;
  minSupportedVersion?: string;
  releaseNotes?: string;
  storeUrl?: string;
}

/**
 * Shape of `config/appVersion`, as written by the admin console.
 *
 * The top-level fields are the Play Store release (they predate iOS and every
 * shipped Android build reads them there). The App Store release lives under
 * `ios`, and it has to be separate: EAS numbers builds per platform, so Android
 * sits at versionCode 30-something while iOS is at build 6. An iOS install that
 * compared itself against the Android number was told it was out of date and
 * sent to Google Play — which is exactly what App Review rejected 1.9.0 (6) for
 * under Guideline 4.
 */
export interface VersionConfig extends PlatformVersionConfig {
  ios?: PlatformVersionConfig;
}

export interface AvailableUpdate {
  /** Version string as published by the admin, e.g. "1.2.0". */
  latestVersion: string;
  /** The version this install is running, for "1.1.0 → 1.2.0" copy. */
  currentVersion: string;
  /**
   * Build numbers, when both sides know them.
   *
   * Our releases repeatedly ship under an UNCHANGED version string (1.5.0 as
   * vc25, vc26, …), and on those the version string is identical on both sides
   * — so a prompt written only in version strings says "1.5.0 is available,
   * you're on 1.5.0", which reads as a bug and teaches users to dismiss the
   * prompt. The build numbers are the only thing that actually differs, so the
   * copy has to be able to reach for them. See `describeUpdate`.
   */
  latestBuild: number | null;
  currentBuild: number | null;
  /** True when the only difference is the build number, not the version string. */
  sameVersion: boolean;
  /** Optional admin-written "what's new" blurb. */
  releaseNotes: string | null;
  /** Where the Update button sends the user. */
  storeUrl: string;
  /** "Play Store" / "App Store", for the prompt copy. */
  storeName: string;
  /**
   * True when the running build is below the published minimum. The prompt then
   * drops its Cancel button — reserved for releases that genuinely cannot
   * interoperate (a breaking backend change), not for nagging.
   */
  mandatory: boolean;
}

/**
 * Coerces a reported build number to a comparable integer, or null when the
 * platform could not report one.
 *
 * Kept here, pure, because the value arrives as a *string* from
 * `expo-application` ("13") and as a number from the old expo-constants field,
 * and because the failure mode matters: anything that isn't a positive whole
 * number must read as "unknown" — never as 0, which would look like a build
 * older than every published one and nag every install forever.
 */
export function parseBuildNumber(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // Digits only: "13" is a build number, "1.1.0" and "13-beta" are not.
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Compares dotted numeric version strings. Returns >0 if `a` is newer than `b`,
 * 0 if they are equal, <0 if older. Missing segments count as 0, so "1.2" and
 * "1.2.0" are the same version. Non-numeric junk in a segment reads as 0 rather
 * than NaN — a malformed config value must not decide that an update exists.
 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = parseInt(pa[i] ?? '0', 10) || 0;
    const nb = parseInt(pb[i] ?? '0', 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Decides whether the running build is behind.
 *
 * Returns null — meaning "show nothing" — for every case that is not a genuine,
 * published, newer version: no config, `enabled: false`, no version or build
 * published at all, or a build that is already current or ahead.
 *
 * `build` is the running build number (Android versionCode / iOS
 * CFBundleVersion), or null when this build cannot report one. Build numbers
 * are therefore only compared when BOTH sides are known; the version string is
 * the path that always works.
 *
 * `platform` picks the release to compare against. iOS only ever reads
 * `cfg.ios` — never the top-level Play release, whose build numbers mean
 * nothing on iOS — and only ever sends the user to `storeUrl` as given (the App
 * Store product page), ignoring any admin-typed link: App Review requires the
 * Update button to open the app's App Store page and nothing else.
 */
export function evaluateUpdate(
  cfg: VersionConfig | undefined | null,
  version: string,
  build: number | null,
  storeUrl: string,
  platform: StorePlatform = 'android',
): AvailableUpdate | null {
  if (!cfg) return null;
  // Master switch: off means off on every platform.
  if (cfg.enabled === false) return null;

  const release: PlatformVersionConfig | undefined = platform === 'ios' ? cfg.ios : cfg;
  if (!release || typeof release !== 'object') return null;
  // Not published yet, or deliberately switched off: say nothing.
  if (release.enabled === false) return null;

  const latestVersion =
    typeof release.latestVersion === 'string' ? release.latestVersion.trim() : '';
  const latestBuild =
    typeof release.latestBuild === 'number' && Number.isFinite(release.latestBuild)
      ? release.latestBuild
      : null;

  // Nothing to compare against at all.
  if (!latestVersion && latestBuild === null) return null;

  const versionBehind = !!latestVersion && compareVersions(latestVersion, version) > 0;
  // Only meaningful when this build actually knows its own number.
  const buildBehind = latestBuild !== null && build !== null && latestBuild > build;

  if (!versionBehind && !buildBehind) return null;

  const minVersion =
    typeof release.minSupportedVersion === 'string' ? release.minSupportedVersion.trim() : '';
  const url =
    platform === 'android' && typeof release.storeUrl === 'string' && release.storeUrl.trim()
      ? release.storeUrl.trim()
      : storeUrl;

  return {
    latestVersion: latestVersion || version,
    currentVersion: version,
    latestBuild,
    currentBuild: build,
    // `versionBehind` is the only way the version strings can differ here:
    // reaching this line without it means the build gap is the whole story.
    sameVersion: !versionBehind,
    releaseNotes:
      typeof release.releaseNotes === 'string' && release.releaseNotes.trim()
        ? release.releaseNotes.trim()
        : null,
    storeUrl: url,
    storeName: platform === 'ios' ? 'App Store' : 'Play Store',
    mandatory: !!minVersion && compareVersions(minVersion, version) > 0,
  };
}

/**
 * The sentence the prompt leads with.
 *
 * Pure and here, rather than inline in the Alert, because getting it wrong is
 * how the prompt stopped making sense: a same-version release told people that
 * "1.5.0 is available" while they were already on 1.5.0, which is not an update
 * notice, it is a contradiction. Whatever actually moved is what the sentence
 * names — the version when the version moved, the build when only the build did.
 */
export function describeUpdate(update: AvailableUpdate): string {
  if (!update.sameVersion) {
    return `Version ${update.latestVersion} is available on the ${update.storeName} — you're on ${update.currentVersion}.`;
  }
  // Same version string, so the build numbers are the difference. `evaluateUpdate`
  // only returns a same-version update when both builds are known, but the
  // fallback keeps a malformed config from producing "you're on null".
  if (update.latestBuild !== null && update.currentBuild !== null) {
    return (
      `A newer build of Velocity Rides ${update.latestVersion} is on the ${update.storeName} — ` +
      `update ${update.currentBuild} → ${update.latestBuild}.`
    );
  }
  return `A newer build of Velocity Rides ${update.latestVersion} is available on the ${update.storeName}.`;
}
