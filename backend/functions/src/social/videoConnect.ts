/**
 * YouTube, TikTok and TikTok Ads, connected the way Instagram and Google Ads are:
 * press Continue, sign in on the network's own page, done. No pasted tokens.
 *
 * All three share one public return page, `/connect/video`, so the owner registers
 * one address. The mark on the front of the state says whose sign-in came back.
 *
 * YouTube borrows the Google OAuth client saved for Google Ads (`googleApp`): one
 * Cloud project, one set-up. TikTok needs two apps, because its posting API and
 * its ads API live on separate developer portals. An admin stores those once,
 * here, for every workspace.
 *
 * A YouTube or TikTok account lands in the same `socialAccounts` record a pasted
 * one did, through `connectVerifiedAccount`, and goes straight on the list of
 * networks the team posts to.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAdmin, requireAuth } from '../lib/guards';
import { connectVerifiedAccount } from './accounts';
import { googleApp } from './googleAds';
import { open, seal, tokenVaultReady, type SealedSecret } from './secrets';
import { getSocialSettings, patchSettings } from './settings';
import { TIKTOK_SECRET_PATH, tiktokAds, type TikTokAdsLink } from './videoAds';
import { currentWorkspace, deskCall, sdb } from './workspace';

const PROVIDERS = ['youtube', 'tiktok', 'tiktok-ads'] as const;
export type VideoProvider = (typeof PROVIDERS)[number];

/** On the front of every state: which card's sign-in this is, without reading anything. */
const MARK: Record<VideoProvider, string> = { youtube: 'yt', tiktok: 'tt', 'tiktok-ads': 'ta' };

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const STATE_TTL_MS = 15 * 60_000;

const appRef = db.doc('system/tiktokApp');
const appSecretRef = db.doc('system/tiktokApp/secret/credentials');
const stateRef = (state: string) => db.doc(`socialOAuthStates/${state}`);
const CONFIG_PATH = 'system/socialAds';

interface App {
  id: string;
  secret: string;
}

interface AdvertiserChoice {
  advertiserId: string;
  name: string;
  currency: string;
}

async function appFor(provider: VideoProvider): Promise<App | null> {
  if (provider === 'youtube') {
    const google = await googleApp();
    return google ? { id: google.clientId, secret: google.clientSecret } : null;
  }
  if (!tokenVaultReady()) return null;
  const [pub, sec] = await Promise.all([appRef.get(), appSecretRef.get()]);
  const [idField, secretField] = provider === 'tiktok' ? ['clientKey', 'clientSecret'] : ['adsAppId', 'adsSecret'];
  const id = pub.get(idField) as string | undefined;
  const sealed = sec.get(secretField) as SealedSecret | undefined;
  if (!id || !sealed) return null;
  try {
    return { id, secret: open(sealed) };
  } catch {
    logger.error('video connect: the stored TikTok app will not decrypt — SOCIAL_TOKEN_KEY rotated?');
    return null;
  }
}

/** The one address all three networks send people back to. Must match their consoles to the character. */
function redirectUri(): string {
  return `${(process.env.VELOCITY_WEB_ORIGIN ?? 'https://velocityrides.app').replace(/\/+$/, '')}/connect/video`;
}

/** The network's own sign-in page for this provider. Pure. */
export function consentUrl(provider: VideoProvider, appId: string, state: string, redirect: string): string {
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  if (provider === 'youtube') {
    return `https://accounts.google.com/o/oauth2/v2/auth?${q({
      client_id: appId,
      redirect_uri: redirect,
      response_type: 'code',
      // Both are needed for a refresh token from someone who has granted access before.
      access_type: 'offline',
      prompt: 'consent',
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl',
      state,
    })}`;
  }
  if (provider === 'tiktok') {
    return `https://www.tiktok.com/v2/auth/authorize/?${q({
      client_key: appId,
      response_type: 'code',
      scope: 'user.info.basic,video.publish',
      redirect_uri: redirect,
      state,
    })}`;
  }
  return `https://business-api.tiktok.com/portal/auth?${q({ app_id: appId, state, redirect_uri: redirect })}`;
}

