/**
 * WhatsApp Cloud API transport — the wire, and nothing else.
 *
 * Velocity uses WhatsApp for exactly one thing: telling an OFFLINE driver that
 * there is a fare waiting a few streets away, so they can open the app. That is
 * a genuinely useful message and a legitimate one — but WhatsApp is not SMS, and
 * the difference is the whole reason this file is shaped the way it is.
 *
 * WHY THIS IS SO CAREFUL
 * ---------------------
 * Meta scores every business number on a *quality rating* derived from how the
 * people receiving its messages react. Blocks and "report" taps drag it down;
 * enough of them and the number is throttled to a lower messaging tier, then
 * flagged, then restricted. Restriction is not a rate limit you wait out — it
 * can take the number out of service, and the number is the identity of the
 * business on WhatsApp. There is no appeal queue worth relying on.
 *
 * So the rules this module enforces are not style preferences:
 *
 *  1. TEMPLATES ONLY. A business-initiated message must be a template Meta has
 *     already approved. Free-form text outside the 24-hour service window is
 *     refused by the API (131047) and, worse, is exactly the pattern that gets
 *     numbers flagged. `sendTemplate` is the only send this file exposes.
 *  2. ERRORS ARE SIGNALS, NOT NOISE. Meta tells you when a recipient cannot or
 *     should not be messaged again. `classifySendError` turns those codes into
 *     an instruction the caller must act on — the codes that mean "stop" are
 *     the cheapest protection available, and ignoring them is how a number
 *     earns a restriction.
 *  3. NOTHING SENDS WITHOUT CONFIGURATION. No token, no phone-number id, no
 *     template name → `whatsAppConfig()` returns null and every caller quietly
 *     does nothing. The feature ships dark and stays dark until a real approved
 *     template exists.
 *
 * The *policy* — who is eligible, how often, at what hour, and the circuit
 * breaker that stops everything when Meta starts pushing back — lives in
 * `alerts.ts`. This file only knows how to put one message on the wire and how
 * to read the answer.
 */
import { logger } from 'firebase-functions';

/** Graph API version. Pinned: Meta ships breaking changes across versions. */
const GRAPH_VERSION = 'v21.0';

export interface WhatsAppConfig {
  /** Permanent System User access token for the WhatsApp Business Account. */
  token: string;
  /** The sender's phone-number ID (NOT the phone number itself). */
  phoneNumberId: string;
  /** Approved UTILITY-category template used for the offline driver alert. */
  templateName: string;
  /** Language code the template was approved in, e.g. `en` or `en_US`. */
  templateLang: string;
  /**
   * Position of the dynamic URL button in the approved template, or null when
   * the template has no dynamic URL button to fill.
   */
  urlButtonIndex: string | null;
  /** Shared secret echoed back to Meta during webhook verification. */
  verifyToken: string;
  /** App secret, used to verify the X-Hub-Signature-256 on incoming webhooks. */
  appSecret: string;
}

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/**
 * Which button in the approved template carries the dynamic URL, or null when
 * there is no dynamic URL button to fill.
 *
 * Meta indexes a template's buttons by their position in the template itself,
 * so a template that lists `Stop alerts` before `View ride` puts the URL button
 * at index 1 — and a `sub_type: 'url'` component sent against index 0 comes
 * back as `(#100) Invalid parameter`. A URL button approved WITHOUT a trailing
 * `{{1}}` is static, takes no parameter at all, and rejects the same way.
 *
 * Neither is knowable from here: they are properties of what Meta approved, not
 * of this code. Hardcoding index 0 assumed the documented layout and gave no
 * way to correct it without a deploy, so both are configuration now. Default
 * stays 0 — the layout in docs/WHATSAPP_ALERTS.md — so nothing changes for a
 * template that already matches.
 */
function resolveUrlButtonIndex(): string | null {
  const raw = env('WHATSAPP_TEMPLATE_BUTTON_INDEX');
  if (!raw) return '0';
  if (/^(none|off|static)$/i.test(raw)) return null;
  // A typo must not silently move the button somewhere Meta will reject; fall
  // back to the documented position rather than sending garbage as an index.
  return /^\d+$/.test(raw) ? raw : '0';
}

