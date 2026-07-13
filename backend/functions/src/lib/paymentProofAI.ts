/**
 * AI verification of driver commission payment screenshots.
 *
 * A locked driver settles their commission by transferring it to Velocity's
 * account and uploading a screenshot of the payment. This module asks a Claude
 * vision model whether that screenshot is (a) a genuine, un-edited payment
 * receipt, (b) for at least the amount due, and (c) sent to one of Velocity's
 * accounts. The verdict drives auto-unlock (see submitCommissionSettlement):
 * only a clearly-genuine, correct-amount, correct-recipient result unlocks
 * automatically; anything uncertain goes to an admin review queue.
 *
 * The API key is a Cloud Functions secret (ANTHROPIC_API_KEY). When it is not
 * configured, verification is unavailable and every settlement falls back to
 * admin review — never auto-approved, never auto-rejected.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions';

import { storage } from './firebase';

/** What the model reports about a screenshot. */
export interface ProofVerdict {
  /** True only if it looks like a real, un-manipulated payment confirmation. */
  genuine: boolean;
  /** Amount detected on the receipt in PKR, or null if unreadable. */
  amountDetected: number | null;
  /** True if the recipient shown matches one of Velocity's accounts. */
  recipientMatch: boolean;
  /** Model's confidence in the overall assessment. */
  confidence: 'high' | 'medium' | 'low';
  /** Short human-readable justification (shown to admins, logged). */
  reasoning: string;
}

export interface VelocityAccounts {
  easypaisaNumber?: string;
  jazzcashNumber?: string;
  bankName?: string;
  bankIban?: string;
  accountTitle?: string;
}

const MODEL = 'claude-opus-4-8';

/** True when the Anthropic API key secret is present. */
export function proofAIConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

/** Download a Storage object as base64 + media type for the vision request. */
async function loadImage(proofPath: string): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const file = storage.bucket().file(proofPath);
    const [meta] = await file.getMetadata();
    const mediaType = (meta.contentType as string | undefined) ?? 'image/jpeg';
    if (!mediaType.startsWith('image/')) {
      logger.warn('Settlement proof is not an image', { proofPath, mediaType });
      return null;
    }
    const [buf] = await file.download();
    return { base64: buf.toString('base64'), mediaType };
  } catch (e) {
    logger.error('Failed to load settlement proof from Storage', { proofPath, e });
    return null;
  }
}

function accountsSummary(a: VelocityAccounts): string {
  const lines: string[] = [];
  if (a.accountTitle) lines.push(`Account title: ${a.accountTitle}`);
  if (a.easypaisaNumber) lines.push(`Easypaisa: ${a.easypaisaNumber}`);
  if (a.jazzcashNumber) lines.push(`JazzCash: ${a.jazzcashNumber}`);
  if (a.bankIban) lines.push(`Bank IBAN${a.bankName ? ` (${a.bankName})` : ''}: ${a.bankIban}`);
  return lines.length ? lines.join('\n') : '(no accounts configured)';
}

/** Extract the first JSON object from a model response. */
function parseVerdict(text: string): ProofVerdict | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const conf = String(raw.confidence ?? 'low').toLowerCase();
    return {
      genuine: raw.genuine === true,
      amountDetected:
        typeof raw.amountDetected === 'number' && Number.isFinite(raw.amountDetected)
          ? Math.round(raw.amountDetected)
          : null,
      recipientMatch: raw.recipientMatch === true,
      confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, 500) : '',
    };
  } catch {
    return null;
  }
}

/**
 * Ask Claude to inspect the screenshot. Returns a verdict, or null when the
 * key is unconfigured / the image can't be read / the call fails — in all of
 * which cases the caller must route to admin review rather than guess.
 */
