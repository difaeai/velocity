/**
 * Connecting Instagram the way a person expects to connect Instagram.
 *
 * Everything else on this desk is connected by pasting a token out of the Graph
 * API Explorer. That works, and it is also the single reason nothing has ever
 * been connected: it asks an operator to know what a Page token is, which
 * scopes it needs, how to make it long-lived, and where the Instagram Business
 * account id hides. This file replaces all of that with the button Meta itself
 * ships — "Continue with Facebook" — and does the four Graph calls afterwards.
 *
 * The flow, end to end:
 *
 *  1. `adminStartMetaConnect` mints a one-time `state`, writes it down, and
 *     returns the Facebook OAuth dialog URL. The console opens it in a popup.
 *  2. The admin signs in as themselves and ticks the Velocity Rides Page.
 *  3. Meta redirects to `/connect/instagram` on our own domain, a page whose
 *     only job is to hand the `code` back to the console window and close.
 *  4. `adminFinishMetaConnect` spends the code **here, on the server**, where
 *     the app secret lives: code → short-lived user token → long-lived user
 *     token → the Pages that person administers, each with its own Page token
 *     and whatever Instagram Business account is attached to it.
 *  5. `adminChooseMetaPage` stores the one the admin picked, through the same
 *     verify-then-seal path a pasted token goes through.
 *
 * Three things are worth knowing before changing any of it:
 *
 * - **The code never buys anything on the client.** An authorization code is
 *   worthless without the app secret, and the app secret never leaves Cloud
 *   Functions. That is why the callback page is allowed to be public.
 * - **Page tokens derived from a LONG-LIVED user token do not expire.** Meta
 *   documents this and it is the whole reason step 4 exchanges the token before
 *   reading `/me/accounts` — do that in the wrong order and the desk silently
 *   stops publishing about two months later.
 * - **One grant connects two accounts.** A Facebook Page and the Instagram
 *   Business account attached to it share one Page token, so connecting
 *   Instagram connects the Page as well. The console says so rather than
 *   surprising anyone.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAdmin, requireAuth } from '../lib/guards';
import { currentWorkspace, deskCall, sdb } from './workspace';
import { connectVerifiedAccount } from './accounts';
import { open, seal, tokenVaultReady, type SealedSecret } from './secrets';

const GRAPH = 'https://graph.facebook.com/v21.0';
const DIALOG = 'https://www.facebook.com/v21.0/dialog/oauth';

/**
 * Everything the desk needs to publish, read comments back and see how a post
 * did. Asking for them all at once matters: Meta re-prompts for a missing
 * scope with a second dialog weeks later, by which time nobody remembers what
 * the desk was supposed to be allowed to do.
 */
const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'business_management',
];

/**
 * What the ads desk adds, asked for only when the connect starts from the Ads
 * page. Kept off the Instagram connect so that an app without the Marketing API
 * can still connect a Page: an unknown scope fails the whole dialog.
 */
const ADS_SCOPES = ['ads_management', 'ads_read'];

/** A started connection is finished in one sitting or not at all. */
const STATE_TTL_MS = 15 * 60_000;

const stateRef = (state: string) => db.doc(`socialOAuthStates/${state}`);
const appRef = db.doc('system/socialMetaApp');
const appSecretRef = db.doc('system/socialMetaApp/secret/credentials');

interface MetaApp {
  appId: string;
  appSecret: string;
  /** Where the pair came from, so the console can explain itself. */
  source: 'console' | 'env' | 'whatsapp';
}

/**
 * The app id and secret, in the order that needs the least of the admin.
 *
 * The WhatsApp fallback is not a trick: `WHATSAPP_APP_SECRET` is already in this
 * function's environment and it belongs to the same Meta app that would run the
 * login. If that app has Facebook Login switched on, Instagram connects with
 * nothing new pasted anywhere. The app id is not a secret — it travels in the
 * dialog URL in plain sight — so it is kept in a readable document rather than
 * sealed.
 */
