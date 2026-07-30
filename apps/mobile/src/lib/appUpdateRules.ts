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

/** Shape of `config/appVersion`, as written by the admin console. */
export interface VersionConfig {
  enabled?: boolean;
  latestVersion?: string;
  latestBuild?: number;
  minSupportedVersion?: string;
  releaseNotes?: string;
  storeUrl?: string;
}

export interface AvailableUpdate {
  /** Version string as published by the admin, e.g. "1.2.0". */
  latestVersion: string;
  /** The version this install is running, for "1.1.0 → 1.2.0" copy. */
  currentVersion: string;
  /** Optional admin-written "what's new" blurb. */
  releaseNotes: string | null;
  /** Where the Update button sends the user. */
  storeUrl: string;
  /**
   * True when the running build is below the published minimum. The prompt then
   * drops its Cancel button — reserved for releases that genuinely cannot
   * interoperate (a breaking backend change), not for nagging.
   */
  mandatory: boolean;
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
 * `build` is the running Android versionCode, or null when this build cannot
 * report one (EAS remote versioning keeps it out of source). Build numbers are
 * therefore only compared when BOTH sides are known; the version string is the
 * path that always works.
 */
export function evaluateUpdate(
  cfg: VersionConfig | undefined | null,
  version: string,
  build: number | null,
  fallbackStoreUrl: string,
): AvailableUpdate | null {
  if (!cfg) return null;
  // Not published yet, or deliberately switched off: say nothing.
  if (cfg.enabled === false) return null;

  const latestVersion = typeof cfg.latestVersion === 'string' ? cfg.latestVersion.trim() : '';
  const latestBuild =
    typeof cfg.latestBuild === 'number' && Number.isFinite(cfg.latestBuild) ? cfg.latestBuild : null;

  // Nothing to compare against at all.
  if (!latestVersion && latestBuild === null) return null;

  const versionBehind = !!latestVersion && compareVersions(latestVersion, version) > 0;
  // Only meaningful when this build actually knows its own number.
  const buildBehind = latestBuild !== null && build !== null && latestBuild > build;

  if (!versionBehind && !buildBehind) return null;

  const minVersion =
    typeof cfg.minSupportedVersion === 'string' ? cfg.minSupportedVersion.trim() : '';
  const storeUrl =
    typeof cfg.storeUrl === 'string' && cfg.storeUrl.trim() ? cfg.storeUrl.trim() : fallbackStoreUrl;

  return {
    latestVersion: latestVersion || version,
    currentVersion: version,
    releaseNotes:
      typeof cfg.releaseNotes === 'string' && cfg.releaseNotes.trim()
        ? cfg.releaseNotes.trim()
        : null,
    storeUrl,
    mandatory: !!minVersion && compareVersions(minVersion, version) > 0,
  };
}
