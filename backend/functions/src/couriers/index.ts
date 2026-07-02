import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';

const packageTypeEnum  = z.enum(['document', 'parcel', 'box']);
const courierStatusEnum = z.enum(['pending', 'accepted', 'picked_up', 'delivered', 'cancelled']);

const createOrderSchema = z.object({
  pickup:         z.string().min(1).max(300),
  dropoff:        z.string().min(1).max(300),
  packageType:    packageTypeEnum,
  offeredFare:    z.number().int().min(50).max(5000),
  recipientName:  z.string().min(1).max(100),
  recipientPhone: z.string().min(7).max(20),
  instructions:   z.string().max(500).optional(),
});

const cancelOrderSchema = z.object({
  orderId: z.string().min(1).max(128),
});

const adminUpdateSchema = z.object({
  orderId:     z.string().min(1).max(128),
  status:      courierStatusEnum,
  driverName:  z.string().max(64).optional(),
  driverPhone: z.string().max(20).optional(),
  note:        z.string().max(300).optional(),
});

export const createCourierOrder = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const input   = createOrderSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.message);

  const orderRef = db.collection('courierOrders').doc();
  await orderRef.set({
    passengerId:    uid,
    pickup:         input.data!.pickup,
    dropoff:        input.data!.dropoff,
    packageType:    input.data!.packageType,
    offeredFare:    input.data!.offeredFare,
    recipientName:  input.data!.recipientName,
    recipientPhone: input.data!.recipientPhone,
    instructions:   input.data!.instructions ?? null,
    status:         'pending',
    driverId:       null,
    driverName:     null,
    driverPhone:    null,
    createdAt:      FieldValue.serverTimestamp(),
    updatedAt:      FieldValue.serverTimestamp(),
  });

  await notifyUser(uid, 'Courier Order Placed 📦', `Looking for a courier for your ${input.data!.packageType}. Offer: PKR ${input.data!.offeredFare}`, 'ride');

  return { ok: true, orderId: orderRef.id };
});

export const cancelCourierOrder = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const input   = cancelOrderSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.message);

  const ref  = db.collection('courierOrders').doc(input.data!.orderId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Order not found');

  const data = snap.data()!;
  if (data.passengerId !== uid) invalid('Not your order');
  if (!['pending', 'accepted'].includes(data.status as string)) {
    invalid('Cannot cancel — order already picked up or completed');
  }

  await ref.update({
    status:    'cancelled',
    updatedAt: FieldValue.serverTimestamp(),
  });

  await notifyUser(uid, 'Courier Cancelled', 'Your courier order has been cancelled.', 'ride');
  return { ok: true };
});

export const adminUpdateCourierStatus = onCall(async (req) => {
  requireAdmin(req);
  const input = adminUpdateSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.message);

  const ref  = db.collection('courierOrders').doc(input.data!.orderId);
  const snap = await ref.get();
  if (!snap.exists) invalid('Order not found');

  const updates: Record<string, unknown> = {
    status:    input.data!.status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.data!.driverName  !== undefined) updates.driverName  = input.data!.driverName;
  if (input.data!.driverPhone !== undefined) updates.driverPhone = input.data!.driverPhone;
  if (input.data!.note        !== undefined) updates.adminNote   = input.data!.note;

  await ref.update(updates);

  const data = snap.data()!;
  const statusMessages: Record<string, [string, string]> = {
    accepted:   ['Courier Found! 🎉', 'A courier has accepted your order and is heading to pick it up.'],
    picked_up:  ['Package Picked Up 📦', 'Your package has been collected and is on its way.'],
    delivered:  ['Delivered! ✅', 'Your package has been delivered successfully.'],
    cancelled:  ['Order Cancelled', 'Your courier order was cancelled by the team.'],
  };

  const msg = statusMessages[input.data!.status];
  if (msg) {
    await notifyUser(data.passengerId as string, msg[0], msg[1], 'ride');
  }

  return { ok: true };
});
