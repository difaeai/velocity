const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Expo config plugin that sets Android gradle.properties values that would
 * otherwise be wiped on every `expo prebuild --clean`.
 */
module.exports = function withGradleConfig(config) {
  return withGradleProperties(config, (c) => {
    const props = c.modResults;

    const set = (key, value) => {
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    // Increase Gradle JVM heap — prevents Worker Daemon crash on large projects
    set('org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError');
    // Limit parallel workers to avoid memory contention
    set('org.gradle.workers.max', '2');
    // Build only arm64-v8a for debug (all modern Android phones) — cuts build time by 75%
    set('reactNativeArchitectures', 'arm64-v8a');

    // Minify (and therefore obfuscate) release builds with R8. Google Play
    // grades an app on how much of its DEX is obfuscated and warns below 25%;
    // with this off Velocity measured 1%, which Play flags as able to affect
    // visibility and publishing. The keep rules R8 needs to not rename the
    // reflective parts of React Native out from under themselves are appended
    // by plugins/withProguardRules.js — the two must be changed together.
    //
    // Only minification is enabled: `android.enableShrinkResourcesInReleaseBuilds`
    // is a different Play metric and a different risk (it drops resources that
    // are only ever looked up by name), so it stays off until it is asked for.
    set('android.enableMinifyInReleaseBuilds', 'true');

    // NOTE: do NOT set 'android.kotlinVersion' here to satisfy a dependency that
    // wants a newer Kotlin. It moves kotlin-stdlib/reflect but NOT the Kotlin
    // compiler, which Expo 56 pins separately at 2.1.20 — the result is a 2.3.0
    // stdlib being read by a 2.1.0 compiler, which breaks EVERY Kotlin module
    // (expo-modules-core, gesture-handler, …) instead of just the one. The
    // compiler reads metadata up to 2.2.0, so pin the offending dependency down
    // rather than the toolchain up. See react-native-google-mobile-ads in
    // package.json, held at a release whose play-services-ads is 2.2-compatible.

    return c;
  });
};
