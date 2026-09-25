/**
 * Applies the Firestore TTL policies this project requires, and asserts the ones
 * it must NOT have.
 *
 * WHY THIS IS A SCRIPT AND NOT A CONSOLE STEP
 * The console's TTL form only offers collections that already hold documents, and
 * the one policy we cannot do without — `mapsCache.expireAt` — has to exist
 * *before* the first address is cached, because it is the mechanism that keeps us
 * inside Google's licence. That is a chicken-and-egg the console cannot resolve.
 * The Firestore Admin API has no such restriction: a field-level config can be
 * written for a collection group with nothing in it yet.
 *
 * It is also the wrong shape for a console step in general. A TTL policy that
 * discharges a legal obligation should not live only in somebody's memory of
 * having clicked something once — a restored project or a second environment would
 * start without it and nothing would say so.
 *
 * WHAT IT DOES NOT TOUCH, AND WHY THAT IS CHECKED RATHER THAN ASSUMED
 * `mapsPlaceIds` holds place IDs, which Google expressly permits storing
 * indefinitely and which are what make a repeat address lookup cost $5 per 1,000
 * instead of $32. `velocityLocations` holds coordinates measured by our own
 * drivers' phones — ours outright. Expiring either would be paying Google more for
 * nothing, and in the second case destroying our own data. So the script asserts
 * both are policy-free and exits non-zero if they are not.
 *
 * USAGE
 *   node scripts/set-firestore-ttl.mjs
 *
 * Credentials, in order of preference:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json   (CI, or any machine)
 *   ./velocity-fe379-firebase-adminsdk-*.json          (the repo-root key, gitignored)
 *
 * Needs `datastore.indexes.update` — the Firebase Admin SDK service account has it.
 * No npm dependencies: the service-account JWT is signed with node:crypto so this
 * runs from a bare checkout.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createSign } from 'node:crypto';

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? 'velocity-fe379';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

/** Collection groups that MUST expire, and the timestamp field that drives it. */
const TTL_TARGETS = [
  {
    collectionGroup: 'mapsCache',
    field: 'expireAt',
    why: 'Google Maps coordinates — the licence allows 30 days, then requires deletion.',
  },
];

/** Collection groups that must NEVER expire. Verified, not written. */
const MUST_NOT_EXPIRE = [
  { collectionGroup: 'mapsPlaceIds', why: 'Place IDs are licence-exempt and may be kept forever.' },
  { collectionGroup: 'velocityLocations', why: 'First-party coordinates. Ours outright.' },
];

function loadKey() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicit) return JSON.parse(readFileSync(explicit, 'utf8'));

  const local = readdirSync('.').find(
    (f) => f.startsWith(`${PROJECT}-firebase-adminsdk-`) && f.endsWith('.json'),
  );
  if (local) return JSON.parse(readFileSync(local, 'utf8'));

  console.error(
    'No credentials. Set GOOGLE_APPLICATION_CREDENTIALS, or run from the repo root\n' +
      `where ${PROJECT}-firebase-adminsdk-*.json lives.`,
  );
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessToken() {
  const key = loadKey();
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

const token = await accessToken();
const base = `projects/${PROJECT}/databases/(default)`;

async function api(method, path, body) {
  const res = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, json: { raw: text } };
  }
}

let failed = false;

for (const { collectionGroup, field, why } of TTL_TARGETS) {
  const fieldPath = `${base}/collectionGroups/${collectionGroup}/fields/${field}`;
  const before = await api('GET', fieldPath);
  const had = before.json?.ttlConfig ?? null;

  if (had && had.state !== 'NEEDS_REPAIR') {
    console.log(`= ${collectionGroup}.${field} already has a policy (${had.state}). ${why}`);
    continue;
  }

  // `updateMask` is a plain query parameter here, not updateMask.fieldPaths —
  // the latter is rejected with INVALID_ARGUMENT.
  const patch = await api('PATCH', `${fieldPath}?updateMask=ttlConfig`, { ttlConfig: {} });
  if (!patch.ok) {
    console.error(`✗ ${collectionGroup}.${field} FAILED (${patch.status}):`, JSON.stringify(patch.json));
    failed = true;
    continue;
  }

  const after = await api('GET', fieldPath);
  console.log(
    `✓ ${collectionGroup}.${field} → ${after.json?.ttlConfig?.state ?? 'CREATING'}. ${why}`,
  );
}

for (const { collectionGroup, why } of MUST_NOT_EXPIRE) {
  const r = await api('GET', `${base}/collectionGroups/${collectionGroup}/fields/expireAt`);
  const ttl = r.json?.ttlConfig ?? null;
  if (ttl === null) {
    console.log(`✓ ${collectionGroup} has no TTL policy, as it must not. ${why}`);
  } else {
    console.error(`✗ ${collectionGroup} HAS a TTL policy (${ttl.state}) and must not. ${why}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
