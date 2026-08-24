/**
 * Connecting the social accounts.
 *
 * A connection is a paste, not a redirect: the admin gives the desk a token
 * (and whatever id that network needs), and the backend immediately spends it
 * on a read call. If the network answers with a profile, the credential is
 * real and we store it sealed; if it doesn't, nothing is written and the admin
 * sees the network's own complaint. That means the console can never show
 * "connected" for a credential that would fail at publish time.
 *
 * The profile half of the record lives at `socialAccounts/{platform}` and the
 * console reads it live. The credential half lives one level down at
 * `socialAccounts/{platform}/secret/credentials`, encrypted, and the security
 * rules deny every client read of it — see firestore.rules.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { ADAPTERS, PlatformError } from './platforms';
import { fingerprint, open, seal, tokenVaultReady, type SealedSecret } from './secrets';
import {
  PLATFORMS,
  VIDEO_CAPABLE,
  supports,
  type ContentFormat,
  type Platform,
  type PlatformCredentials,
} from './types';

const platformSchema = z.enum(PLATFORMS);

const connectSchema = z.object({
  platform: platformSchema,
  accessToken: z.string().min(10).max(5000),
  externalId: z.string().max(200).optional(),
  clientId: z.string().max(500).optional(),
  clientSecret: z.string().max(500).optional(),
  /** Optional manual expiry, for networks that don't report one. */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

const accountRef = (platform: Platform) => db.doc(`socialAccounts/${platform}`);
const credentialRef = (platform: Platform) => db.doc(`socialAccounts/${platform}/secret/credentials`);

/** Read back the sealed credential for a connected account. */
export async function loadCredentials(platform: Platform): Promise<PlatformCredentials | null> {
  if (!tokenVaultReady()) return null;
  const snap = await credentialRef(platform).get();
  if (!snap.exists) return null;
  const data = snap.data() as {
    accessToken: SealedSecret;
    clientSecret?: SealedSecret;
    externalId?: string;
    clientId?: string;
  };
  try {
    return {
      accessToken: open(data.accessToken),
      externalId: data.externalId,
      clientId: data.clientId,
      clientSecret: data.clientSecret ? open(data.clientSecret) : undefined,
    };
  } catch (e) {
    logger.error('social: could not decrypt credentials — has SOCIAL_TOKEN_KEY been rotated?', {
      platform,
      e,
    });
    return null;
  }
}

/** Every platform with a working credential right now. */
export async function connectedPlatforms(): Promise<Platform[]> {
  const snap = await db.collection('socialAccounts').where('status', '==', 'connected').get();
  return snap.docs.map((d) => d.id as Platform).filter((p) => PLATFORMS.includes(p));
}

/** The connected platforms that can take this particular format. */
export async function publishableAccounts(format?: ContentFormat): Promise<Platform[]> {
  const connected = await connectedPlatforms();
  if (!format) return connected.filter((p) => VIDEO_CAPABLE.includes(p));
  return connected.filter((p) => supports(p, format));
}

