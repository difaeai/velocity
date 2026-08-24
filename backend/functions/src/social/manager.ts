/**
 * The distribution stage — the part of the manager's job that happens before
 * anything is posted.
 *
 * One caption does not work on five networks. The same idea wants a hook and a
 * line break on Instagram, a title and a description on YouTube, 280 characters
 * on X, and something a professional would not be embarrassed to have on their
 * LinkedIn feed. So the last thing the crew does before the queue is rewrite
 * the caption per network, and say which networks it thinks this belongs on.
 *
 * What it does *not* do is publish. Nothing this desk makes reaches an audience
 * without an admin approving it in the queue — see pipeline.ts.
 */
import { logger } from 'firebase-functions';

import { feedbackBlock, planBlock, systemFor } from './crew';
import { generateJson } from './gemini';
import {
  FORMAT_SPECS,
  PLATFORMS,
  supports,
  type ContentFormat,
  type ContentPlan,
  type Employee,
  type Platform,
  type PostScript,
  type SearchPack,
  type SocialSettings,
} from './types';

/** Where a caption stops being a caption on each network. */
const CAPTION_LIMITS: Record<Platform, number> = {
  facebook: 2000,
  instagram: 2200,
  youtube: 4000,
  tiktok: 2200,
  threads: 500,
  x: 280,
  linkedin: 3000,
};

export interface Distribution {
  /** Per-network caption. Anything missing falls back to the master caption. */
  captions: Partial<Record<Platform, string>>;
  /** Which of the candidate networks Awaaz would actually post this to. */
  targets: Platform[];
  note: string;
}

/**
 * Rewrite per network and pick the targets.
 *
 * Falls back to the master caption everywhere if the call fails: a post that
 * goes out with one caption on five networks is a worse post, not a broken one.
 */
export async function planDistribution(params: {
  employee: Employee;
  settings: SocialSettings;
  format: ContentFormat;
  script: PostScript;
  plan: ContentPlan | null;
  caption: string;
  hashtags: string[];
  /** The search desk's YouTube copy, when they have written it. */
  search: SearchPack | null;
  /** Connected networks that can take this format. */
  candidates: Platform[];
  feedback: string[];
}): Promise<Distribution> {
  const candidates = params.candidates.filter((p) => supports(p, params.format));
  if (!candidates.length) {
    return { captions: {}, targets: [], note: 'No connected network can take this format.' };
  }

  const fallback: Distribution = {
    captions: {},
    targets: candidates,
    note: 'Posting the same caption everywhere.',
  };

  try {
    const { data } = await generateJson<{ captions?: Record<string, unknown>; targets?: unknown; note?: unknown }>({
      model: params.settings.textModel,
      system: `${systemFor(params.employee, params.settings)}

You are adapting one finished piece for each network it is going to, and deciding where it belongs.

Per network:
- instagram: hook on line one, a line break, then the body. Hashtags at the end.
- facebook: slightly longer, plainer, no hashtag wall. Written for people who read the whole thing.
- threads: short and conversational, like you are talking to someone. Two lines at most.
- x: under 280 characters including everything. One idea, no hashtag soup.
- linkedin: the business angle — livelihoods, fleets, what the model does differently. No emoji spam.
- youtube: the first line is the title's promise; the rest is a real description.
- tiktok: short, native, one or two tags.

Drop a network from targets if the piece genuinely does not belong there. Do not drop one just to be safe.

Reply with one JSON object and nothing else:
{ "captions": { "instagram": "...", "facebook": "..." }, "targets": ["instagram", "facebook"], "note": "one line on the call you made" }`,
      what: 'The distribution plan',
      temperature: 0.85,
      maxOutputTokens: 2500,
      prompt: [
        `FORMAT: ${FORMAT_SPECS[params.format].label}`,
        `CANDIDATE NETWORKS (only these): ${candidates.join(', ')}`,
        planBlock(params.plan, params.employee),
        '',
        `HOOK: ${params.script.hook}`,
        params.script.cta ? `CTA: ${params.script.cta}` : '',
        '',
        `MASTER CAPTION:\n${params.caption}`,
        params.search?.youtube
          ? `THE SEARCH DESK HAS ALREADY WRITTEN THE YOUTUBE COPY — do not rewrite it, it is used verbatim:\n${params.search.youtube.title}`
          : '',
        params.hashtags.length ? `HASHTAGS: ${params.hashtags.map((h) => `#${h}`).join(' ')}` : '',
        feedbackBlock(params.feedback),
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const captions: Partial<Record<Platform, string>> = {};
    for (const platform of PLATFORMS) {
      const value = data.captions?.[platform];
      if (typeof value === 'string' && value.trim()) {
        captions[platform] = value.trim().slice(0, CAPTION_LIMITS[platform]);
      }
    }

    const targets = Array.isArray(data.targets)
      ? (data.targets as unknown[])
          .filter((t): t is Platform => typeof t === 'string' && candidates.includes(t as Platform))
      : [];

    return {
      captions,
      // An empty or nonsense target list means the model lost the thread, not
      // that nothing should be posted.
      targets: targets.length ? targets : candidates,
      note: (typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '') || 'Captions written per network.',
    };
  } catch (e) {
    logger.warn('social: the manager could not write per-network captions', { message: (e as Error).message });
    return fallback;
  }
}

/** The caption that actually goes to one network. */
export function captionFor(
  platform: Platform,
  master: string,
  captions: Partial<Record<Platform, string>> | undefined,
): string {
  const specific = captions?.[platform];
  return (specific && specific.trim() ? specific : master).slice(0, CAPTION_LIMITS[platform]);
}
