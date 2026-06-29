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

    return c;
  });
};
