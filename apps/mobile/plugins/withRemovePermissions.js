const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo config plugin that strips unwanted permissions injected by third-party
 * libraries (e.g. expo-image-picker pulls in RECORD_AUDIO for video capture).
 *
 * `app.json` `android.permissions` only controls permissions WE declare — it
 * cannot remove ones a dependency merges in. We add a `tools:node="remove"`
 * directive so the Android manifest merger drops them from the final manifest.
 */
const PERMISSIONS_TO_REMOVE = ['android.permission.RECORD_AUDIO'];

module.exports = function withRemovePermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Ensure the `tools` namespace is declared on <manifest>.
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    manifest['uses-permission'] = manifest['uses-permission'] || [];

    for (const name of PERMISSIONS_TO_REMOVE) {
      // Drop any existing declaration of this permission…
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (perm) => perm.$ && perm.$['android:name'] !== name
      );
      // …then add an explicit remove directive for the merger.
      manifest['uses-permission'].push({
        $: { 'android:name': name, 'tools:node': 'remove' },
      });
    }

    return cfg;
  });
};
