#!/usr/bin/env node
/**
 * Patches node_modules files that are incompatible with Gradle 9+ / expo-modules-core v56.
 * Runs automatically after every `npm install` via the "postinstall" script in package.json.
 *
 * Targets:
 *   expo-firebase-core/android/build.gradle
 *   expo-firebase-core/node_modules/expo-constants/android/build.gradle
 *
 * Changes:
 *   - `classifier = 'sources'` → `archiveClassifier.set('sources')`  (removed in Gradle 9)
 *   - Guard `from components.release` with null-check  (SoftwareComponent not found error)
 */

const fs = require('fs');
const path = require('path');

const targets = [
  'node_modules/expo-firebase-core/android/build.gradle',
  'node_modules/expo-firebase-core/node_modules/expo-constants/android/build.gradle',
];

const OLD_CLASSIFIER = `task androidSourcesJar(type: Jar) {
  classifier = 'sources'`;

const NEW_CLASSIFIER = `task androidSourcesJar(type: Jar) {
  archiveClassifier.set('sources')`;

const OLD_PUBLISHING = `afterEvaluate {
  publishing {
    publications {
      release(MavenPublication) {
        from components.release
        // Add additional sourcesJar to artifacts
        artifact(androidSourcesJar)
      }
    }
    repositories {
      maven {
        url = mavenLocal().url
      }
    }
  }
}`;

const NEW_PUBLISHING = `afterEvaluate {
  if (components.findByName('release') != null) {
    publishing {
      publications {
        release(MavenPublication) {
          from components.release
          artifact(androidSourcesJar)
        }
      }
      repositories {
        maven {
          url = mavenLocal().url
        }
      }
    }
  }
}`;

let patched = 0;
let skipped = 0;

for (const rel of targets) {
  const file = path.join(__dirname, '..', rel);
  if (!fs.existsSync(file)) { skipped++; continue; }

  let content = fs.readFileSync(file, 'utf8');
  const original = content;

  content = content.replace(OLD_CLASSIFIER, NEW_CLASSIFIER);
  content = content.replace(OLD_PUBLISHING, NEW_PUBLISHING);

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`  patched: ${rel}`);
    patched++;
  } else {
    console.log(`  already patched: ${rel}`);
    skipped++;
  }
}

console.log(`postinstall: ${patched} file(s) patched, ${skipped} skipped.`);
