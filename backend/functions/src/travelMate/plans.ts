/**
 * Travel Mate — admin plan management callables.
 * Plans live in travelMatePlans/{planId}.
 * Soft-delete only: plans are never hard-deleted so existing sub docs that
 * reference them by planId remain readable.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, invalid } from '../lib/guards';

const REGION = 'asia-south1';

const PlanInput = z.object({
  name: z.string().trim().min(1).max(60),
  billingPeriod: z.enum(['weekly', 'yearly']),
  pricePKR: z.number().positive(),
  dailyLikeAllowance: z.number().int().positive().max(9999),
  active: z.boolean().default(true),
});

const UpdatePlanInput = z.object({
  planId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(60).optional(),
  billingPeriod: z.enum(['weekly', 'yearly']).optional(),
  pricePKR: z.number().positive().optional(),
  dailyLikeAllowance: z.number().int().positive().max(9999).optional(),
  active: z.boolean().optional(),
});

const DeletePlanInput = z.object({
  planId: z.string().min(1).max(128),
});

export const adminCreateTravelMatePlan = onCall({ region: REGION }, async (req) => {
  const ctx = requireAdmin(req);
  const parsed = PlanInput.safeParse(req.data);
  if (!parsed.success) invalid('Invalid plan data.');
  const p = parsed.data;

  const ref = db.collection('travelMatePlans').doc();
  await ref.set({
    ...p,
    createdBy: ctx.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('auditLogs').add({
    action: 'travelMate.plan.created',
    planId: ref.id,
    by: ctx.uid,
    data: p,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, planId: ref.id };
});

export const adminUpdateTravelMatePlan = onCall({ region: REGION }, async (req) => {
  const { uid: adminUid } = requireAdmin(req);
  const parsed = UpdatePlanInput.safeParse(req.data);
  if (!parsed.success) invalid('Invalid plan update data.');
  const { planId, ...updates } = parsed.data;

  const ref = db.doc(`travelMatePlans/${planId}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('Plan not found.');

  await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });

  await db.collection('auditLogs').add({
    action: 'travelMate.plan.updated',
    planId,
    by: adminUid,
    updates,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

export const adminDeleteTravelMatePlan = onCall({ region: REGION }, async (req) => {
  const { uid: adminUid } = requireAdmin(req);
  const parsed = DeletePlanInput.safeParse(req.data);
  if (!parsed.success) invalid('Provide a planId.');
  const { planId } = parsed.data;

  const ref = db.doc(`travelMatePlans/${planId}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('Plan not found.');

  await ref.update({
    active: false,
    deletedAt: FieldValue.serverTimestamp(),
    deletedBy: adminUid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});