/** Record a failure on the account so the console stops claiming it works. */
export async function markAccountError(platform: Platform, message: string): Promise<void> {
  await accountRef(platform)
    .set({ status: 'error', lastError: message.slice(0, 500), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => undefined);
}

/**
 * Verify a credential against the live network and write the profile it
 * returns. Shared by connect (with freshly pasted values) and re-verify (with
 * the stored ones).
 */
async function verifyAndStore(
  platform: Platform,
  credentials: PlatformCredentials,
  opts: { persist: boolean; uid: string; expiresInDays?: number },
): Promise<Record<string, unknown>> {
  const adapter = ADAPTERS[platform];
  const profile = await adapter.verify(credentials);

  const now = Timestamp.now();
  const publicRecord = {
    platform,
    status: 'connected' as const,
    displayName: profile.displayName,
    handle: profile.handle,
    externalId: profile.externalId,
    followers: profile.followers,
    avatarUrl: profile.avatarUrl,
    canPublishVideo: Boolean(adapter.publish),
    tokenHint: fingerprint(credentials.accessToken),
    tokenExpiresAt: opts.expiresInDays
      ? Timestamp.fromMillis(now.toMillis() + opts.expiresInDays * 86_400_000)
      : null,
    lastVerifiedAt: now,
    lastError: null,
    connectedBy: opts.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(accountRef(platform), publicRecord, { merge: true });
  if (opts.persist) {
    // A full overwrite, not a merge: reconnecting with fewer fields (say a
    // YouTube refresh token without the client secret) must not silently keep
    // the previous run's values around.
    batch.set(credentialRef(platform), {
      accessToken: seal(credentials.accessToken),
      ...(credentials.clientSecret ? { clientSecret: seal(credentials.clientSecret) } : {}),
      ...(credentials.clientId ? { clientId: credentials.clientId } : {}),
      // The id the network *confirmed*, not the one that was typed — Instagram
      // and Facebook both echo back the canonical id, and publishing must use it.
      externalId: profile.externalId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  return publicRecord;
}

/** Paste a credential, prove it, keep it. */
export const adminConnectSocialAccount = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = connectSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { platform, expiresInDays, ...rest } = parsed.data;

  if (!tokenVaultReady()) {
    throw new HttpsError(
      'failed-precondition',
      'The SOCIAL_TOKEN_KEY secret is not configured, so access tokens cannot be stored safely. ' +
        'Generate one with `openssl rand -base64 32`, add it as a GitHub Actions secret, and redeploy.',
    );
  }

  const credentials: PlatformCredentials = {
    accessToken: rest.accessToken.trim(),
    externalId: rest.externalId?.trim() || undefined,
    clientId: rest.clientId?.trim() || undefined,
    clientSecret: rest.clientSecret?.trim() || undefined,
  };

  try {
    const record = await verifyAndStore(platform, credentials, {
      persist: true,
      uid: ctx.uid,
      expiresInDays,
    });
    await db.collection('auditLogs').add({
      type: 'social.connected',
      actor: ctx.uid,
      platform,
      displayName: record.displayName,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, account: { ...record, lastVerifiedAt: Date.now(), updatedAt: Date.now() } };
  } catch (e) {
    const message = e instanceof PlatformError ? e.message : (e as Error).message;
    logger.warn('social: connect rejected', { platform, message });
    throw new HttpsError('failed-precondition', `${ADAPTERS[platform].label} rejected the credential: ${message}`);
  }
});

/** Re-check a stored credential — the console's "is this still good?" button. */
export const adminVerifySocialAccount = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z.object({ platform: platformSchema }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { platform } = parsed.data;

  const credentials = await loadCredentials(platform);
  if (!credentials) throw new HttpsError('not-found', 'That account is not connected.');

  try {
    await verifyAndStore(platform, credentials, { persist: false, uid: ctx.uid });
    return { ok: true };
  } catch (e) {
    const message = e instanceof PlatformError ? e.message : (e as Error).message;
    await markAccountError(platform, message);
    throw new HttpsError('failed-precondition', message);
  }
});

/** Forget a credential entirely. The profile row stays, marked disconnected. */
export const adminDisconnectSocialAccount = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z.object({ platform: platformSchema }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { platform } = parsed.data;

  const batch = db.batch();
  batch.delete(credentialRef(platform));
  batch.set(
    accountRef(platform),
    {
      status: 'disconnected',
      tokenHint: null,
      tokenExpiresAt: null,
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();

  await db.collection('auditLogs').add({
    type: 'social.disconnected',
    actor: ctx.uid,
    platform,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * What the connect form should ask for, per network — kept on the backend so
 * the console never gets out of step with what the adapters actually need.
 */
export const adminGetSocialConnectSchema = onCall(async (req) => {
  requireAdmin(req);
  return {
    vaultReady: tokenVaultReady(),
    platforms: PLATFORMS.map((p) => ({
      platform: p,
      label: ADAPTERS[p].label,
      canPublishVideo: Boolean(ADAPTERS[p].publish),
      fields: ADAPTERS[p].fields,
    })),
  };
});
