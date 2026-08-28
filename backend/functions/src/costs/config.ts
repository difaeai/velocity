/**
 * Where the cost numbers come from — and, mostly, why they don't.
 *
 * Three vendors between them send Velocity almost every bill that moves month
 * to month: Google Cloud (Firestore, Functions, Storage, App Hosting,
 * phone-auth SMS, Maps, Gemini), Anthropic (the social desk), and Meta
 * (WhatsApp conversations, and ad spend once there is any). Each exposes its
 * own spend, and each needs a credential this repository does not ship.
 *
 * Every reader below returns null when its credential is missing, and the
 * refresh job treats null as "not configured" rather than as a failure. That is
 * the same posture as `whatsapp/client.ts`: the feature lands inert, the admin
 * console keeps working exactly as it did with hand-typed amounts, and each
 * source lights up on its own the moment its secret is deployed.
 *
 * Read per call, never cached at module load — a redeploy is how these rotate,
 * and a warm instance holding a cached null would survive the rotation.
 */

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

// ── Google Cloud ────────────────────────────────────────────────────────────

export interface CloudBillingConfig {
  /** The project the BigQuery job runs in — the one that owns the dataset. */
  projectId: string;
  /** Fully-qualified `project.dataset.table` of the billing export. */
  table: string;
}

/**
 * Google Cloud does not have an API that returns what you spent. The Cloud
 * Billing API covers billing accounts and the *price catalogue*; actual cost
 * only leaves Google through the BigQuery billing export, which has to be
 * switched on in the console and starts collecting from that moment (a
 * US/EU multi-region dataset backfills the previous month; a single-region one
 * backfills nothing). See docs/COST_SOURCES.md.
 *
 * The table name is interpolated into SQL — BigQuery has no parameter form for
 * an identifier — so it is validated to death here rather than at the query.
 */
export function cloudBillingConfig(): CloudBillingConfig | null {
  const table = env('BILLING_BQ_TABLE');
  if (!table) return null;

  // project.dataset.table — Google's own identifier charset, nothing else.
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_]*\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(table)) {
    return null;
  }
  return { projectId: table.split('.')[0], table };
}

// ── Anthropic ───────────────────────────────────────────────────────────────

export interface AnthropicAdminConfig {
  credential: string;
  /** API keys go on `x-api-key`; OAuth tokens go on `Authorization: Bearer`. */
  scheme: 'x-api-key' | 'bearer';
}

/**
 * The organization cost report is an *admin* surface: the `ANTHROPIC_API_KEY`
 * the social desk writes with cannot read it, and must not be used here — a
 * key that can see the org's billing is a bigger key than a key that can send
 * a message, and they are rotated on different schedules.
 *
 * Both credential forms Anthropic issues are accepted because they authenticate
 * differently, and being wrong about which one is in the secret is an opaque
 * 401 that looks exactly like a bad key.
 */
export function anthropicAdminConfig(): AnthropicAdminConfig | null {
  const credential = env('ANTHROPIC_ADMIN_KEY');
  if (!credential) return null;
  return {
    credential,
    scheme: credential.startsWith('sk-ant-') ? 'x-api-key' : 'bearer',
  };
}

// ── Meta ────────────────────────────────────────────────────────────────────

export interface MetaCostConfig {
  token: string;
  /** WhatsApp Business Account id — conversation costs hang off this. */
  wabaId: string | null;
  /** Ad account id, with or without the `act_` prefix. */
  adAccountId: string | null;
}

/**
 * WhatsApp conversation cost and ad spend both come from the Graph API, so one
 * token covers both. It falls back to `WHATSAPP_TOKEN` when no dedicated cost
 * token is set: the system-user token that already sends the alerts usually
 * carries `whatsapp_business_management` too, and asking for a second secret to
 * read a number the first one can already read is friction for nothing.
 */
export function metaCostConfig(): MetaCostConfig | null {
  const token = env('META_COST_TOKEN') || env('WHATSAPP_TOKEN');
  if (!token) return null;

  const wabaId = env('WHATSAPP_WABA_ID') || null;
  const rawAd = env('META_AD_ACCOUNT_ID');
  const adAccountId = rawAd ? (rawAd.startsWith('act_') ? rawAd : `act_${rawAd}`) : null;

  // A token with neither an account to point it at buys nothing.
  if (!wabaId && !adAccountId) return null;
  return { token, wabaId, adAccountId };
}

// ── the window every source is asked about ──────────────────────────────────

export interface CostWindow {
  /** Inclusive start, UTC. */
  start: Date;
  /** Exclusive end, UTC. */
  end: Date;
  /** `2026-07` — what the console shows beside the amount. */
  label: string;
}

/**
 * The last complete calendar month.
 *
 * Deliberately not "the trailing 30 days": these figures sit next to a run rate
 * an admin cross-checks against an invoice, and an invoice covers a calendar
 * month. A number that nearly matches the bill but never exactly matches it is
 * worse than one that matches it precisely and is up to a month old.
 */
export function lastCompleteMonth(now: Date = new Date()): CostWindow {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start, end, label };
}