/**
 * The live configuration, or null when WhatsApp alerts are not set up.
 *
 * Read per call rather than cached at module load: a redeploy is how the token
 * gets rotated, and a cached null would otherwise survive the rotation for the
 * lifetime of a warm instance.
 */
export function whatsAppConfig(): WhatsAppConfig | null {
  const token = env('WHATSAPP_TOKEN');
  const phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID');
  const templateName = env('WHATSAPP_TEMPLATE_NAME');
  if (!token || !phoneNumberId || !templateName) return null;
  return {
    token,
    phoneNumberId,
    templateName,
    templateLang: env('WHATSAPP_TEMPLATE_LANG') || 'en',
    urlButtonIndex: resolveUrlButtonIndex(),
    verifyToken: env('WHATSAPP_VERIFY_TOKEN'),
    appSecret: env('WHATSAPP_APP_SECRET'),
  };
}

/**
 * Normalises a Pakistani mobile number to the digits-only E.164 form the Cloud
 * API expects (`923001234567` — no `+`, no spaces, no dashes).
 *
 * Returns null for anything that is not a plausible PK mobile. Being strict here
 * is a quality-rating decision, not a tidiness one: every message to a number
 * that is not on WhatsApp comes back as an undeliverable, and a stream of
 * undeliverables is one of the signals Meta reads as spraying.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;

  // 00923… → 923…  (international prefix typed the old way)
  if (d.startsWith('0092')) d = d.slice(2);
  // 03001234567 → 923001234567
  else if (d.startsWith('0')) d = `92${d.slice(1)}`;
  // 3001234567 → 923001234567  (leading zero dropped by a form somewhere)
  else if (d.length === 10 && d.startsWith('3')) d = `92${d}`;

  // Every PK mobile is 92 + 3xxxxxxxxx — twelve digits, and the subscriber part
  // always starts with 3. Landlines have no WhatsApp and must not be attempted.
  if (!/^923\d{9}$/.test(d)) return null;
  return d;
}

/**
 * What the caller must DO about a failed send. The mapping is the point of this
 * module: Meta's numeric codes are the only warning you get before a number's
 * standing starts to slide.
 */
export type SendFailureAction =
  /** This recipient can never receive our messages. Stop trying, permanently. */
  | 'drop-recipient'
  /** Meta declined for THIS user (per-user cap, experiment). Skip them today. */
  | 'skip-recipient'
  /** We are going too fast. Back off; the recipient is fine. */
  | 'back-off'
  /**
   * Something is wrong with the ACCOUNT, the number or the template — spam
   * flag, lock, paused template. Trip the breaker and stop the whole feature
   * until a human looks. This is the branch that protects the number.
   */
  | 'halt'
  /** Transient / unknown. Log it, change nothing. */
  | 'ignore';

/**
 * Cloud API error codes, mapped to the action they demand.
 *
 * Sources are Meta's error reference; the grouping is ours. When a code is not
 * listed we deliberately fall through to `ignore` rather than guessing, because
 * guessing "halt" would let one odd response switch the feature off for
 * everybody, and guessing "drop-recipient" would silently lose a real driver.
 */
const ERROR_ACTIONS: ReadonlyMap<number, SendFailureAction> = new Map<number, SendFailureAction>([
  // ── The recipient is not reachable, and never will be ──
  [131026, 'drop-recipient'], // Message undeliverable — not a WhatsApp user
  [131052, 'drop-recipient'], // Media/recipient resolution failure
  [1013,   'drop-recipient'], // User is not valid

  // ── Meta chose not to deliver to this one person ──
  [131049, 'skip-recipient'], // Per-user marketing/health limit for today
  [130472, 'skip-recipient'], // User is in an experiment group

  // ── Too fast; nothing is wrong with us or them ──
  [130429, 'back-off'],       // Cloud API throughput limit
  [131056, 'back-off'],       // Pair rate limit (this sender ↔ this recipient)
  [80007,  'back-off'],       // Business-account rate limit

  // ── The account itself is in trouble. Stop everything. ──
  [131048, 'halt'],           // Spam rate limit — the direct precursor to a ban
  [368,    'halt'],           // Temporarily blocked for policy violations
  [131031, 'halt'],           // Account locked / restricted
  [133004, 'halt'],           // Server/number unavailable for sending
  [133010, 'halt'],           // Number not registered

  // ── Our own request is malformed. Stop everything. ──
  // An unrecognised code deliberately falls through to `ignore` rather than
  // guessing (see above), and `(#100) Invalid parameter` is as generic as codes
  // get. It is the one exception, because of what earns it: the payload is
  // byte-identical for every recipient in a fanout, so a parameter that is
  // invalid for one is invalid for all of them. Continuing past it cannot
  // deliver anything and spends the number's quality rating trying. Meta also
  // reports most template *shape* faults here rather than under 132xxx, under a
  // subcode this map does not list — which is exactly how a malformed template
  // reached every driver instead of stopping at the first.
  [100, 'halt'],

  // ── Template problems. Sending more of them makes it worse. ──
  [132000, 'halt'],           // Parameter count mismatch
  [132001, 'halt'],           // Template does not exist in this language
  [132005, 'halt'],           // Hydrated text too long
  [132007, 'halt'],           // Template format character policy violated
  [132012, 'halt'],           // Parameter format mismatch
  [132015, 'halt'],           // Template is paused
  [132016, 'halt'],           // Template is disabled — a quality death sentence
  [132068, 'halt'],           // Flow is blocked
]);

