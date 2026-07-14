/**
 * Mint a private debug keystore for signing local Android builds.
 *
 * `expo prebuild` ships the React Native template's debug.keystore, which is
 * byte-identical in every RN project and whose private key is published. We can't
 * whitelist that fingerprint on the Google Maps key — it would let anyone build
 * an app calling itself com.velocityridzpk.app and spend our quota. So we sign
 * with a keystore only we have. See plugins/withDebugKeystore.js.
 *
 *   npm run keystore:debug
 *
 * Refuses to overwrite an existing keystore: replacing it changes the app's
 * signature, which means every device with the old build installed can no longer
 * upgrade in place (Android rejects a signature change) and the SHA-1 whitelisted
 * on the Maps key goes stale. Pass --force if that is genuinely what you want.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const keystore = join(projectRoot, 'credentials', 'velocity-debug.keystore');
const force = process.argv.includes('--force');

if (existsSync(keystore) && !force) {
  console.log(`✓ Keystore already exists: ${keystore}`);
  console.log('  Nothing to do. (Re-minting would break in-place upgrades — pass --force if you mean it.)\n');
  printFingerprint();
  process.exit(0);
}

mkdirSync(dirname(keystore), { recursive: true });

// Alias and passwords deliberately match the RN template's, so the generated
// android/app/build.gradle needs no patching. The secrecy is in the private key,
// not the password — this file is gitignored and never leaves your machine.
execFileSync(
  'keytool',
  [
    '-genkeypair', '-v',
    '-keystore', keystore,
    '-alias', 'androiddebugkey',
    '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10950', // 30 years — outliving the debug key is nobody's idea of fun
    '-storepass', 'android',
    '-keypass', 'android',
    '-dname', 'CN=Velocity Debug, OU=Velocity, O=Velocity, L=Islamabad, ST=Islamabad, C=PK',
  ],
  { stdio: 'inherit' },
);

console.log(`\n✓ Created ${keystore}`);
printFingerprint();

function printFingerprint() {
  const out = execFileSync(
    'keytool',
    ['-list', '-v', '-keystore', keystore, '-storepass', 'android', '-alias', 'androiddebugkey'],
    { encoding: 'utf8' },
  );
  const sha1 = out.match(/SHA1:\s*([A-F0-9:]+)/i)?.[1];

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('  SHA-1:', sha1 ?? '(could not read)');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('  Whitelist this on the Google Maps Android key:');
  console.log('  Cloud Console → Credentials → the Android key →');
  console.log('  Application restrictions → Android apps → Add');
  console.log('    package: com.velocityridzpk.app');
  console.log(`    SHA-1:   ${sha1 ?? '<see above>'}`);
  console.log('\n  Then: npx expo prebuild -p android   (installs it into android/)\n');
}
