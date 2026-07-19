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
