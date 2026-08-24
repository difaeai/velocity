/**
 * Automation settings — one document, read by the scheduler and edited from
 * the console.
 *
 * Lives under `system/` rather than `config/` because `config/{doc}` is readable
 * by every signed-in user — ride settings and fares belong there, the marketing
 * brief does not. Every field is validated on write: the daily job runs
 * unattended, so a bad value here is a bad post in front of the whole audience.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { writerConfigured } from './script';
import { videoConfigured } from './video';
import { tokenVaultReady } from './secrets';
import { DEFAULT_SETTINGS, PLATFORMS, type SocialSettings } from './types';

const SETTINGS_PATH = 'system/socialAutomation';

export async function getSocialSettings(): Promise<SocialSettings> {
  const snap = await db.doc(SETTINGS_PATH).get();
  return { ...DEFAULT_SETTINGS, ...((snap.data() as Partial<SocialSettings> | undefined) ?? {}) };
}

export async function recordRun(status: string): Promise<void> {
  await db.doc(SETTINGS_PATH).set(
    { lastRunAtMs: Date.now(), lastRunStatus: status.slice(0, 300) },
    { merge: true },
  );
}

/** Advance the rotation and return the angle for this run. */
export async function nextAngle(settings: SocialSettings): Promise<string> {
  const angles = settings.angles.length ? settings.angles : DEFAULT_SETTINGS.angles;
  const index = (settings.lastAngleIndex + 1) % angles.length;
  await db.doc(SETTINGS_PATH).set({ lastAngleIndex: index }, { merge: true });
  return angles[index];
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  runHour: z.number().int().min(0).max(23).optional(),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional(),
  requireApproval: z.boolean().optional(),
  videoProvider: z.enum(['veo', 'none']).optional(),
  videoModel: z.string().min(1).max(120).optional(),
  aspect: z.enum(['9:16', '16:9']).optional(),
  angles: z.array(z.string().min(2).max(60)).min(1).max(30).optional(),
  brandVoice: z.string().max(2000).optional(),
});

export const adminGetSocialSettings = onCall(async (req) => {
  requireAdmin(req);
  const settings = await getSocialSettings();
  return {
    settings,
    /**
     * What is actually wired up. The console shows this as a checklist rather
     * than letting someone switch automation on and discover at 10am that no
     * key was ever added.
     */
    readiness: {
      writer: writerConfigured(),
      video: videoConfigured(settings.videoProvider),
      tokenVault: tokenVaultReady(),
    },
  };
});

export const adminUpdateSocialSettings = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = settingsSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid settings.');

  // Turning automation on is the one change worth guarding: without a writer
  // the job cannot produce anything, and a schedule that fails every morning
  // is worse than one that was never switched on.
  if (parsed.data.enabled === true && !writerConfigured()) {
    throw new HttpsError(
      'failed-precondition',
      'Automation cannot be enabled: ANTHROPIC_API_KEY is not configured, so no script can be written.',
    );
  }

  await db.doc(SETTINGS_PATH).set(
    { ...parsed.data, updatedAt: FieldValue.serverTimestamp(), updatedBy: ctx.uid },
    { merge: true },
  );
  return { ok: true, settings: await getSocialSettings() };
});
