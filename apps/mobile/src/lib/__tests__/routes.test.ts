/**
 * Every navigation target in the app must name a route that exists.
 *
 * This suite exists because of a single line in WalletScreen: a locked driver's
 * "Settle commission →" button called `router.replace('/driver')`, and there is
 * no `/driver` route — only `/driver/home`. Nothing caught it. It typechecks
 * (expo-router's typed routes are not switched on here), it lints, and the only
 * way to see it is to be a driver who owes money and press the button.
 *
 * So the route table is derived from the filesystem the way expo-router derives
 * it, every literal navigation target in `app/` and `src/` is collected, and the
 * two are checked against each other. A dynamic segment (`[id]`) accepts
 * anything, including a `${...}` hole in a template literal, because the value
 * is only known at runtime; what is being checked is the SHAPE of the path.
 *
 * What this cannot see: targets built by string concatenation, and targets that
 * come back from the server. `routeForNotification` is the important case of the
 * second kind, and it is covered directly in notificationRoute.test.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const MOBILE = resolve(__dirname, '../../..');
const APP = join(MOBILE, 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const posix = (path: string) => path.split(sep).join('/');

/** The route table, derived from `app/` the way expo-router derives it. */
function routeTable(): string[] {
  const routes: string[] = [];
  for (const file of walk(APP)) {
    if (!/\.(tsx|ts)$/.test(file)) continue;
    const rel = posix(relative(APP, file)).replace(/\.(tsx|ts)$/, '');
    const base = rel.split('/').pop() as string;
    // `_layout` is not navigable; `+not-found` / `+html` are expo-router specials.
    if (base.startsWith('_') || rel.includes('+')) continue;
    const route = ('/' + rel).replace(/\/index$/, '').replace(/\/\([^)]+\)/g, '');
    routes.push(route || '/');
  }
  return routes;
}

const ROUTES = routeTable();

/** A `${...}` hole, or any other value, standing in a dynamic segment. */
const HOLE = '\u0000';

function isRoute(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  return ROUTES.some((route) => {
    const parts = route.split('/').filter(Boolean);
    const catchAllAt = parts.findIndex((p) => p.startsWith('[...') || p.startsWith('[['));
    if (catchAllAt >= 0) {
      return parts.slice(0, catchAllAt).every((p, i) => p === segments[i]);
    }
    if (parts.length !== segments.length) return false;
    return parts.every((part, i) => {
      if (part.startsWith('[') && part.endsWith(']')) return true; // dynamic slot
      return part === segments[i];
    });
  });
}

interface Target {
  file: string;
  line: number;
  raw: string;
  path: string;
}

/**
 * `router.push('/x')`, `router.replace(\`/x/${id}\`)`, `href="/x"` and friends.
 * Only absolute targets are collected — a relative one is resolved against the
 * current route at runtime and has no fixed shape to check.
 */
const TARGET = new RegExp(
  [
    String.raw`(?:router|nav|navigation)\s*\.\s*(?:push|replace|navigate|prefetch)\s*\(\s*['"\`]([^'"\`]+)['"\`]`,
    String.raw`(?:href|pathname)\s*[:=]\s*\{?\s*['"\`]([^'"\`]+)['"\`]`,
  ].join('|'),
  'g',
);

function collectTargets(): Target[] {
  const files = [...walk(APP), ...walk(join(MOBILE, 'src'))].filter((f) => /\.(tsx|ts)$/.test(f));
  const found: Target[] = [];
  for (const file of files) {
    // This suite walks the source; reading its own fixtures back would be noise.
    if (file.includes('__tests__')) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const re = new RegExp(TARGET.source, 'g');
        let match: RegExpExecArray | null;
        while ((match = re.exec(line))) {
          const raw = match[1] ?? match[2];
          if (!raw || !raw.startsWith('/')) continue;
          // `noUncheckedIndexedAccess` is on, so split()[0] is string|undefined.
          const path =
            raw
              .replace(/[?#].*$/, '')
              .replace(/\$\{[^}]*\}/g, HOLE)
              .replace(/\/$/, '') || '/';
          found.push({ file: posix(relative(MOBILE, file)), line: index + 1, raw, path });
        }
      });
  }
  return found;
}

describe('app routes', () => {
  it('derives a route table from the filesystem', () => {
    // A sanity floor: if the walk breaks, every other assertion here passes
    // vacuously and the suite becomes decoration.
    expect(ROUTES.length).toBeGreaterThan(50);
    expect(ROUTES).toContain('/passenger/home');
    expect(ROUTES).toContain('/driver/home');
    expect(ROUTES).toContain('/passenger/trip/[id]');
    // The one that started this: there is no bare '/driver'.
    expect(ROUTES).not.toContain('/driver');
  });

  it('points every navigation target at a route that exists', () => {
    const targets = collectTargets();
    expect(targets.length).toBeGreaterThan(50);

    const broken = targets
      .filter((t) => !isRoute(t.path))
      .map((t) => `${t.file}:${t.line} → ${t.raw}`);

    expect(broken).toEqual([]);
  });
});
