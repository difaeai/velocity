const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

/**
 * Install OUR debug keystore over the React Native template's.
 *
 * WHY THIS EXISTS
 * `expo prebuild` writes a debug.keystore into android/app/ — but it is *the
 * React Native template's* keystore. That file is byte-identical in every RN
 * project on earth and its private key is published in the RN repo, so its SHA-1
 * (5E:8F:16:...:F6:25) identifies nobody.
 *
 * That matters because the Google Maps key shipped in the app is restricted to
 * "package com.velocityridzpk.app signed by <SHA-1>". Whitelisting the template's
 * fingerprint would let anyone on earth build an app calling itself
 * com.velocityridzpk.app, sign it with the public keystore, and spend our Maps
 * quota. The restriction would be decoration.
 *
 * So we sign debug builds with a keystore only we have, and whitelist *that*.
 *
 * WHY A PLUGIN AND NOT JUST A FILE
 * android/ is gitignored and regenerated: `expo prebuild --clean` would drop the
 * template keystore straight back on top of ours, silently, and the next local
 * build would go out signed with the public key again. A plugin runs on every
 * prebuild, so the swap cannot be forgotten.
 *
 * The keystore keeps the template's alias and passwords (androiddebugkey /
 * android), so android/app/build.gradle needs no change at all — the secrecy
 * comes from the private key not being public, not from the password.
 *
 * NOT IN GIT. credentials/ is gitignored (*.keystore). On a fresh clone the file
 * is absent, this plugin warns and leaves the template keystore in place — the
 * build still works, it is just signed with the public key and Maps will refuse
 * it. Run `npm run keystore:debug` to mint a new one, then whitelist its SHA-1.
 */
const KEYSTORE_REL = 'credentials/velocity-debug.keystore';

module.exports = function withDebugKeystore(config) {
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const source = path.join(c.modRequest.projectRoot, KEYSTORE_REL);
      const target = path.join(c.modRequest.platformProjectRoot, 'app', 'debug.keystore');

      if (!fs.existsSync(source)) {
        console.warn(
          `\n⚠️  ${KEYSTORE_REL} not found — debug builds will be signed with the PUBLIC ` +
            'React Native template keystore, and Google Maps will reject them.\n' +
            '   Run: npm run keystore:debug   (then whitelist the printed SHA-1 on the Maps key)\n',
        );
        return c;
      }

      fs.copyFileSync(source, target);
      console.log('✓ Signed debug builds with the private Velocity debug keystore.');
      return c;
    },
  ]);
};
