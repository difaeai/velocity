/**
 * Expo config plugin: pin the `foojay-resolver-convention` Gradle plugin to a
 * version that works with Gradle 9.
 *
 * React Native's Android template ships an older foojay-resolver-convention
 * (0.5.x) that references `JvmVendorSpec.IBM_SEMERU`, a constant removed in
 * Gradle 9.0. With the Gradle 9.x that RN 0.85 downloads, the Android build
 * fails at configuration time. Bumping foojay to 1.0.0 drops that reference.
 *
 * Refs:
 *   facebook/react-native#55781, facebook/react-native#54160,
 *   gradle/foojay-toolchains#105
 */
const { withSettingsGradle } = require('expo/config-plugins');

const FOOJAY_VERSION = '1.0.0';

module.exports = function withFoojayResolverFix(config) {
  return withSettingsGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /(foojay-resolver-convention["']?\)?\s+version\s*\(?\s*["'])([0-9]+(?:\.[0-9]+)*)(["'])/,
      (_match, prefix, _version, suffix) => `${prefix}${FOOJAY_VERSION}${suffix}`,
    );
    return cfg;
  });
};
