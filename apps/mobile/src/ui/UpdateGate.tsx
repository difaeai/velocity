/**
 * Shows the "update available" prompt — and only ever when one is.
 *
 * Mounted once at the root, above the routes, so the prompt reaches whichever
 * screen the app happened to open on (passenger home, driver home, a deep link
 * from a notification) without every screen having to ask.
 *
 * The rules it enforces, in order of how badly each would hurt if broken:
 *
 *  1. No update, no dialogue. `checkForAppUpdate` returns null for a missing
 *     config doc, a disabled one, or a build that is already current — and null
 *     means nothing is rendered and nothing is asked. There is no "check
 *     failed, prompt anyway" path.
 *  2. Once per app launch. A module-level flag, not component state: the root
 *     layout remounts its subtree whenever the theme or language changes, and a
 *     dialogue that reappeared on every theme toggle would be unbearable.
 *  3. It waits for sign-in, because `config/*` is readable by signed-in users
 *     only. Asking earlier would just fail the read and, per rule 1, show
 *     nothing at all.
 *
 * Renders no UI of its own — the prompt is a native Alert, which sits above the
 * whole app and needs no layout of ours.
 */
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { checkForAppUpdate, type AvailableUpdate } from '../lib/appUpdate';

/** One prompt per app process. Survives the root layout's theme/language remounts. */
let promptedThisLaunch = false;

/** For tests / manual re-checks after a sign-out → sign-in cycle. */
export function resetUpdatePromptForTesting(): void {
  promptedThisLaunch = false;
}

async function openStore(url: string): Promise<void> {
  // The Play Store app handles market:// directly, which skips the browser
  // bounce. Falls back to the https listing when it isn't installed.
  if (Platform.OS === 'android') {
    const marketUrl = url.replace(
      /^https?:\/\/play\.google\.com\/store\/apps\/details/,
      'market://details',
    );
    if (marketUrl !== url) {
      try {
        await Linking.openURL(marketUrl);
        return;
      } catch {
        // Play Store app missing — fall through to the web listing.
      }
    }
  }
  await Linking.openURL(url).catch(() => {});
}

function prompt(update: AvailableUpdate): void {
  const body = [
    `Version ${update.latestVersion} is available on the Play Store — you're on ${update.currentVersion}.`,
    update.releaseNotes,
    update.mandatory
      ? 'This update is required to keep using Velocity.'
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  Alert.alert(
    update.mandatory ? 'Update required' : 'Update available',
    body,
    update.mandatory
      ? [{ text: 'Update now', onPress: () => void openStore(update.storeUrl) }]
      : [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Update', onPress: () => void openStore(update.storeUrl) },
        ],
    // A required update has no way out; an optional one dismisses normally.
    { cancelable: !update.mandatory },
  );
}

export function UpdateGate() {
  const { user, initializing } = useAuth();

  useEffect(() => {
    if (initializing || !user || promptedThisLaunch) return;
    // Web has no store listing to send anyone to.
    if (Platform.OS === 'web') return;

    let cancelled = false;
    // Claimed before the async work so two rapid auth callbacks can't both fire
    // a prompt. The check is cheap to skip and expensive to double up.
    promptedThisLaunch = true;

    checkForAppUpdate().then((update) => {
      if (cancelled || !update) return;
      prompt(update);
    });

    return () => {
      cancelled = true;
    };
  }, [user, initializing]);

  return null;
}
