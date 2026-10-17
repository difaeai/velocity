/**
 * The local writer — the desk's second engine, and the one that needs no key.
 *
 * `claude.ts` is still the first engine and still the better one. This exists
 * because the desk had exactly one door to think through, and behind that door
 * was a paid API key: with no key, eight employees could not plan, write,
 * brief, direct or reply, and the scheduled run refused to start. Everything
 * here is the same craft the model was given in a prompt, implemented as code
 * instead — the 26 hook shapes, the caption fold, the five-tag cap, the beat
 * timings — scored by the critic in `lint.ts` that was already written to mark
 * the model's work.
 *
 * - `material.ts` is the knowledge: what each angle is actually about, written
 *   by hand, with every figure declared against the facts it needs.
 * - `compose.ts` is the writer: it builds every candidate the material allows,
 *   scores each with the desk's own critic, and keeps the best.
 * - `stages.ts` is the plumbing: one function per stage, returning the domain
 *   type that stage returns.
 *
 * Which engine ran is recorded on the piece and shown in the console, because
 * the difference is real and nobody should have to guess which one wrote
 * something.
 */
export {
  composeDraft,
  composeFrames,
  composeHashtags,
  dateFrom,
  factVars,
  hookCandidates,
  seedFor,
  timing,
  type HookCandidate,
  type LocalDraft,
  type Vars,
} from './compose';

export {
  ANGLE_MATERIAL,
  CITIES,
  GENERIC_ANGLE,
  ROUTES,
  materialFor,
  type AngleMaterial,
  type FactKey,
  type HookSeed,
} from './material';

export {
  LOCAL_ENGINE,
  localAdPlan,
  localDistribution,
  localDraft,
  localFrames,
  localLessons,
  localPlan,
  localReplies,
  localResearch,
  localRewriteCaption,
  localSearchPack,
  localSeoPack,
  looksRomanUrdu,
  scoreLocal,
  type LocalDrafted,
  type LocalFrame,
  type LocalIntent,
  type LocalReply,
  type RankedForLessons,
} from './stages';