async function metaApp(): Promise<MetaApp | null> {
  const envId = process.env.META_APP_ID?.trim();
  const envSecret = process.env.META_APP_SECRET?.trim();
  if (envId && envSecret) return { appId: envId, appSecret: envSecret, source: 'env' };

  if (tokenVaultReady()) {
    const [pub, sec] = await Promise.all([appRef.get(), appSecretRef.get()]);
    const appId = (pub.data()?.appId as string | undefined)?.trim();
    const sealed = sec.data()?.appSecret as SealedSecret | undefined;
    if (appId && sealed) {
      try {
        return { appId, appSecret: open(sealed), source: 'console' };
      } catch {
        logger.error('social: the stored Meta app secret will not decrypt — SOCIAL_TOKEN_KEY rotated?');
      }
    }
  }

  const waId = process.env.WHATSAPP_APP_ID?.trim();
  const waSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (waId && waSecret) return { appId: waId, appSecret: waSecret, source: 'whatsapp' };

  return null;
}

class MetaError extends Error {}

/**
 * One Graph call. Meta answers a failure with a 200 and an `error` object about
 * as often as it answers with a 4xx, so both are read, and the message the user
 * sees is Meta's own — "Invalid Scopes: instagram_content_publish" is a fixable
 * sentence, "connection failed" is not.
 */
