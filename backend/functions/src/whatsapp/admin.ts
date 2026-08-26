/**
 * The admin desk for WhatsApp alerts: what the channel is doing, and the two
 * levers for changing it.
 *
 * The important one is re-arming the circuit breaker. When Meta returns a code
 * that means the account is in trouble, sending stops and stays stopped — and
 * clearing that is deliberately a human action taken here, after looking at the
 * quality rating in WhatsApp Manager, rather than anything the backend can talk
 * itself into. A breaker that resets itself is not a breaker.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { whatsAppConfig } from './client';
import { pktDayKey, readAlertSettings } from './policy';

const SETTINGS_DOC = 'config/whatsappAlerts';
const HEALTH_DOC = 'config/whatsappHealth';

/**
 * Everything the admin console needs to answer "is this working, and is it
 * safe?" in one call.
 */
export const adminGetWhatsAppStatus = onCall(async (req) => {
  requireAdmin(req);
  const now = Date.now();
  const day = pktDayKey(now);

  const [settingsSnap, healthSnap, usageSnap, optedInSnap] = await Promise.all([
    db.doc(SETTINGS_DOC).get(),
    db.doc(HEALTH_DOC).get(),
    db.doc(`whatsappUsage/${day}`).get(),
    db.collection('drivers').where('whatsappAlerts.optIn', '==', true).count().get(),
  ]);

  const settings = readAlertSettings(settingsSnap.exists ? settingsSnap.data() : null);
  const sent = (usageSnap.get('sent') as number | undefined) ?? 0;
  const failed = (usageSnap.get('failed') as number | undefined) ?? 0;
  const optOuts = (usageSnap.get('optOuts') as number | undefined) ?? 0;

  return {
    configured: whatsAppConfig() !== null,
    settings,
    health: {
      circuitOpen: healthSnap.get('circuitOpen') === true,
      reason: (healthSnap.get('reason') as string | undefined) ?? null,
      code: (healthSnap.get('code') as number | undefined) ?? null,
    },
    today: {
      day,
      reserved: (usageSnap.get('reserved') as number | undefined) ?? 0,
      sent,
      failed,
      dropped: (usageSnap.get('dropped') as number | undefined) ?? 0,
      optOuts,
      /**
       * The number to actually watch. Meta's quality rating tracks how many
       * recipients react badly, and opt-outs are the earliest visible proxy for
       * it — a rising rate here is the warning that arrives days before a
       * rating drop does.
       */
      optOutRate: sent > 0 ? Number((optOuts / sent).toFixed(3)) : 0,
    },
    optedInDrivers: optedInSnap.data().count,
  };
});

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  radiusKm: z.number().optional(),
  minGapMinutes: z.number().optional(),
  maxPerDriverPerDay: z.number().optional(),
  maxRecipientsPerTrip: z.number().optional(),
  dailyGlobalCap: z.number().optional(),
  quietStartHour: z.number().optional(),
  quietEndHour: z.number().optional(),
  onlineDriverThreshold: z.number().optional(),
  staleDriverDays: z.number().optional(),
  minFare: z.number().optional(),
  /**
   * Clears the circuit breaker. Separate from the settings above and never
   * implied by them: turning the feature "on" must not silently undo a stop
   * that Meta asked for.
   */
  clearCircuitBreaker: z.boolean().optional(),
});

export const adminSetWhatsAppAlertSettings = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = settingsSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid settings.');
  const { clearCircuitBreaker, ...fields } = parsed.data;

  const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length > 0) {
    // Written raw; `readAlertSettings` clamps on the way out, so an out-of-range
    // value here can never become an out-of-range send.
    await db.doc(SETTINGS_DOC).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  if (clearCircuitBreaker) {
    logger.warn('WhatsApp: circuit breaker re-armed by admin', { by: ctx.uid });
    await db.doc(HEALTH_DOC).set(
      {
        circuitOpen: false,
        clearedAt: FieldValue.serverTimestamp(),
        clearedBy: ctx.uid,
      },
      { merge: true },
    );
  }

  const snap = await db.doc(SETTINGS_DOC).get();
  return { ok: true, settings: readAlertSettings(snap.data()) };
});
