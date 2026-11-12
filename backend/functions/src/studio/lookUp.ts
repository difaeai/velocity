/**
 * Velocity Studio sign-up — Vexa working the business out for herself.
 *
 * The sign-up used to open with seven empty boxes, which is the worst thing a
 * product that claims to think can ask for (owner, 2026-11-12). So the step now
 * offers two doors: hand Vexa the page you already have — a website, an
 * Instagram or Facebook page, a Google listing — and she reads it and fills the
 * brief in, or type it yourself if you would rather.
 *
 * She reads it with the engine's own server-side search (Claude's when the
 * house pays for it, Gemini's free tier otherwise), so no page is scraped here
 * and the model reports the addresses it actually read. Anything she is not
 * sure of comes back empty rather than invented — the customer sees every field
 * before it is saved, and an empty box is honest where a plausible lie is not.
 *
 * Only a customer who has already paid may call it: the pay step comes first,
 * so `prepaid` exists by the time this screen does, and that is what keeps a
 * grounded call off a stranger's tab. Six an hour on top of that.
 */
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { generateJson, modelReady } from '../social/engine';
import { PLATFORMS } from '../social/types';
import { HOUSE, inWorkspace } from '../social/workspace';
import type { Prepaid } from './plans';

const askSchema = z.object({
  /** A website, or the address of a social page — whatever the customer already has. */
  link: z.string().trim().min(3).max(300),
});

/** What comes back: the brief's fields, the networks worth posting on, and why. */
export interface LookUp {
  businessName: string;
  what: string;
  audience: string;
  market: string;
  language: string;
  differences: string;
  website: string;
  platforms: string[];
  /** One or two sentences in Vexa's voice: what she would do for this business. */
  plan: string;
  /** Empty when she found the page; set when she did not and is guessing from the address alone. */
  thin: boolean;
}

const SYSTEM = `You are Vexa, a social media manager meeting a new customer. You have been handed one address — their website, or their Instagram, Facebook, TikTok, YouTube or Google Business page — and nothing else.

Search for it and read what is actually there, then fill in the brief below.

Rules that matter more than completeness:
- Report what you read, never what sounds plausible. If the page does not say who buys from them, leave "audience" empty. An empty field is a usable answer; an invented one costs us the customer on day one.
- "market" is the city and country they sell in, as a human would write it ("Lahore, Pakistan").
- "language" is the language their own posts are in, not the language of the page's menu.
- "platforms" lists only networks from this list that suit THIS business, most important first: ${PLATFORMS.join(', ')}. Two to four of them. A restaurant is not on LinkedIn.
- "plan" is one or two sentences to the owner, in the second person, saying what you would post for them and why. No bullet points, no marketing adjectives, no promises about results.
- "thin" is true if the search did not actually find their page and you are working from the address alone.`;

const PROMPT = (link: string) =>
  `The address they gave me: ${link}

Reply with one JSON object and nothing else:
{"businessName":"","what":"what they sell, one sentence","audience":"who buys it","market":"city, country","language":"","differences":"why people pick them, or empty","website":"their website if you found one, else empty","platforms":[],"plan":"","thin":false}`;

export const studioLookUpBusiness = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (ctx.token.ws) throw new HttpsError('already-exists', 'This account already has a Vexa workspace.');
  const prepaid = ((await db.doc(`studioUsers/${ctx.uid}`).get()).get('prepaid') as Prepaid | undefined) ?? null;
  if (!prepaid) throw new HttpsError('failed-precondition', 'Pay for a plan first — then I will look you up.');
  const parsed = askSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Give me your website or the address of your page.');
  await rateLimit(ctx.uid, 'studioLookUp', 6, 3600);

  return inWorkspace(HOUSE, async () => {
    // Nothing here can search the web, and a brief composed out of nothing is
    // worse than the form the customer can fill in themselves.
    if (!modelReady()) {
      throw new HttpsError('unavailable', 'I cannot look anyone up just now — tell me about the business instead.');
    }
    let data: LookUp;
    try {
      ({ data } = await generateJson<LookUp>({
        model: '',
        system: SYSTEM,
        prompt: PROMPT(parsed.data.link),
        grounded: true,
        what: 'A new customer’s business, read from their page',
      }));
    } catch (e) {
      logger.warn('studio: look-up failed', { error: e instanceof Error ? e.message : String(e) });
      throw new HttpsError('unavailable', 'I could not read that page. Try another address, or tell me yourself.');
    }
    return cleanLookUp(data, parsed.data.link);
  });
});

/** The model's answer, cut to the lengths `studioCreateWorkspace` will accept and with nothing it invented in `platforms`. */
export function cleanLookUp(d: Partial<LookUp>, link: string): LookUp {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const looksLikeUrl = /^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i.test(link);
  return {
    businessName: str(d.businessName, 80),
    what: str(d.what, 600),
    audience: str(d.audience, 400),
    market: str(d.market, 120),
    language: str(d.language, 80) || 'English',
    differences: str(d.differences, 1200),
    // Her own find first; the address they typed only if it was a web address at all.
    website: str(d.website, 200) || (looksLikeUrl ? link.slice(0, 200) : ''),
    platforms: (Array.isArray(d.platforms) ? d.platforms : [])
      .filter((p): p is string => typeof p === 'string' && (PLATFORMS as readonly string[]).includes(p))
      .slice(0, 4),
    plan: str(d.plan, 400),
    thin: d.thin === true,
  };
}
