/**
 * Travel Mate — admin moderation actions.
 * adminSuspendTravelMateProfile — sets travelMateProfiles/{uid}.active = false,
 *   records the action in auditLogs.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, invalid } from '../lib/guards';

const REGION = 'asia-south1';

const SuspendInput = z.object({
  targetUid: z.string().min(1).max(128),
  reason: z.string().trim().max(500).optional(),
});

export const adminSuspendTravelMateProfile = onCall({ region: REGION }, async (req) => {
  const { uid: adminUid } = requireAdmin(req);
  const parsed = SuspendInput.safeParse(req.data);
  if (!parsed.success) invalid('Provide a targetUid.');
  const { targetUid, reason } = parsed.data;

  const profRef = db.doc(`travelMateProfiles/${targetUid}`);
  const snap = await profRef.get();
  if (!snap.exists) invalid('Profile not found.');

  await profRef.update({ active: false, suspendedAt: FieldValue.serverTimestamp() });

  await db.collection('auditLogs').add({
    action: 'travelMate.profile.suspended',
    targetUid,
    reason: reason ?? null,
    by: adminUid,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});
