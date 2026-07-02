import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';

const priorityEnum      = z.enum(['standard', 'express', 'same-day']);
const loadTypeEnum      = z.enum(['documents', 'goods', 'perishable', 'fragile']);
const freightStatusEnum = z.enum(['pending', 'quoted', 'confirmed', 'picked_up', 'in_transit', 'delivered', 'cancelled']);

const createRequestSchema = z.object({
  businessName:    z.string().min(1).max(100),
  contactPerson:   z.string().min(1).max(100),
  contactPhone:    z.string().min(7).max(20),
  pickup:          z.string().min(1).max(300),
  dropoff:         z.string().min(1).max(300),
  priority:        priorityEnum,
  loadType:        loadTypeEnum,
  notes:           z.string().max(500).optional(),
  estimatedQuote:  z.number().int().positive(),
});

const cancelRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
});

const acceptQuoteSchema = z.object({
  requestId: z.string().min(1).max(128),
});

const adminUpdateSchema = z.object({
  requestId:  z.string().min(1).max(128),
  status:     freightStatusEnum,
  finalQuote: z.number().int().positive().optional(),
  adminNote:  z.string().max(500).optional(),
});

export const createFreightRequest = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const input   = createRequestSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.message);

  const ref = db.collection('freightRequests').doc();
  await ref.set({
    passengerId:    uid,
    businessName:   input.data!.businessName,
    contactPerson:  input.data!.contactPerson,
    contactPhone:   input.data!.contactPhone,
    pickup:         input.data!.pickup,
    dropoff:        input.data!.dropoff,
    priority:       input.data!.priority,
    loadType:       input.data!.loadType,
    notes:          input.data!.notes ?? null,
    estimatedQuote: input.data!.estimatedQuote,
    finalQuote:     null,
    adminNote:      null,
    status:         'pending',
    createdAt:      FieldValue.serverTimestamp(),
    updatedAt:      FieldValue.serverTimestamp(),
  });

  await notifyUser(
    uid,
    'Freight Request Submitted 💼',
    `Your freight quote request for ${input.data!.businessName} has been received. Our team will respond within 30 minutes.`,
    'ride',
  );

  return { ok: true, requestId: ref.id };
});

export const cancelFreightRequest = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const input   = cancelRequestSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.message);

  const ref  = db.collection('freightRequests').doc(input.data!.requestId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Request not found');

  const data = snap.data()!;
  if (data.passengerId !== uid) invalid('Not your request');
  if (!['pending', 'quoted'].includes(data.status as string)) {
    invalid('Cannot cancel — freight is already in progress');
  }

  await ref.update({
    status:    'cancelled',
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

export const acceptFreightQuote = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const input   = acceptQuoteSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.message);

  const ref  = db.collection('freightRequests').doc(input.data!.requestId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Request not found');

  const data = snap.data()!;
  if (data.passengerId !== uid) invalid('Not your request');
  if (data.status !== 'quoted') invalid('No active quote to accept');

  await ref.update({
    status:    'confirmed',
    updatedAt: FieldValue.serverTimestamp(),
  });

  await notifyUser(uid, 'Quote Accepted ✅', 'You have confirmed the freight quote. Our team will proceed with your delivery.', 'ride');
  return { ok: true };
});

export const adminUpdateFreightStatus = onCall(async (req) => {
  requireAdmin(req);
  const input = adminUpdateSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.message);

  const ref  = db.collection('freightRequests').doc(input.data!.requestId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Request not found');

  const updates: Record<string, unknown> = {
    status:    input.data!.status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.data!.finalQuote !== undefined) updates.finalQuote = input.data!.finalQuote;
  if (input.data!.adminNote  !== undefined) updates.adminNote  = input.data!.adminNote;

  await ref.update(updates);

  const data = snap.data()!;
  const statusMessages: Record<string, [string, string]> = {
    quoted:     ['Quote Ready 💰', 'Your freight quote is ready. Please review and confirm in the app.'],
    confirmed:  ['Freight Confirmed ✅', 'Your freight order is confirmed and our team is arranging logistics.'],
    picked_up:  ['Cargo Picked Up 🚛', 'Your cargo has been collected and loaded.'],
    in_transit: ['In Transit 🛣️', 'Your freight shipment is on its way.'],
    delivered:  ['Delivered! ✅', 'Your freight has been delivered successfully.'],
    cancelled:  ['Order Cancelled', 'Your freight request has been cancelled by the team.'],
  };

  const msg = statusMessages[input.data!.status];
  if (msg) {
    await notifyUser(data.passengerId as string, msg[0], msg[1], 'ride');
  }

  return { ok: true };
});
