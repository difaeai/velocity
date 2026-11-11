/**
 * Velocity Studio — paying a plan by debit or credit card.
 *
 * Stripe Checkout, hosted: we create a session server-side and send the
 * customer to Stripe's own page, so no card number ever touches our site and
 * there is no PCI surface in this repo. Stripe then POSTs the outcome to
 * `studioStripeWebhook`, which is public — so the signature on the request IS
 * the authentication, and it is checked before a single document changes.
 *
 * One-off charges, not subscriptions: each payment buys one month or one year,
 * exactly like the bank transfer it sits beside, so the price keeps coming from
 * our own price clock (`priceClock.ts`) rather than a fixed Stripe Price, and a
 * customer's card is never kept on file to be charged again on its own.
 *
 * The record is `studioPayments/{checkout session id}`, created when the money
 * arrives and never before: a session the customer abandons leaves nothing
 * behind, and Stripe's own retries of the same event land on the same document,
 * which is what makes a replay harmless.
 *
 * Credentials come from the STRIPE_ENV deploy secret (its own block — never
 * appended to the payments one):
 *   STRIPE_SECRET_KEY      sk_live_… or sk_test_…
 *   STRIPE_WEBHOOK_SECRET  whsec_… from the endpoint added in the dashboard
 *
 * shortcut: plans only. A month of AI calling agents or a pack of credit days
 * is still paid by transfer; add them here the day a customer asks to card one.
 */
import { logger } from 'firebase-functions';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { decideStudioPayment } from './index';
import { PLANS, PLAN_IDS, priceUsd, type Billing, type PlanId } from './plans';
import { customerPriceRaised } from './priceClock';
import { verifyStripeEvent } from './stripeSignature';

const env = (name: string): string => (process.env[name] ?? '').trim();

/** Where Stripe sends the customer back to. Never a URL from the client: that is an open redirect. */
const RETURNS = {
  start: '/studio/start?paid=card',
  billing: '/dashboard/social/billing?paid=card',
} as const;

const webOrigin = (): string => (process.env.VELOCITY_WEB_ORIGIN ?? 'https://velocityrides.app').replace(/\/+$/, '');

async function stripe(path: string, form: Record<string, string>, idempotencyKey?: string): Promise<Record<string, unknown>> {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new HttpsError('failed-precondition', 'Card payments are not open yet. Pay by bank transfer instead.');
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: new URLSearchParams(form).toString(),
      // A gateway that has stopped answering should be an error on the screen, not a minute of spinner.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    logger.error('stripe: unreachable', { path, error: e instanceof Error ? e.message : String(e) });
    throw new HttpsError('unavailable', 'The card gateway did not answer. Try again, or pay by bank transfer.');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Stripe's own wording can name the account or the key, so it is logged and never returned.
    logger.error('stripe: request refused', { path, status: res.status, error: body.error });
    throw new HttpsError('internal', 'The card gateway refused that. Try bank transfer, or tell us and we will fix it.');
  }
  return body;
}

/**
 * Hand the customer a Stripe Checkout page for the plan they picked. Writes
 * nothing: what they are buying travels as the session's metadata, and the
 * price is worked out here so the client cannot name its own.
 */
export const studioCardCheckout = onCall(async (req) => {
  const ctx = requireAuth(req);
  const wid = typeof ctx.token.ws === 'string' ? ctx.token.ws : null;
  // The same gate the transfer has: before a workspace exists, the plan is parked on a proved address.
  if (!wid && ctx.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email first — type the code we sent you.');
  }
  const parsed = z
    .object({
      plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]),
      billing: z.enum(['month', 'year']).optional().default('month'),
      where: z.enum(['start', 'billing']).optional().default('start'),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Choose a plan.');
  const { plan, billing, where } = parsed.data;

  const raised = await customerPriceRaised(ctx.uid, Date.now());
  const usd = priceUsd(plan, billing, raised);
  const email = typeof ctx.token.email === 'string' ? ctx.token.email : '';
  const base = webOrigin();

  const session = await stripe(
    'checkout/sessions',
    {
      mode: 'payment',
      success_url: `${base}${RETURNS[where]}`,
      cancel_url: `${base}${RETURNS[where].split('?')[0]}?paid=cancelled`,
      ...(email ? { customer_email: email } : {}),
      client_reference_id: ctx.uid,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(Math.round(usd * 100)),
      'line_items[0][price_data][product_data][name]': `${PLANS[plan].name} — ${billing === 'year' ? 'one year' : '30 days'}`,
      'metadata[uid]': ctx.uid,
      'metadata[wid]': wid ?? '',
      'metadata[plan]': plan,
      'metadata[billing]': billing,
      'metadata[amountUsd]': String(usd),
    },
    // A double tap buys one session, not two.
    `studio-${ctx.uid}-${plan}-${billing}-${Math.floor(Date.now() / 60_000)}`,
  );
  const url = typeof session.url === 'string' ? session.url : '';
  if (!url) throw new HttpsError('internal', 'The card gateway gave no payment page.');
  return { url };
});

