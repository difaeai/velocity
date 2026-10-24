/**
 * Connect once, stay connected.
 *
 * On 2026-10-24 the comment sync asked Instagram for the comments under a
 * story, Meta answered "…cannot be loaded due to missing permissions, or does
 * not support this operation", the word "permission" flagged the whole account
 * and every post after it skipped Instagram — a 157k account, perfectly
 * healthy. An account is flagged only when its own credential fails a re-check,
 * and one flagged that answers again comes back by itself.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { flagIfDead, healAccounts } from '../accounts';
import { ADAPTERS, PlatformError } from '../platforms';
import { seal } from '../secrets';
import type { PlatformCredentials, PlatformProfile } from '../types';

const CREDS: PlatformCredentials = { accessToken: 'page-token-123456', externalId: '17841432474663606' };
const PROFILE: PlatformProfile = {
  displayName: 'Velocity Rides',
  handle: '@velocityrides.app',
  externalId: '17841432474663606',
  followers: 157698,
  avatarUrl: null,
};
const STORY_REFUSAL =
  "Unsupported get request. Object with ID '18386467501234354' does not exist, cannot be loaded due to missing permissions, or does not support this operation.";

const realVerify = ADAPTERS.instagram.verify;
let verifyAnswer: () => Promise<PlatformProfile>;

beforeAll(() => {
  process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  ADAPTERS.instagram.verify = () => verifyAnswer();
});

beforeEach(async () => {
  await clearFirestore();
  verifyAnswer = async () => PROFILE;
  await db().doc('socialAccounts/instagram').set({ platform: 'instagram', status: 'connected', connectedBy: 'admin-1' });
  await db()
    .doc('socialAccounts/instagram/secret/credentials')
    .set({ accessToken: seal(CREDS.accessToken), externalId: CREDS.externalId });
});

afterEach(() => {
  verifyAnswer = async () => PROFILE;
});

const status = async () => (await db().doc('socialAccounts/instagram').get()).get('status');

describe('a failed call', () => {
  it('leaves a working account connected when the refusal was about one post', async () => {
    await flagIfDead('instagram', CREDS, STORY_REFUSAL);
    expect(await status()).toBe('connected');
  });

  it('flags the account when the credential itself is refused', async () => {
    verifyAnswer = async () => {
      throw new PlatformError('instagram', 'Error validating access token: The user has not authorized application.');
    };
    await flagIfDead('instagram', CREDS, 'Invalid OAuth access token.');
    expect(await status()).toBe('error');
  });

  it('flags nothing when the re-check could not reach the network', async () => {
    verifyAnswer = async () => {
      throw new PlatformError('instagram', 'Network error talking to instagram: ECONNRESET');
    };
    await flagIfDead('instagram', CREDS, 'Invalid OAuth access token.');
    expect(await status()).toBe('connected');
  });

  it('does not even re-check for an error that is not about access', async () => {
    let checked = false;
    verifyAnswer = async () => {
      checked = true;
      return PROFILE;
    };
    await flagIfDead('instagram', CREDS, 'The video file is too short.');
    expect(checked).toBe(false);
  });
});

describe('the hourly re-check', () => {
  it('brings a flagged account back once its token answers, keeping who connected it', async () => {
    await db().doc('socialAccounts/instagram').update({ status: 'error', lastError: STORY_REFUSAL });
    await healAccounts();
    const doc = (await db().doc('socialAccounts/instagram').get()).data()!;
    expect(doc.status).toBe('connected');
    expect(doc.lastError).toBeNull();
    expect(doc.followers).toBe(157698);
    expect(doc.connectedBy).toBe('admin-1');
  });

  it('leaves the red badge on a token the network still refuses', async () => {
    await db().doc('socialAccounts/instagram').update({ status: 'error', lastError: 'expired' });
    verifyAnswer = async () => {
      throw new PlatformError('instagram', 'Session has expired.');
    };
    await healAccounts();
    expect(await status()).toBe('error');
  });
});

// Every suite shares one fork: put the real adapter back for the ones after this.
afterAll(() => {
  ADAPTERS.instagram.verify = realVerify;
});
