/**
 * Checks that Vexa reads a sentence the way a person means it.
 *
 * The intent reader is the one piece of real branching logic in the app — the
 * words overlap ("research" contains "search", "boost my post" is an ad, not a
 * post), so it gets a check of its own. Run it with `npm run check`.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Inside the app, so the compiled code can still find react. Deleted below.
const out = join(process.cwd(), '.intent-check');
rmSync(out, { recursive: true, force: true });

try {
  // node runs the compiler directly: spawning npx.cmd is a Windows trap
  execFileSync(
    process.execPath,
    [
      join('node_modules', 'typescript', 'bin', 'tsc'),
      'src/intent.ts',
      '--ignoreConfig',
      '--outDir',
      out,
      '--module',
      'commonjs',
      '--target',
      'es2020',
      '--moduleResolution',
      'node',
      '--skipLibCheck',
      '--esModuleInterop',
    ],
    { stdio: 'pipe' },
  );
} catch (e) {
  // tsc warns about a deprecated flag on exit 2 but still emits; only a
  // missing file is fatal, which the import below would show anyway.
  if (!String(e.stdout ?? '').includes('TS5107')) {
    console.error(String(e.stdout ?? e.message));
  }
}

let read;
try {
  ({ read } = await import(pathToFileURL(join(out, 'intent.js')).href));
} catch (e) {
  rmSync(out, { recursive: true, force: true });
  throw e;
}

/** [what someone types, what she must take from it] */
const cases = [
  ['find me 60 investors on instagram and gmail se email bhejo in Karachi',
    { kind: 'outreach', who: 'Investors', count: 60, city: 'Karachi', channels: ['instagram', 'gmail'] }],
  ['mere liye is hafte ka content likho instagram aur tiktok ke liye', { kind: 'content', channels: ['instagram', 'tiktok'] }],
  ['run ads in Lahore with 1500 a day budget', { kind: 'ads', budget: 1500, city: 'Lahore' }],
  ['research my competitors prices in Karachi', { kind: 'research', city: 'Karachi' }],
  ['unse whatsapp per baat kro', { kind: 'outreach', channels: ['whatsapp'] }],
  ['write to 50 shops in Karachi that could stock us', { kind: 'outreach', who: 'Shops', count: 50 }],
  ['email 100 customers about the winter drop', { kind: 'outreach', who: 'Customers', verb: 'email', count: 100 }],
  ['dhoond k lao kuch creators lahore mein', { kind: 'outreach', who: 'Creators', city: 'Lahore' }],
  ['grow my audience', { kind: 'plan' }],
  ['schedule my reels for next week', { kind: 'content' }],
  ['boost my post with 999 budget', { kind: 'ads', budget: 999 }],
  ['investors', { kind: 'outreach', who: 'Investors' }],
  ['gmail se emails kro customers ko', { kind: 'outreach', who: 'Customers', channels: ['gmail'] }],
  ['compare my prices with inDrive', { kind: 'research' }],
];

let wrong = 0;
for (const [text, want] of cases) {
  const got = read(text);
  for (const [key, value] of Object.entries(want)) {
    const mine = got[key];
    const same = Array.isArray(value) ? JSON.stringify(mine) === JSON.stringify(value) : mine === value;
    if (!same) {
      wrong += 1;
      console.log(`WRONG  "${text}"\n       ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(mine)}`);
    }
  }
}

rmSync(out, { recursive: true, force: true });
console.log(wrong ? `\n${wrong} wrong` : `all ${cases.length} asks understood correctly`);
process.exit(wrong ? 1 : 0);
