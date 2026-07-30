/**
 * "There's a newer version on the Play Store" — the check behind the update prompt.
 * ----------------------------------------------------------------------------
 * WHY A CONFIG DOC AND NOT THE PLAY API
 * -------------------------------------
 * Google's in-app-update API is a native Play Core module. Wiring it in means a
 * new native dependency and a fresh native build before anything works at all —
 * and it would still be dead weight on any install that didn't come from Play.
 * The version that is live on the store is one number that someone already knows
 * at release time, so we publish it to `config/appVersion` (admin console →
 * "App version") and let every running install compare itself against it.
 *
 * The rule the caller depends on: this resolves to `null` unless a newer version
 * genuinely exists. No config doc, an unpublished doc, a build that is already
 * current or ahead, a failed read — all `null`, so the prompt never appears. The
 * decision itself lives in `appUpdateRules` and is unit-tested there.
 *
 * WHAT THE RUNNING BUILD KNOWS ABOUT ITSELF
 * -----------------------------------------
 * `Constants.expoConfig.version` (app.json `version`) is always there. The
 * Android versionCode is not: this project uses EAS remote versioning, so the
 * build number lives on EAS rather than in source, and the only runtime path to
 * it is a deprecated Constants field that may be absent. So build numbers are
 * compared ONLY when both sides are actually known, and the version string is
 * the reliable path. Publish `latestVersion` for that reason; `latestBuild` is
 * there for the case of shipping a new build under an unchanged version string.
 * ----------------------------------------------------------------------------
 */
import Constants from 'expo-constants';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../firebase';
import { evaluateUpdate, type AvailableUpdate, type VersionConfig } from './appUpdateRules';

export type { AvailableUpdate, VersionConfig } from './appUpdateRules';
export { compareVersions, evaluateUpdate } from './appUpdateRules';

/** Play Store listing for the Android package (matches app.json android.package). */
const ANDROID_PACKAGE = 'com.velocityridzpk.app';
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/** The version string of the running build. */
export function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/**
 * The running build's Android versionCode, or null when this build can't tell us.
 *
 * Deprecated in expo-constants and absent in some execution environments, hence
 * the defensive read: an unknown build number must degrade to "compare version
 * strings only", never to a wrong comparison.
 */
export function currentBuildNumber(): number | null {
  const code: unknown = Constants.platform?.android?.versionCode;
  return typeof code === 'number' && Number.isFinite(code) ? code : null;
}

/**
 * Reads the published version and reports an update only if one exists.
 *
 * Never throws: an offline handset, a rules change, a missing doc — all resolve
 * to `null`. A failed check must leave the app exactly as it was.
 */
export async function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  try {
    const snap = await getDoc(doc(db, 'config', 'appVersion'));
    if (!snap.exists()) return null;
    return evaluateUpdate(
      snap.data() as VersionConfig,
      currentAppVersion(),
      currentBuildNumber(),
      PLAY_URL,
    );
  } catch {
    return null;
  }
}
