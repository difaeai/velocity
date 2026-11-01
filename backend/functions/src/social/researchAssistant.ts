/**
 * The Research Assistant — Velocity Studio's research plan, and the member of
 * the whole team who works before anyone spends.
 *
 * It reads the market and the competitors (the launch sequence's market step)
 * and the owner's own page (`insights.ts`), and its own job is the dummy
 * campaign: a campaign planned like a real one, shown to a simulated audience
 * and priced at what the money would buy — with nothing made at Meta and
 * nothing spent (`dummyCampaign` in ads.ts). What it finds goes to the Social
 * Media Manager: every campaign the manager plans reads the latest dummies, and
 * every real one is run as a dummy before Meta sees it.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { dummyCampaign } from './ads';
import { deskCall } from './workspace';

export const researchDummyCampaign = deskCall('research', { timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  // Up to three model calls a run: the AI month caps the cost, this caps a runaway tab.
  await rateLimit(requireAuth(req).uid, 'researchDummy', 20, 3600);
  const parsed = z
    .object({
      brief: z.string().trim().min(10).max(2000),
      dailyBudget: z.number().positive().max(10_000_000).optional(),
      days: z.number().int().min(1).max(30).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Say in a sentence or two what the campaign is for and who it should reach.');
  }
  // Only the id: the page reads the run itself, and a callable cannot carry every number a forecast can hold.
  return { ok: true, id: await dummyCampaign(parsed.data) };
});