/** The provider a state was minted for, from its mark. Pure. */
export function providerOf(state: string): VideoProvider | null {
  return PROVIDERS.find((p) => state.startsWith(`${MARK[p]}.`)) ?? null;
}

/** The state this person started, here, not expired — or a refusal. */
async function ownState(state: string, uid: string) {
  const snap = await stateRef(state).get();
  const s = snap.data();
  if (!snap.exists || s?.uid !== uid || s?.provider !== providerOf(state) || (s?.wid ?? 'velocity') !== currentWorkspace()) {
    throw new HttpsError('permission-denied', 'That sign-in did not start here. Press Continue again.');
  }
  if (((s.expiresAt as Timestamp | undefined)?.toMillis() ?? 0) < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'That sign-in took too long. Press Continue again.');
  }
  return s;
}

async function exchange(url: string, form: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: new URLSearchParams(form), signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new HttpsError('unavailable', `The sign-in could not be finished: ${(e as Error).message}`);
  }
  return (await res.json().catch(() => ({}))) as { refresh_token?: string; error?: string; error_description?: string };
}

/** Finishing a connect means the team posts there from now on. */
async function postThereFromNowOn(platform: 'youtube' | 'tiktok') {
  const { platforms } = await getSocialSettings();
  if (!platforms.includes(platform)) await patchSettings({ platforms: [...platforms, platform] });
}

async function finishPosting(platform: 'youtube' | 'tiktok', app: App, code: string, uid: string): Promise<string> {
  const grant =
    platform === 'youtube'
      ? await exchange(GOOGLE_TOKEN, { grant_type: 'authorization_code', code, client_id: app.id, client_secret: app.secret, redirect_uri: redirectUri() })
      : await exchange('https://open.tiktokapis.com/v2/oauth/token/', {
          grant_type: 'authorization_code',
          code,
          client_key: app.id,
          client_secret: app.secret,
          redirect_uri: redirectUri(),
        });
  if (!grant.refresh_token) {
    throw new HttpsError('failed-precondition', grant.error_description || grant.error || 'The sign-in gave no lasting access. Remove Velocity from the account’s connected apps and try again.');
  }
  const record = await connectVerifiedAccount(platform, { accessToken: grant.refresh_token, clientId: app.id, clientSecret: app.secret }, uid);
  await postThereFromNowOn(platform);
  return String(record.displayName ?? '');
}

/** Spend a TikTok ads code on its long-lived token, and list the ad accounts it reaches. */
async function finishTikTokAds(app: App, code: string, state: string): Promise<AdvertiserChoice[]> {
  const grant = await tiktokAds<{ access_token?: string }>(null, '/oauth2/access_token/', { json: { app_id: app.id, secret: app.secret, auth_code: code } });
  if (!grant.access_token) throw new HttpsError('failed-precondition', 'TikTok gave no lasting access.');
  const listed = await tiktokAds<{ list?: { advertiser_id: string; advertiser_name?: string }[] }>(grant.access_token, '/oauth2/advertiser/get/', {
    query: { app_id: app.id, secret: app.secret },
  });
  const ids = (listed.list ?? []).slice(0, 20);
  if (!ids.length) throw new HttpsError('failed-precondition', 'That TikTok account has no ad accounts.');
  const info = await tiktokAds<{ list?: { advertiser_id: string; name?: string; currency?: string }[] }>(grant.access_token, '/advertiser/info/', {
    query: { advertiser_ids: JSON.stringify(ids.map((a) => a.advertiser_id)), fields: JSON.stringify(['advertiser_id', 'name', 'currency']) },
  });
  const choices = ids.map((a) => {
    const more = info.list?.find((i) => i.advertiser_id === a.advertiser_id);
    return { advertiserId: a.advertiser_id, name: more?.name || a.advertiser_name || a.advertiser_id, currency: more?.currency || 'USD' };
  });
  await stateRef(state).set({ token: seal(grant.access_token), choices }, { merge: true });
  return choices;
}

