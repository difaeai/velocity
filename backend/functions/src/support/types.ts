/**
 * The shape of the Velocity Rapid Response System.
 *
 * One ticket per complaint, not one thread per person. A rider whose fare was
 * wrong last week and whose driver was rude today has two different problems
 * with two different owners and two different resolutions, and a single rolling
 * chat makes both of them somebody's scrollback.
 */

/** What the complaint is about. Drives routing, priority and the AI's brief. */
export const SUPPORT_CATEGORIES = [
  'safety',
  'online_scam',
  'payment',
  'driver_issue',
  'passenger_issue',
  'commission',
  'account',
  'lost_item',
  'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** Human-readable, and the exact words the app shows on the category picker. */
export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  safety: 'Safety or harassment',
  online_scam: 'Online scam or fraud',
  payment: 'Fare or payment problem',
  driver_issue: 'Problem with a driver',
  passenger_issue: 'Problem with a passenger',
  commission: 'Commission or credit',
  account: 'Account or sign-in',
  lost_item: 'Lost item',
  other: 'Something else',
};

/**
 * Categories the AI never tries to resolve.
 *
 * It still answers — immediately, with the emergency numbers and what we are
 * doing — but the ticket is a human's from the first second. An AI negotiating
 * with somebody reporting an assault is the single worst thing this system
 * could do, and "it usually handles it fine" is not a standard that applies to
 * the cases it does not.
 */
export const HUMAN_ONLY_CATEGORIES: ReadonlySet<SupportCategory> = new Set<SupportCategory>([
  'safety',
  'online_scam',
]);

export type SupportStatus =
  /** The AI is answering. */
  | 'ai_handling'
  /** Escalated and sitting in the desk queue. */
  | 'waiting_human'
  /** An admin has picked it up. */
  | 'human_handling'
  /** Answered and closed by whoever owned it. */
  | 'resolved';

export type SupportSender = 'user' | 'ai' | 'agent' | 'system';

export type SupportPriority = 'normal' | 'high' | 'urgent';

/** Priority a category opens at, before the AI has read anything. */
export const CATEGORY_PRIORITY: Record<SupportCategory, SupportPriority> = {
  safety: 'urgent',
  online_scam: 'urgent',
  payment: 'normal',
  driver_issue: 'high',
  passenger_issue: 'high',
  commission: 'normal',
  account: 'normal',
  lost_item: 'normal',
  other: 'normal',
};

/**
 * AI replies allowed on one ticket before it goes to a human anyway.
 *
 * A loop where the AI keeps rephrasing the same non-answer is how automated
 * support earns its reputation. Four turns is enough to answer a real question
 * and short enough that nobody has to fight their way out.
 */
export const MAX_AI_REPLIES = 4;

/**
 * "Get me a person" — in the words people actually use.
 *
 * Checked literally, before any model call, because this is the one request in
 * the whole system that must never depend on a model's judgement, a network
 * round trip, or an API key being configured. If somebody asks for a human they
 * get a human, even when everything else is down.
 *
 * Roman Urdu belongs here even though it is kept out of the app's own UI text:
 * refusing to UNDERSTAND how Pakistani users type is not the same rule as
 * refusing to WRITE the interface that way.
 */
export const HUMAN_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(real|actual|live|human|hooman)\s+(person|human|agent|operator|support|rep)\b/i,
  /\b(talk|speak|chat|connect|transfer)\s+(to|with)\s+(a\s+)?(human|person|agent|someone|somebody|operator|staff|manager)\b/i,
  /\b(human|agent|operator)\s+(please|plz|chahiye|chahye)\b/i,
  /\bnot\s+(a\s+)?(bot|robot|ai)\b/i,
  /\b(stop|no)\s+(the\s+)?(bot|robot|ai)\b/i,
  /\bescalate\b/i,
  /\bcustomer\s+(care|service)\s+(number|agent|person)\b/i,
  // Roman Urdu: "mujhe insaan se baat karao", "banday se baat karwao",
  // "kisi aadmi se baat", "human se baat karwa do", "team se baat karao"
  /\b(insaan|insan|insan|banda|bande|banday|aadmi|admi|aadmee)\b.{0,24}\b(baat|bat)\b/i,
  /\b(baat|bat)\b.{0,24}\b(insaan|insan|inson|banda|banday|bande|aadmi|admi|human|agent|team)\b/i,
  /\b(karwa|karwao|karao|karva|kraao|krwao|kraw)\w*\b.{0,20}\b(baat|bat)\b/i,
  /\b(baat|bat)\s*(karwa|karwao|karao|kraao|krwao|karva)\w*/i,
  // Urdu script: "انسان سے بات", "نمائندے سے بات", "بندے سے بات"
  /(انسان|نمائندے|نمائندہ|بندے|آدمی|ٹیم)\s*(سے)?\s*بات/u,
];

/** True when the message is a request to be handed to a person. */
export function asksForHuman(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((re) => re.test(text));
}
