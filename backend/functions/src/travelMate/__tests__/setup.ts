/**
 * Global vitest setup — sets emulator env vars before any module import,
 * and initializes firebase-admin once.
 */
import { beforeAll, afterAll } from 'vitest';
import * as admin from 'firebase-admin';

// Must be set before firebase-admin initialises (the first `initializeApp()`
// in any function source file sees these values).
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-velocity';

beforeAll(() => {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'demo-velocity' });
  }
});

afterAll(async () => {
  await Promise.all(admin.apps.filter(Boolean).map(a => a!.delete()));
});