async function keepAdvertiser(state: string, uid: string, advertiserId: string): Promise<string> {
  const s = await ownState(state, uid);
  const pick = (s.choices as AdvertiserChoice[] | undefined)?.find((c) => c.advertiserId === advertiserId);
  if (!pick || !s.token) throw new HttpsError('failed-precondition', 'Pick one of the ad accounts that sign-in reached.');
  const tiktok: TikTokAdsLink = { ...pick, connectedBy: uid, connectedAtMs: Date.now(), identityId: null, lastError: null };
  await db
    .batch()
    .set(sdb.doc(CONFIG_PATH), { tiktok }, { merge: true })
    .set(sdb.doc(TIKTOK_SECRET_PATH), { token: s.token, updatedAt: FieldValue.serverTimestamp() })
    .delete(stateRef(state))
    .commit();
  return pick.name;
}

const providerSchema = z.enum(PROVIDERS);
const stateSchema = z.string().min(10).max(200);

/** Every step of a connect, one callable: what is set up, start, finish, and (TikTok Ads) pick or leave. */
export const adminVideoConnect = deskCall('any', { timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = z
    .discriminatedUnion('action', [
      z.object({ action: z.literal('state'), provider: providerSchema }),
      z.object({ action: z.literal('start'), provider: providerSchema }),
      z.object({ action: z.literal('finish'), code: z.string().min(6).max(3000), state: stateSchema }),
      z.object({ action: z.literal('choose'), state: stateSchema, advertiserId: z.string().min(3).max(40) }),
      z.object({ action: z.literal('disconnect') }),
    ])
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const input = parsed.data;

  try {
    switch (input.action) {
      case 'state': {
        const app = await appFor(input.provider);
        return { ready: Boolean(app), vaultReady: tokenVaultReady(), redirectUri: redirectUri() };
      }
      case 'start': {
        const app = await appFor(input.provider);
        if (!app) throw new HttpsError('failed-precondition', 'This connection is not set up yet.');
        const state = `${MARK[input.provider]}.${randomBytes(24).toString('base64url')}`;
        await stateRef(state).set({
          provider: input.provider,
          uid: ctx.uid,
          wid: currentWorkspace(),
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
        });
        return { url: consentUrl(input.provider, app.id, state, redirectUri()), state };
      }
      case 'finish': {
        await ownState(input.state, ctx.uid);
        const provider = providerOf(input.state)!;
        const app = await appFor(provider);
        if (!app) throw new HttpsError('failed-precondition', 'This connection is not set up yet.');
        if (provider === 'tiktok-ads') {
          const choices = await finishTikTokAds(app, input.code, input.state);
          if (choices.length === 1) return { connected: await keepAdvertiser(input.state, ctx.uid, choices[0].advertiserId), choices: [] };
          return { connected: null, choices };
        }
        const connected = await finishPosting(provider, app, input.code, ctx.uid);
        await stateRef(input.state).delete();
        return { connected, choices: [] };
      }
      case 'choose':
        return { connected: await keepAdvertiser(input.state, ctx.uid, input.advertiserId), choices: [] };
      case 'disconnect':
        await db.batch().set(sdb.doc(CONFIG_PATH), { tiktok: null }, { merge: true }).delete(sdb.doc(TIKTOK_SECRET_PATH)).commit();
        return { ok: true };
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('failed-precondition', (e as Error).message);
  }
});

/** Store a TikTok app once, for every workspace. Admins only. */
export const adminSetVideoApp = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({ provider: z.enum(['tiktok', 'tiktok-ads']), id: z.string().trim().min(3).max(200), secret: z.string().trim().min(8).max(300) })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'The app ID and the secret are both required.');
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'SOCIAL_TOKEN_KEY is not configured.');
  const { provider, id, secret } = parsed.data;
  const [idField, secretField] = provider === 'tiktok' ? ['clientKey', 'clientSecret'] : ['adsAppId', 'adsSecret'];
  await db
    .batch()
    .set(appRef, { [idField]: id, updatedAt: FieldValue.serverTimestamp(), updatedBy: ctx.uid }, { merge: true })
    .set(appSecretRef, { [secretField]: seal(secret), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .commit();
  return { ok: true, redirectUri: redirectUri() };
});
