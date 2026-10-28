/**
 * Google Ads, connected the way Meta is: "Continue with Google", not a pasted token.
 *
 * The owner asked for it on 2026-10-28 ("go for google ads"). Until then the
 * desk held no Google Ads credential at all and only wrote briefs a person typed
 * into Google Ads. This connects an account and READS it — spend, clicks,
 * conversions, the campaigns — and adds its spend to blended ROAS. It does not
 * create or change campaigns: that spends money, and nothing here has been run
 * against a live account yet.
 *
 * The flow mirrors `meta.ts`:
 *  1. An admin stores the app once (`adminSetGoogleAdsApp`): an OAuth client from
 *     the Google Cloud project that has the Google Ads API on. Shared by every
 *     workspace, like `system/socialMetaApp`. No developer token: Google sunset
 *     them on 2026-09-09 — the header is ignored, and a later API version will
 *     reject a call that sends one. Access now comes from that Cloud project.
 *  2. `adminStartGoogleAdsConnect` mints a one-time state and returns Google's
 *     consent URL (offline access, so a refresh token comes back).
 *  3. Google redirects to `/connect/google-ads`, which hands the code to the
 *     console window.
 *  4. `adminFinishGoogleAdsConnect` spends the code here, where the client secret
 *     lives, keeps the refresh token sealed on the state document, and lists the
 *     Google Ads accounts that sign-in reaches.
 *  5. `adminChooseGoogleAdsAccount` keeps the one picked: its name on the ads
 *     config (the console reads it), the refresh token sealed beside the Meta one.
 *
 * Three things worth knowing:
 * - Google returns a refresh token only with `access_type=offline` AND, for a
 *   person who already granted access once, `prompt=consent`. Without both the
 *   second connect silently comes back with no refresh token.
 * - An account reached through a manager account answers only with the
 *   manager's id in `login-customer-id`. The app's optional manager id is sent.
 * - The Cloud project's access level decides what can be read: Test reaches only
 *   test accounts, Explorer (applied for on the Google Ads API Overview page in
 *   Cloud Console) reaches real ones. A Test project reading a real account gets
 *   CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION, which the console says plainly.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAdmin, requireAuth } from '../lib/guards';
import { currentWorkspace, deskCall, sdb } from './workspace';
import { PKR_PER_USD } from './adsExpert';
import { open, seal, tokenVaultReady, type SealedSecret } from './secrets';

/** One constant: Google sunsets a version about a year after it ships. v26 is the newest on 2026-10-28. */
export const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v26';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/adwords';
const STATE_TTL_MS = 15 * 60_000;

const appRef = db.doc('system/googleAdsApp');
const appSecretRef = db.doc('system/googleAdsApp/secret/credentials');
const stateRef = (state: string) => db.doc(`socialOAuthStates/${state}`);
/** The ads config the console already reads; Google sits on it as `google`. Every write merges. */
const CONFIG_PATH = 'system/socialAds';
/** Beside Meta's `secret/credentials`, never in it: Meta's connect overwrites that document. */
const SECRET_PATH = 'system/socialAds/secret/google';

interface GoogleApp {
  clientId: string;
  clientSecret: string;
  /** A manager account the client accounts are reached through, digits only. */
  loginCustomerId: string | null;
}

/** What the console shows for a connected account. */
export interface GoogleAdsLink {
  customerId: string;
  name: string;
  currency: string;
  testAccount: boolean;
  connectedBy: string | null;
  connectedAtMs: number;
  /** Set when Google refused the stored sign-in; the Brain shows Fix. */
  lastError: string | null;
}

class GoogleAdsError extends Error {
  constructor(
    message: string,
    readonly revoked = false,
  ) {
    super(message);
  }
}

