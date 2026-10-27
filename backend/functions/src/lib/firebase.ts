/** Centralised Firebase Admin initialisation. */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
export { FieldValue, Timestamp };

/**
 * Where scheduled jobs run. Firestore is nam5 (US), so from asia-south1 every
 * read crosses the ocean and the job is billed while it waits; a job has no
 * caller to be close to. Never for a job that builds its own URL from
 * FUNCTION_REGION (agents, payments).
 */
export const SCHEDULE_REGION = 'us-central1';
