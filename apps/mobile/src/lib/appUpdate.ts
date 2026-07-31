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
 * Android versionCode has to come from the installed binary, because this
 * project uses EAS remote versioning — the build number is not in source at all.
 *
 * That build number is the field that actually matters here. Our releases have
 * repeatedly shipped under an UNCHANGED version string (1.1.0 as vc12, vc13, …),
 * so a check that could only compare version strings could never fire. It is
 * read from `expo-application`, which reports what the running APK was built
 * with. The old path, `Constants.platform.android.versionCode`, is deprecated
 * and — as of expo-constants 56 — permanently dead: the native module hands
 * back `platform: { android: {} }`, so that field is always undefined and every
 * build-number comparison it fed silently evaluated to "not behind".
 * ----------------------------------------------------------------------------
 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../firebase';
import {
  evaluateUpdate,
  parseBuildNumber,
  type AvailableUpdate,
  type VersionConfig,
} from './appUpdateRules';

export type { AvailableUpdate, VersionConfig } from './appUpdateRules';
export { compareVersions, evaluateUpdate, parseBuildNumber } from './appUpdateRules';

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
 * `Application.nativeBuildVersion` is a string ("13") baked into the binary at
 * build time, which is exactly right for EAS remote versioning: it reports the
 * number EAS assigned, not anything in source.
 *
 * Expo Go is excluded deliberately. There it reports Expo Go's OWN version code,
 * a large unrelated number, and comparing that against a published build would
 * make the prompt fire (or refuse to) for reasons having nothing to do with our
 * app. An unknown build number degrades to "compare version strings only", which
 * is the safe direction.
 */
export function currentBuildNumber(): number | null {
  if (Constants.appOwnership === 'expo') return null;
  return parseBuildNumber(Application.nativeBuildVersion);
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