/** "123-456-7890", "1234567890" or "customers/1234567890" → "1234567890", or null. Pure. */
export function customerDigits(raw: string): string | null {
  const d = raw.trim().replace(/^customers\//, '').replace(/-/g, '');
  return /^\d{10}$/.test(d) ? d : null;
}

/** "1234567890" → "123-456-7890", the way Google Ads shows it. Pure. */
export const dashed = (id: string): string => `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;

/**
 * Google's own sentence out of a Google Ads error body: the first per-field
 * error when there is one, else the top-level message — except the one the
 * owner will meet first, a Test-access project reading a real account, which
 * gets said in words they can act on. Pure.
 */
export function adsErrorText(body: unknown, status: number): string {
  if (JSON.stringify(body ?? '').includes('CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION')) {
    return 'The Google Cloud project only has Test access, which reads test accounts only. Explorer access (Cloud Console → Google Ads API → Overview) has to be approved first.';
  }
  const e = (body as { error?: { message?: string; details?: { errors?: { message?: string }[] }[] } })?.error;
  const detail = e?.details?.flatMap((d) => d.errors ?? []).find((x) => x.message)?.message;
  return detail || e?.message || `Google Ads returned HTTP ${status}.`;
}

/** An amount in one currency in another, for the two the desk knows; null otherwise. Pure. */
export function inCurrency(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  if (from === 'USD' && to === 'PKR') return amount * PKR_PER_USD;
  if (from === 'PKR' && to === 'USD') return amount / PKR_PER_USD;
  return null;
}

async function googleApp(): Promise<GoogleApp | null> {
  if (!tokenVaultReady()) return null;
  const [pub, sec] = await Promise.all([appRef.get(), appSecretRef.get()]);
  const clientId = (pub.get('clientId') as string | undefined)?.trim();
  const sealed = sec.get('clientSecret') as SealedSecret | undefined;
  if (!clientId || !sealed) return null;
  try {
    return {
      clientId,
      clientSecret: open(sealed),
      loginCustomerId: (pub.get('loginCustomerId') as string | null | undefined) ?? null,
    };
  } catch {
    logger.error('ads: the stored Google Ads app will not decrypt — SOCIAL_TOKEN_KEY rotated?');
    return null;
  }
}

/** Where Google sends the admin back. Must match the OAuth client's list to the character. */
function redirectUri(): string {
  const base = (process.env.VELOCITY_WEB_ORIGIN ?? 'https://velocityrides.app').replace(/\/+$/, '');
  return `${base}/connect/google-ads`;
}

/** One call to Google's token endpoint. */
async function oauth(form: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; error?: string; error_description?: string }> {
  let res: Response;
  try {
    res = await fetch(TOKEN, { method: 'POST', body: new URLSearchParams(form), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new GoogleAdsError(`Google could not be reached: ${(e as Error).message}`);
  }
  return (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
}

async function accessToken(app: GoogleApp, refreshToken: string): Promise<string> {
  const out = await oauth({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: app.clientId,
    client_secret: app.clientSecret,
  });
  if (out.access_token) return out.access_token;
  throw new GoogleAdsError(
    out.error === 'invalid_grant'
      ? 'The Google sign-in was revoked or has expired. Connect Google Ads again.'
      : `Google refused the sign-in: ${out.error_description || out.error || 'no reason given'}.`,
    out.error === 'invalid_grant',
  );
}

/** One Google Ads REST call; Google's sentence on failure. */
async function gads<T>(app: GoogleApp, token: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  // Only on calls about one account; listing what a sign-in reaches is not one.
  if (app.loginCustomerId && path.startsWith('customers/')) headers['login-customer-id'] = app.loginCustomerId;
  let res: Response;
  try {
    res = await fetch(`${GOOGLE_ADS_API}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GoogleAdsError(`Google Ads could not be reached: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) throw new GoogleAdsError(adsErrorText(json, res.status));
  return json as T;
}

interface SearchRow {
  customer?: { id?: string; descriptiveName?: string; currencyCode?: string; manager?: boolean; testAccount?: boolean };
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
  metrics?: { costMicros?: string; clicks?: string; impressions?: string; conversions?: number; conversionsValue?: number };
}

const search = (app: GoogleApp, token: string, customerId: string, query: string) =>
  gads<{ results?: SearchRow[] }>(app, token, `customers/${customerId}/googleAds:search`, { query }).then((r) => r.results ?? []);

/** Metrics rows summed, money out of micros. Pure. */
export function sumMetrics(rows: SearchRow[]): { spend: number; clicks: number; impressions: number; conversions: number; value: number } {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return rows.reduce(
    (s, r) => ({
      spend: s.spend + n(r.metrics?.costMicros) / 1e6,
      clicks: s.clicks + n(r.metrics?.clicks),
      impressions: s.impressions + n(r.metrics?.impressions),
      conversions: s.conversions + n(r.metrics?.conversions),
      value: s.value + n(r.metrics?.conversionsValue),
    }),
    { spend: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 },
  );
}

/** The connected account and a working access token, or why not. */
async function linked(): Promise<{ app: GoogleApp; token: string; link: GoogleAdsLink }> {
  const [app, cfg, sec] = await Promise.all([googleApp(), sdb.doc(CONFIG_PATH).get(), sdb.doc(SECRET_PATH).get()]);
  const link = cfg.get('google') as GoogleAdsLink | null | undefined;
  const sealed = sec.get('refreshToken') as SealedSecret | undefined;
  if (!app) throw new HttpsError('failed-precondition', 'The Google Ads app is not set up yet.');
  if (!link?.customerId || !sealed) throw new HttpsError('failed-precondition', 'No Google Ads account is connected.');
  try {
    return { app, link, token: await accessToken(app, open(sealed)) };
  } catch (e) {
    if (e instanceof GoogleAdsError && e.revoked) {
      await sdb.doc(CONFIG_PATH).set({ google: { ...link, lastError: e.message } }, { merge: true });
    }
    throw e;
  }
}

/**
 * Google Ads spend over Meta's window (the seven days before today), in `currency`.
 * Null when nothing is connected, the sign-in failed, or the currencies cannot
 * be converted — blended ROAS then stays Meta-only rather than being guessed.
 */
export async function googleAdsSpend(currency: string): Promise<number | null> {
  const cfg = await sdb.doc(CONFIG_PATH).get();
  if (!(cfg.get('google') as GoogleAdsLink | null | undefined)?.customerId) return null;
  try {
    const { app, token, link } = await linked();
    const rows = await search(app, token, link.customerId, 'SELECT metrics.cost_micros FROM customer WHERE segments.date DURING LAST_7_DAYS');
    return inCurrency(sumMetrics(rows).spend, link.currency, currency);
  } catch (e) {
    logger.warn('ads: could not read Google Ads spend for blended ROAS', { message: (e as Error).message });
    return null;
  }
}

// ── the console ─────────────────────────────────────────────────────────────

export const adminGetGoogleAdsState = deskCall('ads', async () => {
  const app = await googleApp();
  return {
    ready: Boolean(app),
    vaultReady: tokenVaultReady(),
    clientId: app?.clientId ?? null,
    loginCustomerId: app?.loginCustomerId ?? null,
    redirectUri: redirectUri(),
  };
});

/**
 * Store the OAuth client, once, for every workspace.
 * The client pair is proved before it is kept: a refresh with a dummy token
 * answers `invalid_grant` for a real client and `invalid_client` for a wrong
 * one, so a typo surfaces here rather than as a blank Google error page.
 */
export const adminSetGoogleAdsApp = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({
      clientId: z.string().trim().regex(/\.apps\.googleusercontent\.com$/, 'That is not an OAuth client ID.'),
      clientSecret: z.string().trim().min(10).max(200),
      loginCustomerId: z.string().trim().max(20).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'The client ID and client secret are both required.');
  }
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'SOCIAL_TOKEN_KEY is not configured.');
  const manager = parsed.data.loginCustomerId ? customerDigits(parsed.data.loginCustomerId) : null;
  if (parsed.data.loginCustomerId && !manager) {
    throw new HttpsError('invalid-argument', 'The manager account ID is ten digits, like 123-456-7890.');
  }

  const probe = await oauth({
    grant_type: 'refresh_token',
    refresh_token: 'velocity-probe',
    client_id: parsed.data.clientId,
    client_secret: parsed.data.clientSecret,
  });
  if (probe.error === 'invalid_client' || probe.error === 'unauthorized_client') {
    throw new HttpsError('failed-precondition', `Google rejected that client ID and secret: ${probe.error_description || probe.error}.`);
  }

  await db
    .batch()
    .set(appRef, { clientId: parsed.data.clientId, loginCustomerId: manager, updatedAt: FieldValue.serverTimestamp(), updatedBy: ctx.uid })
    .set(appSecretRef, { clientSecret: seal(parsed.data.clientSecret), updatedAt: FieldValue.serverTimestamp() })
    .commit();
  return { ok: true, redirectUri: redirectUri() };
});

export const adminStartGoogleAdsConnect = deskCall('ads', async (req) => {
  const app = await googleApp();
  if (!app) throw new HttpsError('failed-precondition', 'The Google Ads app is not set up yet.');
  const state = randomBytes(24).toString('base64url');
  await stateRef(state).set({
    provider: 'google-ads',
    uid: req.auth?.uid ?? null,
    wid: currentWorkspace(),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
  });
  const url =
    `${AUTH}?client_id=${encodeURIComponent(app.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri())}` +
    `&response_type=code&access_type=offline&prompt=consent&include_granted_scopes=true` +
    `&scope=${encodeURIComponent(SCOPE)}&state=${encodeURIComponent(state)}`;
  return { url, state };
});

/** The state this person started, here, not expired — or a refusal. */
async function ownState(state: string, uid: string) {
  const snap = await stateRef(state).get();
  const s = snap.data();
  if (!snap.exists || s?.provider !== 'google-ads' || s?.uid !== uid || (s?.wid ?? 'velocity') !== currentWorkspace()) {
    throw new HttpsError('permission-denied', 'That sign-in did not start here. Press Connect again.');
  }
  if (((s.expiresAt as Timestamp | undefined)?.toMillis() ?? 0) < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'That sign-in took too long. Press Connect again.');
  }
  return s;
}

interface AccountChoice {
  customerId: string;
  name: string;
  currency: string;
  manager: boolean;
  testAccount: boolean;
  /** Why it could not be read, when it could not. */
  note: string | null;
}

export const adminFinishGoogleAdsConnect = deskCall('ads', { timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ code: z.string().min(10).max(2000), state: z.string().min(10).max(200) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  await ownState(parsed.data.state, ctx.uid);
  const app = await googleApp();
  if (!app) throw new HttpsError('failed-precondition', 'The Google Ads app is not set up yet.');

  try {
    const grant = await oauth({
      grant_type: 'authorization_code',
      code: parsed.data.code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: redirectUri(),
    });
    if (!grant.refresh_token || !grant.access_token) {
      throw new GoogleAdsError(
        grant.error_description ||
          'Google signed you in but gave no lasting access. Remove Velocity from your Google account’s third-party access and connect again.',
      );
    }
    const listed = await gads<{ resourceNames?: string[] }>(app, grant.access_token, 'customers:listAccessibleCustomers');
    const ids = (listed.resourceNames ?? []).map(customerDigits).filter((d): d is string => Boolean(d)).slice(0, 20);
    if (!ids.length) throw new GoogleAdsError('That Google account has no Google Ads accounts.');

    const choices: AccountChoice[] = [];
    for (const id of ids) {
      try {
        const [row] = await search(
          app,
          grant.access_token,
          id,
          'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.test_account FROM customer LIMIT 1',
        );
        choices.push({
          customerId: id,
          name: row?.customer?.descriptiveName || dashed(id),
          currency: row?.customer?.currencyCode || 'PKR',
          manager: row?.customer?.manager === true,
          testAccount: row?.customer?.testAccount === true,
          note: null,
        });
      } catch (e) {
        choices.push({ customerId: id, name: dashed(id), currency: 'PKR', manager: false, testAccount: false, note: (e as Error).message.slice(0, 240) });
      }
    }

    await stateRef(parsed.data.state).set({ refreshToken: seal(grant.refresh_token), choices, stage: 'chosen-pending' }, { merge: true });
    return { choices };
  } catch (e) {
    if (e instanceof GoogleAdsError) throw new HttpsError('failed-precondition', e.message);
    throw e;
  }
});

export const adminChooseGoogleAdsAccount = deskCall('ads', async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ state: z.string().min(10).max(200), customerId: z.string().max(20) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const s = await ownState(parsed.data.state, ctx.uid);
  const pick = (s.choices as AccountChoice[] | undefined)?.find((c) => c.customerId === customerDigits(parsed.data.customerId));
  if (!pick || !s.refreshToken) throw new HttpsError('failed-precondition', 'Pick one of the accounts that sign-in reached.');
  if (pick.manager) throw new HttpsError('failed-precondition', 'That is a manager account — it runs no ads itself. Pick the account under it.');
  if (pick.note) throw new HttpsError('failed-precondition', `Google Ads would not open that account: ${pick.note}`);

  const google: GoogleAdsLink = {
    customerId: pick.customerId,
    name: pick.name,
    currency: pick.currency,
    testAccount: pick.testAccount,
    connectedBy: ctx.uid,
    connectedAtMs: Date.now(),
    lastError: null,
  };
  await db
    .batch()
    .set(sdb.doc(CONFIG_PATH), { google }, { merge: true })
    .set(sdb.doc(SECRET_PATH), { refreshToken: s.refreshToken, updatedAt: FieldValue.serverTimestamp() })
    .delete(stateRef(parsed.data.state))
    .commit();
  return { ok: true, name: pick.name, customerId: dashed(pick.customerId) };
});

export const adminDisconnectGoogleAds = deskCall('ads', async () => {
  const sec = await sdb.doc(SECRET_PATH).get();
  const sealed = sec.get('refreshToken') as SealedSecret | undefined;
  // Best effort: a revoke that fails still leaves nothing stored here to use.
  if (sealed) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(sealed))}`, { method: 'POST' }).catch(() => undefined);
  }
  await db.batch().set(sdb.doc(CONFIG_PATH), { google: null }, { merge: true }).delete(sdb.doc(SECRET_PATH)).commit();
  return { ok: true };
});

/** The last 30 days, for the Ads page: the account's totals and its ten biggest campaigns. */
export const adminGoogleAdsSummary = deskCall('ads', { timeoutSeconds: 60 }, async () => {
  try {
    const { app, token, link } = await linked();
    const [totals, campaigns] = await Promise.all([
      search(app, token, link.customerId, 'SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date DURING LAST_30_DAYS'),
      search(
        app,
        token,
        link.customerId,
        "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 10",
      ),
    ]);
    if (link.lastError) await sdb.doc(CONFIG_PATH).set({ google: { ...link, lastError: null } }, { merge: true });
    return {
      currency: link.currency,
      totals: sumMetrics(totals),
      campaigns: campaigns.map((r) => ({
        id: r.campaign?.id ?? '',
        name: r.campaign?.name ?? '',
        status: r.campaign?.status ?? '',
        channel: r.campaign?.advertisingChannelType ?? '',
        ...sumMetrics([r]),
      })),
    };
  } catch (e) {
    if (e instanceof GoogleAdsError) throw new HttpsError('failed-precondition', e.message);
    throw e;
  }
});