export function classifySendError(code: number | null): SendFailureAction {
  if (code === null) return 'ignore';
  return ERROR_ACTIONS.get(code) ?? 'ignore';
}

export interface SendSuccess {
  ok: true;
  messageId: string | null;
}

export interface SendFailure {
  ok: false;
  code: number | null;
  action: SendFailureAction;
  detail: string;
}

export type SendResult = SendSuccess | SendFailure;

/** Pulls Meta's numeric error code out of whichever shape the response used. */
export function extractErrorCode(body: unknown): number | null {
  const err = (body as { error?: { code?: unknown; error_subcode?: unknown } } | null)?.error;
  if (!err) return null;
  // The *subcode* is often the specific one; the outer code can be a generic
  // 100 or 131000 that says nothing useful. Prefer a subcode we recognise.
  const sub = err.error_subcode;
  if (typeof sub === 'number' && ERROR_ACTIONS.has(sub)) return sub;
  return typeof err.code === 'number' ? err.code : null;
}

/**
 * One template message. `bodyParams` fill `{{1}}`, `{{2}}`, … in order, and
 * `urlSuffix` fills the dynamic tail of the template's URL button — which is
 * what makes the message a one-tap route into the ride rather than a nag to go
 * and find it.
 *
 * Never throws: a WhatsApp failure must not be able to take down the ride
 * request that triggered it.
 */
export async function sendTemplate(
  cfg: WhatsAppConfig,
  to: string,
  bodyParams: string[],
  urlSuffix?: string,
): Promise<SendResult> {
  const components: Record<string, unknown>[] = [
    {
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text })),
    },
  ];
  // No dynamic URL button in the approved template means no button component:
  // sending one against a static button is itself an `(#100) Invalid parameter`.
  if (urlSuffix && cfg.urlButtonIndex !== null) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: cfg.urlButtonIndex,
      parameters: [{ type: 'text', text: urlSuffix }],
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: cfg.templateName,
      language: { code: cfg.templateLang },
      components,
    },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        // A ride request is a live thing. If WhatsApp is slow, the alert is
        // already worthless by the time it lands — give up rather than hold a
        // function instance open.
        signal: AbortSignal.timeout(10_000),
      },
    );

    const json = (await res.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string } }
      | null;

    if (res.ok && json?.messages?.length) {
      return { ok: true, messageId: json.messages[0]?.id ?? null };
    }

    const code = extractErrorCode(json);
    const action = classifySendError(code);
    const detail = json?.error?.message ?? `HTTP ${res.status}`;
    // `halt` is the one that matters. Log it loudly — it is the difference
    // between noticing a quality problem today and finding the number
    // restricted next week.
    if (action === 'halt') logger.error('WhatsApp: halting error', { code, detail });
    else logger.warn('WhatsApp: send failed', { code, action, detail });
    return { ok: false, code, action, detail };
  } catch (err) {
    // Network failure or timeout. Nothing is known about the account's health,
    // so this must never be read as a reason to stop or to drop a driver.
    logger.warn('WhatsApp: transport error', { err });
    return { ok: false, code: null, action: 'ignore', detail: String(err) };
  }
}
