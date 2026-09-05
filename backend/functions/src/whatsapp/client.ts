/**
 * WhatsApp Cloud API transport — the wire, and nothing else.
 *
 * Velocity sends two kinds of message on this number, and they are not alike:
 *
 *  • The **offline-driver alert** — telling a driver with the app closed that
 *    there is a fare waiting a few streets away. Nobody asked for it, so it is
 *    hedged about with consent, caps and quiet hours (`alerts.ts`, `policy.ts`).
 *  • The **sign-in code** — the OTP somebody is actively waiting for, sent here
 *    instead of by Firebase SMS because Firebase charges several times as much
 *    per code (`auth/whatsappOtp.ts`).
 *
 * WhatsApp is not SMS, and the difference is the whole reason this file is
 * shaped the way it is.
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
 *     numbers flagged. `sendTemplate` and `sendOtpTemplate` are the only sends
 *     this file exposes, and both take a template name Meta has approved.
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

  return postMessage(cfg, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: cfg.templateName,
      language: { code: cfg.templateLang },
      components,
    },
  });
}

/**
 * Puts one already-built payload on the wire and reads Meta's answer.
 *
 * Shared by the alert template and the sign-in OTP template because the *answer*
 * is the part that matters and must be read identically for both: the same error
 * codes carry the same meaning about the same number, whichever template
 * provoked them. Only the components differ, and those are built by the callers.
 */
async function postMessage(
  cfg: { token: string; phoneNumberId: string },
  payload: Record<string, unknown>,
): Promise<SendResult> {
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

/* ───────────────────────── Sign-in codes (AUTHENTICATION) ────────────────────
 *
 * The second thing this number sends, and a different animal from the alert.
 *
 * An offline-driver alert is business-initiated: nobody asked for it, so every
 * rule in this file exists to keep it welcome. A sign-in code is the opposite —
 * the person is holding the phone, tapped Continue, and is waiting for it. It
 * cannot annoy anybody, and it is not what puts a quality rating at risk.
 *
 * What it does put at risk is the *login*, which is why it is wired to fail
 * differently: an alert that cannot be sent is a ride nobody hears about, while
 * a code that cannot be sent is a customer who cannot get in. Every refusal here
 * therefore has to be answerable, and the answer is Firebase's SMS — slower and
 * several times dearer, but always there. See `auth/whatsappOtp.ts`.
 *
 * Meta treats AUTHENTICATION as its own template category with its own rules:
 * the body text is theirs, not ours (`{{1}} is your verification code`), the
 * category is cheaper than Marketing and dearer than Utility, and the button —
 * if the template has one — carries the code a second time so the recipient can
 * copy or autofill it rather than retype it.
 */

/** Which OTP button the approved template carries. */
export type OtpButtonKind =
  /** `Copy code` — works on every platform, needs no app registration. */
  | 'copy_code'
  /**
   * One-tap autofill. Android only, and only after the app's package name and
   * signing-certificate hash are registered *on the template* in WhatsApp
   * Manager. Registered against the wrong signing key it degrades to a button
   * that does nothing, which is worse than Copy code.
   */
  | 'one_tap'
  /** The template has no button at all. */
  | 'none';

export interface WhatsAppOtpConfig {
  token: string;
  phoneNumberId: string;
  /** Approved AUTHENTICATION-category template used for sign-in codes. */
  templateName: string;
  /** Language code the template was approved in, e.g. `en` or `en_US`. */
  templateLang: string;
  button: OtpButtonKind;
}

/**
 * The two send payloads differ, and getting it wrong is `(#100) Invalid
 * parameter` — the same trap `resolveUrlButtonIndex` exists for. Copy-code
 * buttons take a `coupon_code` parameter under `sub_type: 'copy_code'`;
 * one-tap buttons take a plain text parameter under `sub_type: 'url'`. Neither
 * is inferable from here: it is a property of what Meta approved.
 */
function resolveOtpButton(): OtpButtonKind {
  const raw = env('WHATSAPP_OTP_BUTTON').toLowerCase();
  if (raw === 'one_tap' || raw === 'url' || raw === 'autofill') return 'one_tap';
  if (raw === 'none' || raw === 'off') return 'none';
  // Default to the button that works everywhere and needs nothing registered.
  return 'copy_code';
}

/**
 * Sign-in OTP configuration, or null when it is not set up.
 *
 * Deliberately shares `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` with the
 * alerts — same business number, same credentials — but has its OWN template
 * name, because Meta will not let one template serve two categories. A missing
 * `WHATSAPP_OTP_TEMPLATE_NAME` is how this feature stays dark: sign-in falls
 * back to Firebase SMS and nobody is locked out.
 */
export function whatsAppOtpConfig(): WhatsAppOtpConfig | null {
  const token = env('WHATSAPP_TOKEN');
  const phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID');
  const templateName = env('WHATSAPP_OTP_TEMPLATE_NAME');
  if (!token || !phoneNumberId || !templateName) return null;
  return {
    token,
    phoneNumberId,
    templateName,
    templateLang: env('WHATSAPP_OTP_TEMPLATE_LANG') || 'en',
    button: resolveOtpButton(),
  };
}

/**
 * Builds the components for one authentication template send.
 *
 * Pure and exported so the payload shape — the part that earns `(#100)` when it
 * is wrong — is unit-testable without a token or a network.
 */
export function otpComponents(code: string, button: OtpButtonKind): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
  ];
  if (button === 'copy_code') {
    components.push({
      type: 'button',
      sub_type: 'copy_code',
      index: '0',
      parameters: [{ type: 'coupon_code', coupon_code: code }],
    });
  } else if (button === 'one_tap') {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: code }],
    });
  }
  return components;
}

/** One sign-in code. Never throws — see `postMessage`. */
export async function sendOtpTemplate(
  cfg: WhatsAppOtpConfig,
  to: string,
  code: string,
): Promise<SendResult> {
  return postMessage(cfg, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: cfg.templateName,
      language: { code: cfg.templateLang },
      components: otpComponents(code, cfg.button),
    },
  });
}
