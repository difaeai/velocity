const { withDangerousMod } = require('@expo/config-plugins');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// ProGuard comments are '#'. A '//' marker is not a comment to R8, it is a
// syntax error ("Expected char '-'") that fails minifyReleaseWithR8 before it
// reads a single rule — so these two lines must never be "tidied" into JS-style
// comments to match the rest of this file.
const START = '# @generated begin velocity-proguard-rules';
const END = '# @generated end velocity-proguard-rules';

/**
 * Expo config plugin that appends plugins/proguard-rules.pro to the generated
 * android/app/proguard-rules.pro.
 *
 * Release builds are minified (see plugins/withGradleConfig.js), which is what
 * lifts the obfuscation percentage Google Play grades an app on. R8 renames
 * everything it cannot prove is reachable by name, so the rules that protect
 * the reflective corners of React Native have to be in the file BEFORE the
 * release build runs — and `expo prebuild` rewrites that file from the Expo
 * template every time, which is why the real rules live in git under plugins/
 * and get re-appended here instead of being edited in android/ by hand.
 *
 * The block is fenced by marker comments and rewritten rather than appended
 * blindly, so running prebuild twice without --clean cannot stack duplicates.
 */
module.exports = function withProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const rules = readFileSync(join(cfg.modRequest.projectRoot, 'plugins/proguard-rules.pro'), 'utf8');
      const target = join(cfg.modRequest.platformProjectRoot, 'app/proguard-rules.pro');
      const existing = readFileSync(target, 'utf8');

      const block = `${START}\n${rules.trim()}\n${END}\n`;
      const at = existing.indexOf(START);
      const contents =
        at === -1
          ? `${existing.trimEnd()}\n\n${block}`
          : `${existing.slice(0, at)}${block}${existing.slice(existing.indexOf(END) + END.length).trimStart()}`;

      writeFileSync(target, contents);
      return cfg;
    },
  ]);
};
