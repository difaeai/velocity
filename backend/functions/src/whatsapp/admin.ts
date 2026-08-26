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
import { rateLimit } from '../lib/ratelimit';
import { sendTemplate, toWhatsAppNumber, whatsAppConfig } from './client';
import { driverDeepLink } from './alerts';
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

const testSchema = z.object({
  /** The tester's own WhatsApp number. Never a driver's. */
  phone: z.string().min(6).max(24),
});

/**
 * Sends one real template message to a number the admin types, and reports
 * exactly what Meta said.
 *
 * This exists because of what setup day looks like without it. The template
 * name, its language code, the token, the phone-number id and the parameter
 * count all have to agree, and every way they can disagree comes back as a
 * `halt` — which is the correct response for a live system (every send would
 * fail identically) but a terrible first experience: one wrong character in
 * WHATSAPP_TEMPLATE_LANG and the feature switches itself off platform-wide
 * before it has ever delivered a message.
 *
 * So this path deliberately does NOT trip the breaker and does NOT touch any
 * driver record or the daily budget. It is a wiring check, and it hands back
 * the raw error code so the mismatch names itself.
 *
 * The consent rules still apply in spirit: admin-only, rate-limited, logged,
 * and pointed at a number the person running it typed in themselves — the same
 * thing Meta's own API Setup page does. It is not a way to message drivers.
 */
export const adminSendWhatsAppTest = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = testSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Provide a phone number to test.');

  // Low enough that this can never become a way to send real volume, high
  // enough to iterate on a template mismatch without waiting.
  await rateLimit(ctx.uid, 'adminSendWhatsAppTest', 10, 3600);

  const cfg = whatsAppConfig();
  if (!cfg) {
    return {
      ok: false,
      stage: 'config' as const,
      detail:
        'No WhatsApp credentials on the backend. WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and ' +
        'WHATSAPP_TEMPLATE_NAME must all be set (see docs/WHATSAPP_ALERTS.md).',
    };
  }

  const to = toWhatsAppNumber(parsed.data.phone);
  if (!to) {
    return {
      ok: false,
      stage: 'number' as const,
      detail: 'Not a valid Pakistani mobile. Use 03XX XXXXXXX or +92 3XX XXXXXXX.',
    };
  }

  logger.info('WhatsApp: admin test send', { by: ctx.uid, template: cfg.templateName });

  // The same four parameters and the same URL suffix a real alert uses, so a
  // parameter-count or format mismatch shows up here rather than in production.
  const res = await sendTemplate(cfg, to, ['Tester', 'Moto', '250', 'F-10 Markaz'], 'TEST123');

  if (res.ok) {
    return {
      ok: true,
      messageId: res.messageId,
      template: cfg.templateName,
      language: cfg.templateLang,
      buttonUrl: driverDeepLink('TEST123'),
    };
  }

  return {
    ok: false,
    stage: 'send' as const,
    code: res.code,
    detail: res.detail,
    // The two mismatches that account for almost every failed first attempt,
    // named rather than left to be inferred from a numeric code.
    hint:
      res.code === 132001
        ? `Meta has no template "${cfg.templateName}" in language "${cfg.templateLang}". ` +
          'Check the exact name and the language code shown in WhatsApp Manager — ' +
          'a template created as en_US will not answer to en.'
        : res.code === 132000
          ? 'The template expects a different number of variables than the four this sends. ' +
            'The body must have exactly {{1}}–{{4}} and the URL button exactly one variable.'
          : null,
  };
});
