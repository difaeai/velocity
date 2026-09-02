/**
 * Automation settings — one document, read by the crew and edited from the
 * console.
 *
 * Lives under `system/` rather than `config/` because `config/{doc}` is readable
 * by every signed-in user — ride settings and fares belong there, the marketing
 * brief does not. Every field is validated on write: the daily job runs
 * unattended, so a bad value here is a bad post in front of the whole audience.
 *
 * This document is also where "tell all of them something" lives:
 * `crewInstructions` is prepended to every employee's system prompt on every
 * job. Direction for one *person* is not here — it lives on that employee's own
 * record, because it should follow them and disappear when they do.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { activeTeam, coverageGaps } from './employees';
import { claudeReady } from './claude';
import { tokenVaultReady } from './secrets';
import {
  DEFAULT_SETTINGS,
  FORMATS,
  PLATFORMS,
  type ContentFormat,
  type SocialSettings,
} from './types';

const SETTINGS_PATH = 'system/socialAutomation';

export async function getSocialSettings(): Promise<SocialSettings> {
  const snap = await db.doc(SETTINGS_PATH).get();
  const stored = (snap.data() as Partial<SocialSettings> | undefined) ?? {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function recordRun(status: string): Promise<void> {
  await db.doc(SETTINGS_PATH).set(
    { lastRunAtMs: Date.now(), lastRunStatus: status.slice(0, 300) },
    { merge: true },
  );
}

/** Advance the angle rotation and return the angle for this run. */
export async function nextAngle(settings: SocialSettings): Promise<string> {
  const angles = settings.angles.length ? settings.angles : DEFAULT_SETTINGS.angles;
  const index = (settings.lastAngleIndex + 1) % angles.length;
  await db.doc(SETTINGS_PATH).set({ lastAngleIndex: index }, { merge: true });
  return angles[index];
}

/** Advance the format rotation and return the format for this run. */
export async function nextFormat(settings: SocialSettings): Promise<ContentFormat> {
  const formats = settings.formats.length ? settings.formats : DEFAULT_SETTINGS.formats;
  const index = (settings.lastFormatIndex + 1) % formats.length;
  await db.doc(SETTINGS_PATH).set({ lastFormatIndex: index }, { merge: true });
  return formats[index];
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  runHour: z.number().int().min(0).max(23).optional(),
  postsPerDay: z.number().int().min(1).max(5).optional(),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional(),

  angles: z.array(z.string().min(2).max(60)).min(1).max(30).optional(),
  formats: z.array(z.enum(FORMATS)).min(1).max(20).optional(),

  crewInstructions: z.string().max(4000).optional(),

  researchEnabled: z.boolean().optional(),
  competitors: z
    .array(z.object({ name: z.string().min(1).max(80), url: z.string().max(300) }))
    .max(12)
    .optional(),

  textModel: z.string().min(1).max(120).optional(),

  engagementEnabled: z.boolean().optional(),
  autoReply: z.boolean().optional(),
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
      writer: claudeReady(),
      tokenVault: tokenVaultReady(),
    },
    /** What the current roster can and cannot do, in words. */
    coverage: coverageGaps(await activeTeam()),
    staffed: (await activeTeam()).length,
  };
});

export const adminUpdateSocialSettings = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = settingsSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid settings.');

  // Turning automation on is the one change worth guarding: without a key the
  // crew cannot produce anything, and a schedule that fails every morning is
  // worse than one that was never switched on.
  if (parsed.data.enabled === true && !claudeReady()) {
    throw new HttpsError(
      'failed-precondition',
      'Automation cannot be enabled: ANTHROPIC_API_KEY is not configured, so nobody can work.',
    );
  }

  // A schedule with an empty office produces one failed run a day, forever.
  if (parsed.data.enabled === true && !(await activeTeam()).length) {
    throw new HttpsError(
      'failed-precondition',
      'Automation cannot be enabled: nobody works here yet. Hire at least a content writer first.',
    );
  }

  // Auto-reply publishes words to real customers under Velocity's name. It is
  // allowed, but only with the inbox switched on and a key behind it.
  if (parsed.data.autoReply === true) {
    const current = await getSocialSettings();
    const engagementOn = parsed.data.engagementEnabled ?? current.engagementEnabled;
    if (!engagementOn) {
      throw new HttpsError(
        'failed-precondition',
        'Turn the comment inbox on before letting it reply on its own.',
      );
    }
  }

  await db.doc(SETTINGS_PATH).set(
    { ...parsed.data, updatedAt: FieldValue.serverTimestamp(), updatedBy: ctx.uid },
    { merge: true },
  );
  return { ok: true, settings: await getSocialSettings() };
});