async function graph<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new MetaError(`Facebook could not be reached: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; type?: string } } & T;
  if (body?.error?.message) throw new MetaError(body.error.message);
  if (!res.ok) throw new MetaError(`Facebook returned HTTP ${res.status}.`);
  return body;
}

/**
 * The redirect the dialog comes back to. It is sent to Meta twice — once on the
 * dialog and once on the exchange — and the two must match to the character, so
 * both reads come from here. It is also what has to be whitelisted in the Meta
 * console, which is why the console prints this exact string.
 */
function redirectUri(): string {
  const base = (process.env.VELOCITY_WEB_ORIGIN ?? 'https://velocityrides.app').replace(/\/+$/, '');
  return `${base}/connect/instagram`;
}

// ── what the console needs to draw the button ───────────────────────────────

/** Can this desk run a one-click connect at all, and if not, what is missing? */
export const adminGetMetaConnectState = deskCall('any', async () => {
  const app = await metaApp();
  return {
    ready: Boolean(app) && tokenVaultReady(),
    vaultReady: tokenVaultReady(),
    appId: app?.appId ?? null,
    source: app?.source ?? null,
    redirectUri: redirectUri(),
    scopes: SCOPES,
  };
});

/**
 * Store an App ID and App Secret typed into the console.
 *
 * Proved before it is kept, with a client-credentials call: a wrong secret is a
 * five-second mistake to make and an hour-long one to diagnose from the OAuth
 * dialog, where it surfaces as a generic "something went wrong" two screens
 * later.
 */
export const adminSetMetaApp = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({ appId: z.string().min(5).max(64), appSecret: z.string().min(10).max(200) })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'An App ID and an App Secret are both required.');
  if (!tokenVaultReady()) {
    throw new HttpsError(
      'failed-precondition',
      'SOCIAL_TOKEN_KEY is not configured, so the app secret cannot be stored safely.',
    );
  }

  const appId = parsed.data.appId.trim();
  const appSecret = parsed.data.appSecret.trim();

  let name: string | null = null;
  try {
    await graph<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?grant_type=client_credentials&client_id=${encodeURIComponent(
        appId,
      )}&client_secret=${encodeURIComponent(appSecret)}`,
    );
    const app = await graph<{ name?: string }>(
      `${GRAPH}/${encodeURIComponent(appId)}?fields=name&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
    );
    name = app.name ?? null;
  } catch (e) {
    throw new HttpsError('failed-precondition', `Facebook rejected that pair: ${(e as Error).message}`);
  }

  await db.batch()
    .set(appRef, { appId, appName: name, updatedAt: FieldValue.serverTimestamp(), updatedBy: ctx.uid }, { merge: true })
    .set(appSecretRef, { appSecret: seal(appSecret), updatedAt: FieldValue.serverTimestamp() })
    .commit();

  return { ok: true, appId, appName: name, redirectUri: redirectUri() };
});

// ── the three steps of a connect ────────────────────────────────────────────

/** Step one: where to send the admin, and the one-time state that comes back. */
export const adminStartMetaConnect = deskCall('any', async (req) => {
  const ads = (req.data as { ads?: unknown } | undefined)?.ads === true;
  const app = await metaApp();
  if (!app) {
    throw new HttpsError(
      'failed-precondition',
      'No Meta app is configured yet. Add the App ID and App Secret from developers.facebook.com first.',
    );
  }

  const state = randomBytes(24).toString('base64url');
  await stateRef(state).set({
    uid: req.auth?.uid ?? null,
    // The connect lands in the workspace it started from, never another.
    wid: currentWorkspace(),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
    stage: 'started',
    ads,
  });

  const url =
    `${DIALOG}?client_id=${encodeURIComponent(app.appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri())}` +
    `&state=${encodeURIComponent(state)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent((ads ? [...SCOPES, ...ADS_SCOPES] : SCOPES).join(','))}`;

  return { url, state, redirectUri: redirectUri() };
});

interface AdAccountChoice {
  id: string;
  name: string;
  currency: string;
  active: boolean;
}

interface PageChoice {
  pageId: string;
  pageName: string;
  instagramId: string | null;
  instagramHandle: string | null;
  followers: number | null;
  avatarUrl: string | null;
}

/**
 * Step two: spend the code and report what the grant actually reached.
 *
 * The Page tokens are kept server-side against the state document rather than
 * returned, because the console has no business holding one even for the
 * seconds between this call and the next.
 */
export const adminFinishMetaConnect = deskCall('any', async (req) => {
  const ctx = requireAuth(req);
  const parsed = z
    .object({ code: z.string().min(10).max(2000), state: z.string().min(10).max(200) })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const app = await metaApp();
  if (!app) throw new HttpsError('failed-precondition', 'No Meta app is configured.');

  const snap = await stateRef(parsed.data.state).get();
  const state = snap.data();
  if (!snap.exists || state?.uid !== ctx.uid || (state?.wid ?? 'velocity') !== currentWorkspace()) {
    throw new HttpsError('permission-denied', 'That sign-in did not start here. Press Connect again.');
  }
  const expiresAtMs = (state.expiresAt as Timestamp | undefined)?.toMillis() ?? 0;
  if (expiresAtMs < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'That sign-in took too long. Press Connect again.');
  }

  try {
    // Short-lived user token — about an hour, and useless on its own.
    const short = await graph<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(app.appId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri())}` +
        `&client_secret=${encodeURIComponent(app.appSecret)}` +
        `&code=${encodeURIComponent(parsed.data.code)}`,
    );

    // Long-lived user token — ~60 days. The Page tokens minted FROM it are the
    // ones that never expire, which is the only reason this step exists.
    const long = await graph<{ access_token: string; expires_in?: number }>(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
        `&client_id=${encodeURIComponent(app.appId)}` +
        `&client_secret=${encodeURIComponent(app.appSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(short.access_token)}`,
    );

    const pages = await graph<{
      data?: {
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: {
          id: string;
          username?: string;
          followers_count?: number;
          profile_picture_url?: string;
        };
      }[];
    }>(
      `${GRAPH}/me/accounts?fields=id,name,access_token,` +
        `instagram_business_account{id,username,followers_count,profile_picture_url}` +
        `&limit=100&access_token=${encodeURIComponent(long.access_token)}`,
    );

    const found = pages.data ?? [];
    const choices: PageChoice[] = found.map((p) => ({
      pageId: p.id,
      pageName: p.name,
      instagramId: p.instagram_business_account?.id ?? null,
      instagramHandle: p.instagram_business_account?.username
        ? `@${p.instagram_business_account.username}`
        : null,
      followers: p.instagram_business_account?.followers_count ?? null,
      avatarUrl: p.instagram_business_account?.profile_picture_url ?? null,
    }));

    // The ad accounts this person can run, when the connect came from the Ads
    // page. The Marketing API takes the USER token, not a Page token, so that
    // is kept too — sealed, and only for this purpose.
    const adAccounts: AdAccountChoice[] = state.ads
      ? (
          (
            await graph<{ data?: { id: string; name?: string; currency?: string; account_status?: number }[] }>(
              `${GRAPH}/me/adaccounts?fields=id,name,currency,account_status&limit=50&access_token=${encodeURIComponent(
                long.access_token,
              )}`,
            ).catch(() => ({ data: [] }))
          ).data ?? []
        ).map((a) => ({ id: a.id, name: a.name ?? a.id, currency: a.currency ?? '', active: a.account_status === 1 }))
      : [];

    // Sealed against the state doc, not returned. One minute of life: the admin
    // is looking at the list right now or they are starting over.
    await stateRef(parsed.data.state).set(
      {
        stage: 'granted',
        expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
        pages: found.map((p) => ({ id: p.id, name: p.name, token: seal(p.access_token) })),
        ...(state.ads
          ? {
              userToken: seal(long.access_token),
              // Long-lived user tokens last about sixty days, and Meta says how long.
              userTokenExpiresAtMs: Date.now() + (long.expires_in ?? 60 * 86_400) * 1000,
              adAccounts: adAccounts.map((a) => a.id),
            }
          : {}),
      },
      { merge: true },
    );

    return { pages: choices, adAccounts };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.warn('social: meta connect failed', { message: (e as Error).message });
    throw new HttpsError('failed-precondition', (e as Error).message);
  }
});