/** The paid-for session, as much of it as we use. */
interface Session {
  id?: unknown;
  payment_status?: unknown;
  amount_total?: unknown;
  payment_intent?: unknown;
  customer_email?: unknown;
  customer_details?: { email?: unknown };
  metadata?: { uid?: unknown; wid?: unknown; plan?: unknown; billing?: unknown; amountUsd?: unknown };
}

/**
 * What a completed session does: one `studioPayments` document, already proved,
 * approved down the same path an admin's approval takes. Pure of HTTP so it is
 * callable from a test.
 */
export async function recordCardPayment(session: Session): Promise<'approved' | 'ignored' | 'already'> {
  const id = typeof session.id === 'string' ? session.id : '';
  if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(id)) {
    logger.error('stripe: session id not usable as a document id', { id });
    return 'ignored';
  }
  if (session.payment_status !== 'paid') return 'ignored';
  const meta = session.metadata ?? {};
  const uid = typeof meta.uid === 'string' ? meta.uid : '';
  const plan = typeof meta.plan === 'string' && (PLAN_IDS as readonly string[]).includes(meta.plan) ? (meta.plan as PlanId) : null;
  if (!uid || !plan) {
    // Our own metadata is missing: the money is in Stripe and nobody can be credited from here.
    logger.error('stripe: paid session carries no plan of ours', { id, uid, plan: meta.plan });
    return 'ignored';
  }
  const billing: Billing = meta.billing === 'year' ? 'year' : 'month';
  const wid = typeof meta.wid === 'string' && meta.wid ? meta.wid : null;
  const cents = typeof session.amount_total === 'number' ? session.amount_total : 0;
  const amountUsd = cents > 0 ? cents / 100 : Number(meta.amountUsd) || priceUsd(plan, billing);
  const quoted = Number(meta.amountUsd);
  if (quoted && Math.abs(quoted - amountUsd) > 0.01) {
    // Never a reason to refuse money that arrived — but somebody should see it.
    logger.warn('stripe: paid a different amount than quoted', { id, quoted, amountUsd });
  }

  const payRef = db.doc(`studioPayments/${id}`);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(payRef)).exists) return;
    tx.create(payRef, {
      wid,
      uid,
      business: null,
      // Whatever address Stripe took the payment under, so the row can be answered.
      email:
        (typeof session.customer_details?.email === 'string' ? session.customer_details.email : null) ??
        (typeof session.customer_email === 'string' ? session.customer_email : null),
      plan,
      billing,
      amountUsd,
      // What the owner searches for in Stripe; there is no receipt to read, so none is kept.
      txnId: typeof session.payment_intent === 'string' ? session.payment_intent : id,
      txnKey: null,
      screenshotPath: null,
      analysis: null,
      method: 'card',
      status: 'pending',
      createdAtMs: Date.now(),
      decidedAtMs: null,
      decidedBy: null,
      note: null,
    });
  });

  try {
    await decideStudioPayment(id, true, 'stripe', 'Paid by card');
    return 'approved';
  } catch (e) {
    // Stripe retries the same event; an already-decided payment is done, not failed.
    if (e instanceof HttpsError && e.code === 'failed-precondition') return 'already';
    throw e;
  }
}

/**
 * Stripe's outcome. Unauthenticated by design — the signature is what is
 * trusted — so nothing here reads the body before `verifyStripeEvent` has
 * passed, and a bad signature gets a 400 and no clue why.
 */
export const studioStripeWebhook = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const event = verifyStripeEvent(req.rawBody, req.header('stripe-signature'), env('STRIPE_WEBHOOK_SECRET'));
  if (!event) {
    logger.warn('stripe: webhook signature refused');
    res.status(400).send('bad signature');
    return;
  }
  if (event.type !== 'checkout.session.completed') {
    // Everything else is for the dashboard, not for us; a 200 stops Stripe retrying it.
    res.status(200).send('ignored');
    return;
  }
  try {
    const session = ((event.data as { object?: Session } | undefined)?.object ?? {}) as Session;
    const outcome = await recordCardPayment(session);
    logger.info('stripe: card payment', { outcome, session: session.id });
    res.status(200).send(outcome);
  } catch (e) {
    // A 500 is what makes Stripe try again, which is what we want for a transient failure.
    logger.error('stripe: could not record a paid session', { error: e instanceof Error ? e.message : String(e) });
    res.status(500).send('retry');
  }
});
