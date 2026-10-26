/**
 * The new-account trigger fills in defaults and never overwrites what the
 * creating callable already set — in prod it reset both admin-made drivers'
 * users docs to 'passenger'.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { onUserCreate } from '../index';

const run = async (uid: string) => onUserCreate.run(await admin.auth().getUser(uid), {} as never);

beforeEach(async () => {
  await clearFirestore();
  for (const uid of ['made-driver', 'fresh-rider']) await admin.auth().deleteUser(uid).catch(() => undefined);
});

describe('onUserCreate', () => {
  it('keeps the role, profile and wallet a callable set before it ran', async () => {
    await admin.auth().createUser({ uid: 'made-driver', email: 'driver@e2e.test' });
    await admin.auth().setCustomUserClaims('made-driver', { role: 'driver', ws: 'w1' });
    await db().doc('users/made-driver').set({ role: 'driver', phoneNumber: '+923001234567' });
    await db().doc('wallets/made-driver').set({ balance: 500 });

    await run('made-driver');

    expect((await admin.auth().getUser('made-driver')).customClaims).toEqual({ role: 'driver', ws: 'w1' });
    expect((await db().doc('users/made-driver').get()).data()).toMatchObject({ role: 'driver', phoneNumber: '+923001234567' });
    expect((await db().doc('wallets/made-driver').get()).get('balance')).toBe(500);
  });

  it('provisions a passenger with an empty wallet when nothing was set', async () => {
    await admin.auth().createUser({ uid: 'fresh-rider', phoneNumber: '+923009998877' });
    await run('fresh-rider');

    expect((await admin.auth().getUser('fresh-rider')).customClaims).toEqual({ role: 'passenger' });
    expect((await db().doc('users/fresh-rider').get()).data()).toMatchObject({ role: 'passenger', phoneNumber: '+923009998877' });
    expect((await db().doc('wallets/fresh-rider').get()).get('balance')).toBe(0);
  });
});