export async function verifyPaymentProof(params: {
  proofPath: string;
  amountDue: number;
  accounts: VelocityAccounts;
  /**
   * What the payer owes, in one clause — e.g. "a commission on the cash fares
   * they collected" or "cancellation fees for rides they cancelled after a
   * driver had accepted". Shapes the prompt; defaults to the commission case.
   */
  debtDescription?: string;
}): Promise<ProofVerdict | null> {
  if (!proofAIConfigured()) return null;
  const image = await loadImage(params.proofPath);
  if (!image) return null;

  const debt = params.debtDescription ?? 'a commission on the cash fares they collected';
  const client = new Anthropic();
  const prompt = `You are a fraud-review assistant for a Pakistani ride-hailing platform ("Velocity"). A user owes Velocity ${debt} and must pay it by transferring money to one of Velocity's official accounts, then uploading a screenshot of that payment as proof. Your job is to inspect the screenshot.

Amount the user must have paid: at least PKR ${params.amountDue}.

Velocity's official receiving accounts (the recipient in the screenshot should match one of these):
${accountsSummary(params.accounts)}

Assess the screenshot on three points:
1. genuine — Is this a real, unedited payment confirmation from a payment app (JazzCash, Easypaisa, a bank app, or a bank transfer receipt)? Look for signs of tampering, photo-editing, mismatched fonts, altered numbers, screenshots of screenshots, or a reused/old receipt. Be strict: if it looks manipulated, fake, or is not a payment receipt at all, genuine=false.
2. amountDetected — The transferred amount in PKR shown on the receipt (a number), or null if you cannot read it.
3. recipientMatch — Does the recipient account/number/title shown match one of Velocity's accounts above? true/false. If no accounts are configured, or you cannot tell, use false.

Assume nothing from context — judge only what the screenshot itself shows.

Respond with ONLY a JSON object, no other text:
{"genuine": boolean, "amountDetected": number|null, "recipientMatch": boolean, "confidence": "high"|"medium"|"low", "reasoning": "one or two sentences"}`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: image.base64,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    if (res.stop_reason === 'refusal') {
      logger.warn('Proof verification refused by model', { proofPath: params.proofPath });
      return null;
    }
    const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const verdict = textBlock ? parseVerdict(textBlock.text) : null;
    if (!verdict) {
      logger.warn('Could not parse verification verdict', { proofPath: params.proofPath });
      return null;
    }
    logger.info('Proof verified', { proofPath: params.proofPath, verdict });
    return verdict;
  } catch (e) {
    logger.error('Anthropic verification call failed', { proofPath: params.proofPath, e });
    return null;
  }
}

export type SettlementStatus = 'verifying' | 'approved' | 'rejected' | 'pending_review';

/**
 * Turn an AI verdict into an outcome under the "safe" auto-approve policy,
 * shared by every kind of settlement (commission cycles and cancellation fees).
 *
 * Only a clearly-genuine receipt, for at least the amount due, sent to one of
 * Velocity's accounts, at high confidence, settles automatically. A convincing
 * fake is rejected outright. Everything in between — including "no AI verdict at
 * all" — goes to a human rather than being guessed at in either direction.
 */
export function decideProofOutcome(
  verdict: ProofVerdict | null,
  amountDue: number,
): { status: Exclude<SettlementStatus, 'verifying'>; reason: string | null } {
  if (!verdict) {
    // No AI (unconfigured) or the check failed — never guess, send to a human.
    return { status: 'pending_review', reason: null };
  }
  if (!verdict.genuine) {
    return {
      status: 'rejected',
      reason: verdict.reasoning || 'The screenshot could not be verified as a genuine payment. Please upload a clear, unedited receipt.',
    };
  }
  const amountOk = verdict.amountDetected !== null && verdict.amountDetected >= amountDue;
  if (verdict.confidence === 'high' && amountOk && verdict.recipientMatch) {
    return { status: 'approved', reason: null };
  }
  // Genuine but not confidently correct (amount unclear, recipient unclear, or
  // lower confidence) → let an admin make the final call.
  return { status: 'pending_review', reason: verdict.reasoning || null };
}