/**
 * Step three: keep the Page the admin picked.
 *
 * Both accounts go through `connectVerifiedAccount`, which is the same function
 * a pasted token goes through — so a one-click connection is stored, sealed,
 * audited and proved against the live API in exactly the same way, and there is
 * no second code path to keep in step.
 */
export const adminChooseMetaPage = deskCall('any', async (req) => {
  const ctx = requireAuth(req);
  const parsed = z
    .object({
      state: z.string().min(10).max(200),
      pageId: z.string().min(1).max(100),
      adAccountId: z.string().regex(/^act_\d{3,30}$/).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const snap = await stateRef(parsed.data.state).get();
  const data = snap.data();
  if (!snap.exists || data?.uid !== ctx.uid || data?.stage !== 'granted' || (data?.wid ?? 'velocity') !== currentWorkspace()) {
    throw new HttpsError('permission-denied', 'That sign-in is no longer valid. Press Connect again.');
  }

  const page = (data.pages as { id: string; name: string; token: SealedSecret }[] | undefined)?.find(
    (p) => p.id === parsed.data.pageId,
  );
  if (!page) throw new HttpsError('not-found', 'That Page was not part of this sign-in.');

  const pageToken = open(page.token);

  // The Instagram id is read again here rather than trusted from step two: the
  // admin may have linked the account in another tab in between, and this is
  // the call that decides whether Instagram gets connected at all.
  const detail = await graph<{ instagram_business_account?: { id: string } }>(
    `${GRAPH}/${encodeURIComponent(page.id)}?fields=instagram_business_account&access_token=${encodeURIComponent(
      pageToken,
    )}`,
  ).catch(() => ({}) as { instagram_business_account?: { id: string } });

  const connected: string[] = [];

  // Facebook first: if the Page token is wrong, this is where it shows, and
  // nothing half-connected has been written yet.
  await connectVerifiedAccount('facebook', { accessToken: pageToken, externalId: page.id }, ctx.uid);
  connected.push('facebook');

  const igId = detail.instagram_business_account?.id ?? null;
  if (igId) {
    await connectVerifiedAccount('instagram', { accessToken: pageToken, externalId: igId }, ctx.uid);
    connected.push('instagram');
  }

  // The ad account, for the Ads desk — only one this sign-in actually listed.
  const adAccountId = parsed.data.adAccountId;
  if (adAccountId) {
    if (!(data.adAccounts as string[] | undefined)?.includes(adAccountId) || !data.userToken) {
      throw new HttpsError('permission-denied', 'That ad account was not part of this sign-in.');
    }
    const userToken = open(data.userToken as SealedSecret);
    const account = await graph<{
      id: string;
      name?: string;
      currency?: string;
      account_status?: number;
      timezone_name?: string;
    }>(
      `${GRAPH}/${adAccountId}?fields=id,name,currency,account_status,timezone_name&access_token=${encodeURIComponent(
        userToken,
      )}`,
    );
    await db
      .batch()
      .set(
        sdb.doc('system/socialAds'),
        {
          adAccountId: account.id,
          accountName: account.name ?? account.id,
          currency: account.currency ?? 'PKR',
          timezone: account.timezone_name ?? null,
          accountStatus: account.account_status ?? null,
          pageId: page.id,
          instagramId: igId,
          tokenExpiresAtMs: (data.userTokenExpiresAtMs as number | undefined) ?? null,
          connectedBy: ctx.uid,
          connectedAtMs: Date.now(),
          lastSyncStatus: null,
        },
        { merge: true },
      )
      .set(sdb.doc('system/socialAds/secret/credentials'), {
        token: seal(userToken),
        updatedAt: FieldValue.serverTimestamp(),
      })
      .commit();
    connected.push('ads');
  }

  await stateRef(parsed.data.state).delete().catch(() => undefined);

  return {
    ok: true,
    connected,
    instagram: Boolean(igId),
    note: igId
      ? null
      : `"${page.name}" has no Instagram Business account linked to it. Link one in the Instagram app ` +
        '(Settings → Account type and tools → Switch to professional account, then connect the Page) and press Connect again.',
  };
});
