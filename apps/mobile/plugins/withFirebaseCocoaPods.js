const { withDangerousMod } = require('@expo/config-plugins');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Expo config plugin that forces @react-native-firebase to resolve the
 * firebase-ios-sdk through CocoaPods instead of Swift Package Manager.
 *
 * react-native-firebase 26 defaults to SPM on React Native >= 0.75, and
 * firebase-ios-sdk's Swift Package ships DYNAMIC library products only. We build
 * iOS with `useFrameworks: "static"` (expo-build-properties in app.json), which
 * @react-native-firebase/app itself refuses outright — the first iOS build died
 * in the Install pods phase with:
 *
 *   [!] [react-native-firebase] SPM + static linkage is not supported
 *
 * Left alone it would give every RNFB pod its own copy of the Firebase
 * frameworks and fail much later with duplicate-symbol linker errors, so the
 * pod install stops early instead. The library documents two ways out; this is
 * the second one, and the reason it is the right one here:
 *
 *   1. Switch to `use_frameworks! :linkage => :dynamic` — this would change how
 *      EVERY pod in the app links, not just Firebase's, so it is not a Firebase
 *      fix at all. `forceStaticLinking` in app.json exists precisely because the
 *      Expo modules want static linkage.
 *   2. `$RNFirebaseDisableSPM = true` before any target block — Firebase then
 *      comes from the `Firebase/CoreOnly` and `Firebase/Auth` pods, which
 *      support static linkage, and nothing else about the build changes.
 *
 * The flag is a Podfile-level Ruby global, so there is no app.json property and
 * no plugin option that can set it; it has to be written into the generated
 * Podfile, which is what this plugin does. Android is untouched — a dangerous
 * mod registered for 'ios' never runs for the other platform.
 */
const FLAG = '$RNFirebaseDisableSPM = true';

const PREAMBLE = [
  '# Added by plugins/withFirebaseCocoaPods.js — see that file for the full why.',
  '# firebase-ios-sdk\'s Swift Package is dynamic-only and cannot be combined with',
  '# the static linkage this app builds with, so Firebase comes from CocoaPods.',
  FLAG,
  '',
].join('\n');

module.exports = function withFirebaseCocoaPods(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = readFileSync(podfile, 'utf8');

      // `expo prebuild` run twice over the same ios/ directory would otherwise
      // stack a second copy of the preamble on top of the first.
      if (contents.includes(FLAG)) return cfg;

      // Prepended rather than merely placed above the first `target` block: the
      // global has to be set before anything the Podfile requires can read it,
      // and the require lines at the top are the first thing that does.
      writeFileSync(podfile, PREAMBLE + contents);
      return cfg;
    },
  ]);
};
