/**
 * Payment provider adapters — JazzCash, Easypaisa and the dev mock.
 *
 * Money never moves on the client. Top-ups create a server-side intent, the
 * user completes payment on the gateway's hosted page, and the gateway's
 * callback is verified server-side before a Firestore transaction credits the
 * wallet. Settlement lands in the merchant account (your JazzCash / Easypaisa /
 * bank account) configured with the gateway — the app never holds gateway
 * credentials client-side.
 *
 * Credentials come from Cloud Functions secrets / env vars (see docs/PAYMENTS.md):
 *   JazzCash : JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, JAZZCASH_INTEGRITY_SALT,
 *              JAZZCASH_ENV=sandbox|live
 *   Easypaisa: EASYPAISA_STORE_ID, EASYPAISA_HASH_KEY (optional),
 *              EASYPAISA_INQUIRE_USERNAME / EASYPAISA_INQUIRE_PASSWORD (optional,
 *              enables server-to-server confirmation), EASYPAISA_ENV=sandbox|live
 */
import { createHash, createHmac, createCipheriv, timingSafeEqual } from 'crypto';
import { logger } from 'firebase-functions';

export interface ChargeContext {
  /** Our paymentIntents doc id. */
  intentId: string;
  /** Gateway-safe alphanumeric transaction reference stored on the intent. */
  providerRef: string;
  /** Integer PKR. */
  amount: number;
  phone?: string;
  description?: string;
}

/** A gateway form the hosted checkout page auto-submits in the user's browser. */
export interface CheckoutForm {
  actionUrl: string;
  method: 'POST' | 'GET';
  fields: Record<string, string>;
}

export interface CallbackOutcome {
  /** The providerRef we issued (maps back to the intent). */
  providerRef: string;
  success: boolean;
  /** Whether success was proven cryptographically / server-to-server. */
  verified: boolean;
  responseCode?: string;
  message?: string;
  /**
   * What the gateway says actually reaches our merchant account, in PKR.
   * Never used to decide the credit — `creditFromIntent` always credits the
   * amount stored on our own intent — but a mismatch is worth shouting about.
   */
  settledAmount?: number;
  /** Which rail the payer actually used ("Card", "Easypaisa", …), for the ledger. */
  methodName?: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** True when all required credentials are present. */
  isConfigured(): boolean;
  /**
   * Build the gateway form. `callbackUrl` is where the gateway must send the
   * outcome (our paymentWebhook, carrying the per-intent secret token).
   */
  buildCheckoutForm(ctx: ChargeContext, callbackUrl: string): CheckoutForm;
  /** Does this callback payload belong to this provider? */
  ownsCallback(params: Record<string, string>): boolean;
  /** Verify a gateway callback and extract the outcome. Null = invalid/forged. */
  verifyCallback(params: Record<string, string>): Promise<CallbackOutcome | null>;
}

// ─── Saved payment methods (tokenisation) ────────────────────────────────────
// The inDrive-style "connected accounts" model: the user authorises us once at
// the gateway, the gateway hands back a reusable token, and later top-ups are a
// single server-to-server charge with no redirect.
//
// This is a SEPARATE gateway permission from plain checkout — every Pakistani
// provider sells recurring/tokenisation as its own approval — so a provider may
// be fully configured for top-ups and still not implement this interface.

/** What a saved instrument actually is, for display and for icon choice. */
export type SavedMethodKind = 'easypaisa' | 'jazzcash' | 'card' | 'bank';

export interface SetupContext {
  /** Our paymentMethodSetups doc id. */
  setupId: string;
  /** Gateway-safe alphanumeric reference stored on the setup. */
  providerRef: string;
  kind: SavedMethodKind;
  phone?: string;
}

/** What the gateway tells us once the user has authorised a reusable token. */
export interface SetupOutcome {
  providerRef: string;
  success: boolean;
  /** Whether success was proven cryptographically / server-to-server. */
  verified: boolean;
  /** The reusable token. Server-only — never returned to a client. */
  token?: string;
  /** Display-safe tail of the account/card, e.g. "4321". Never the full number. */
  maskedAccount?: string;
  /** Card scheme, when the instrument is a card. */
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  message?: string;
}

export interface TokenChargeResult {
  success: boolean;
  /** The gateway's own transaction reference, for the ledger. */
  providerTxnRef?: string;
  responseCode?: string;
  message?: string;
  /**
   * True when the token is permanently unusable (revoked, expired, closed
   * account) so the caller should mark the saved method dead rather than let
   * the user keep retrying it.
   */
  tokenDead?: boolean;
}

/** A provider that can store and re-charge an instrument on the user's behalf. */
export interface TokenizingProvider extends PaymentProvider {
  /** Which instrument kinds this gateway can save. */
  supportedMethodKinds(): SavedMethodKind[];
  /**
   * Build the form that sends the user to the gateway to authorise a reusable
   * token. `callbackUrl` carries the per-setup secret, like checkout does.
   */
  buildSetupForm(ctx: SetupContext, callbackUrl: string): CheckoutForm;
  /** Does this callback payload belong to this provider's setup flow? */
  ownsSetupCallback(params: Record<string, string>): boolean;
  /** Verify a setup callback and extract the token. Null = invalid/forged. */
  verifySetupCallback(params: Record<string, string>): Promise<SetupOutcome | null>;
  /** Charge a saved token server-to-server. No user interaction. */
  chargeToken(token: string, ctx: ChargeContext): Promise<TokenChargeResult>;
  /** Best-effort revoke at the gateway when the user removes the method. */
  revokeToken(token: string): Promise<void>;
}

/** Narrow a provider to one that supports saved instruments. */
export function supportsTokenization(p: PaymentProvider): p is TokenizingProvider {
  return typeof (p as Partial<TokenizingProvider>).chargeToken === 'function';
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** yyyyMMddHHmmss in Pakistan time, as JazzCash requires. */
function karachiTimestamp(msFromNow = 0): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(Date.now() + msFromNow));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

// ─── JazzCash — Page Redirection API v1.1 ────────────────────────────────────
// The user is form-POSTed to the JazzCash hosted page (wallet / card / voucher),
// pays, and JazzCash POSTs the result back to pp_ReturnURL with pp_SecureHash =
// HMAC-SHA256 over the sorted non-empty pp_* values, keyed by the integrity
// salt. The salt never leaves the server, so a valid hash proves the callback
// came from JazzCash.
class JazzCashProvider implements PaymentProvider {
  readonly name = 'jazzcash';

  private get merchantId() { return env('JAZZCASH_MERCHANT_ID'); }
  private get password() { return env('JAZZCASH_PASSWORD'); }
  private get salt() { return env('JAZZCASH_INTEGRITY_SALT'); }

  private get baseUrl(): string {
    return (env('JAZZCASH_ENV') ?? 'sandbox') === 'live'
      ? 'https://payments.jazzcash.com.pk'
      : 'https://sandbox.jazzcash.com.pk';
  }

  isConfigured(): boolean {
    return Boolean(this.merchantId && this.password && this.salt);
  }

  /** HMAC-SHA256 over salt + '&' + sorted non-empty values, uppercase hex. */
  private secureHash(fields: Record<string, string>): string {
    const salt = this.salt!;
    const message = Object.keys(fields)
      .filter((k) => k.toLowerCase().startsWith('pp') && fields[k] !== '')
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map((k) => fields[k])
      .join('&');
    return createHmac('sha256', salt).update(`${salt}&${message}`).digest('hex').toUpperCase();
  }

  buildCheckoutForm(ctx: ChargeContext, callbackUrl: string): CheckoutForm {
    if (!this.isConfigured()) throw new Error('JazzCash is not configured.');
    const fields: Record<string, string> = {
      pp_Version: '1.1',
      pp_TxnType: '', // blank → hosted page shows wallet, card and voucher options
      pp_Language: 'EN',
      pp_MerchantID: this.merchantId!,
      pp_SubMerchantID: '',
      pp_Password: this.password!,
      pp_BankID: '',
      pp_ProductID: '',
      pp_TxnRefNo: ctx.providerRef,
      pp_Amount: String(ctx.amount * 100), // paisa
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: karachiTimestamp(),
      pp_TxnExpiryDateTime: karachiTimestamp(24 * 60 * 60 * 1000),
      pp_BillReference: 'wallet',
      pp_Description: (ctx.description ?? 'Velocity wallet top-up').slice(0, 100),
      pp_ReturnURL: callbackUrl,
      ppmpf_1: ctx.intentId,
      ppmpf_2: '', ppmpf_3: '', ppmpf_4: '', ppmpf_5: '',
    };
    fields.pp_SecureHash = this.secureHash(fields);
    return {
      actionUrl: `${this.baseUrl}/CustomerPortal/transactionmanagement/merchantform/`,
      method: 'POST',
      fields,
    };
  }

  ownsCallback(params: Record<string, string>): boolean {
    return 'pp_TxnRefNo' in params || 'pp_SecureHash' in params;
  }

  async verifyCallback(params: Record<string, string>): Promise<CallbackOutcome | null> {
    if (!this.isConfigured()) return null;
    const received = params.pp_SecureHash ?? '';
    if (!received || !params.pp_TxnRefNo) return null;
    const toHash: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k.toLowerCase().startsWith('pp') && k !== 'pp_SecureHash') toHash[k] = v;
    }
    const expected = this.secureHash(toHash);
    if (!constantTimeEquals(expected, received.toUpperCase())) {
      logger.warn('JazzCash callback failed hash verification', { ref: params.pp_TxnRefNo });
      return null;
    }
    return {
      providerRef: params.pp_TxnRefNo,
      success: params.pp_ResponseCode === '000',
      verified: true,
      responseCode: params.pp_ResponseCode,
      message: params.pp_ResponseMessage,
    };
  }
}

// ─── Easypaisa — Easypay hosted checkout ─────────────────────────────────────
// Three-legged browser flow:
//   1. auto-POST to Index.jsf (storeId, amount, orderRefNum, postBackURL#1)
//   2. Easypay redirects to postBackURL#1 with auth_token → we auto-POST
//      Confirm.jsf (auth_token, postBackURL#2)
//   3. Easypay redirects to postBackURL#2 with status/orderRefNumber.
// The final redirect carries no signature, so the callback alone is only
// protected by the per-intent secret token in the URL. When the inquiry
// credentials are configured we additionally confirm the payment
// server-to-server before crediting (recommended for production).
class EasypaisaProvider implements PaymentProvider {
  readonly name = 'easypaisa';

  private get storeId() { return env('EASYPAISA_STORE_ID'); }
  private get hashKey() { return env('EASYPAISA_HASH_KEY'); }
  private get inquireUser() { return env('EASYPAISA_INQUIRE_USERNAME'); }
  private get inquirePass() { return env('EASYPAISA_INQUIRE_PASSWORD'); }

  private get baseUrl(): string {
    return (env('EASYPAISA_ENV') ?? 'sandbox') === 'live'
      ? 'https://easypay.easypaisa.com.pk'
      : 'https://easypaystg.easypaisa.com.pk';
  }

  isConfigured(): boolean {
    return Boolean(this.storeId);
  }

  /** Whether server-to-server confirmation is available. */
  canInquire(): boolean {
    return Boolean(this.inquireUser && this.inquirePass);
  }

  /** AES-128-ECB(base64) over the sorted key=value query string, per Easypay spec. */
  private hashRequest(fields: Record<string, string>): string | null {
    const key = this.hashKey;
    if (!key) return null;
    const message = Object.keys(fields)
      .filter((k) => fields[k] !== '')
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('&');
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
    return Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]).toString('base64');
  }

  buildCheckoutForm(ctx: ChargeContext, callbackUrl: string): CheckoutForm {
    if (!this.isConfigured()) throw new Error('Easypaisa is not configured.');
    const fields: Record<string, string> = {
      storeId: this.storeId!,
      amount: `${ctx.amount}.0`,
      postBackURL: callbackUrl,
      orderRefNum: ctx.providerRef,
      expiryDate: '', // no expiry
      autoRedirect: '1',
      emailAddr: '',
      mobileNum: ctx.phone ?? '',
    };
    const hashed = this.hashRequest(fields);
    if (hashed) fields.merchantHashedReq = hashed;
    return { actionUrl: `${this.baseUrl}/easypay/Index.jsf`, method: 'POST', fields };
  }

  /** Second leg: exchange the auth token, sending the user to the final callback. */
  buildConfirmForm(authToken: string, finalCallbackUrl: string): CheckoutForm {
    return {
      actionUrl: `${this.baseUrl}/easypay/Confirm.jsf`,
      method: 'POST',
      fields: { auth_token: authToken, postBackURL: finalCallbackUrl },
    };
  }

  ownsCallback(params: Record<string, string>): boolean {
    return 'orderRefNumber' in params || 'orderRefNum' in params;
  }

  async verifyCallback(params: Record<string, string>): Promise<CallbackOutcome | null> {
    if (!this.isConfigured()) return null;
    const providerRef = params.orderRefNumber ?? params.orderRefNum;
    if (!providerRef) return null;
    const claimedSuccess = params.status === '0000' || params.success === 'true';

    if (!claimedSuccess) {
      return { providerRef, success: false, verified: false, responseCode: params.status, message: params.desc };
    }
    // Confirm server-to-server when inquiry credentials exist.
    if (this.canInquire()) {
      const confirmed = await this.inquireTransaction(providerRef);
      if (confirmed === null) return null; // could not verify — do not credit
      return { providerRef, success: confirmed, verified: true, responseCode: params.status };
    }
    // No inquiry credentials: outcome rests on the per-intent secret token that
    // the webhook handler has already validated. Flag as unverified so the
    // handler can decide (allowed, but logged).
    return { providerRef, success: true, verified: false, responseCode: params.status };
  }

  /** Easypay REST inquire-transaction: returns paid?, or null if the check failed. */
  private async inquireTransaction(orderId: string): Promise<boolean | null> {
    try {
      const credentials = Buffer.from(`${this.inquireUser}:${this.inquirePass}`).toString('base64');
      const res = await fetch(`${this.baseUrl}/easypay-service/rest/v4/inquire-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Credentials: credentials },
        body: JSON.stringify({ orderId, storeId: this.storeId, accountNum: '' }),
      });
      if (!res.ok) {
        logger.error('Easypaisa inquiry HTTP error', { orderId, status: res.status });
        return null;
      }
      const data = (await res.json()) as { responseCode?: string; transactionStatus?: string };
      if (data.responseCode !== '0000') return false;
      const status = (data.transactionStatus ?? '').toUpperCase();
      return status === 'PAID' || status === 'SUCCESS';
    } catch (e) {
      logger.error('Easypaisa inquiry failed', { orderId, e });
      return null;
    }
  }
}

// ─── PayFast (Pakistan) — the single-contract aggregator ─────────────────────
// PayFast by APPS is one merchant account that fronts cards, JazzCash,
// Easypaisa, HBL Konnect and bank transfer, so the app gets a full method
// picker without a separate onboarding per rail.
//
// STATUS — verified end to end against the sandbox on 2026-07-20 with a real
// card payment (PKR 150, err_code 000). gopayfast.com/docs is IP-gated, so the
// field names below were confirmed empirically rather than from documentation.
//
//   1. TOKEN_PATH — ✅ /Ecommerce/api/Transaction/GetAccessToken returns
//      200 + ACCESS_TOKEN for form, JSON and query encodings.
//   2. The checkout field set — ✅ accepted; PayFast renders its own method
//      picker (Bank / Card / Wallets incl. Easypaisa+JazzCash / Raast), so the
//      app does not need to choose a rail before redirecting.
//   3. Callback fields — ✅ confirmed, see verifyCallback.
//   4. signature() — ❓ STILL UNVERIFIED. md5(merchantId:merchantName:amount:
//      basketId) per a community package. A payment succeeded with it present,
//      but one also got the same treatment with a deliberately wrong value and
//      with the field absent, so it may simply be ignored on this flow. Harmless
//      to send; do not rely on it as security.
//   5. PAYFAST_BASE_URL — ✅ sandbox https://ipguat.apps.net.pk;
//      ❓ production host still unknown. There is deliberately no live default:
//      `isConfigured()` refuses to run live until it is set explicitly, so a
//      missing value fails closed instead of posting real money at the sandbox.
//
// PostTransaction is a BROWSER form POST. Driving it server-side always lands
// on /Ecommerce/Error/Index with an empty error code, so it can only be
// exercised from a real browser session — which is how the app uses it anyway
// (paymentCheckout renders an auto-submitting form into the user's browser).
//
// The callback also carries Recurring_txn, which is PayFast's marker for
// tokenised repeat charges — i.e. this gateway can support the saved-payment-
// method flow in payments/paymentMethods.ts once that permission is granted.
//
// Deliberately NOT guessed: we never parse PayFast's response field names to
// decide success. The outcome is carried on OUR OWN return URLs
// (`?pfoutcome=success|failure`) alongside the per-intent secret, both of which
// we set ourselves. That is forgery-resistant given the secret and it cannot
// silently break if PayFast renames a response field.
//
// Still worth adding once you have the pack: a server-to-server transaction
// inquiry before crediting, exactly as EasypaisaProvider.inquireTransaction
// does. Until then a top-up rests on the per-intent secret alone.
const PAYFAST_SANDBOX_URL = 'https://ipguat.apps.net.pk';
const PAYFAST_TOKEN_PATH = '/Ecommerce/api/Transaction/GetAccessToken';
const PAYFAST_TXN_PATH = '/Ecommerce/api/Transaction/PostTransaction';

class PayFastProvider implements PaymentProvider {
  readonly name = 'payfast';

  private get merchantId() { return env('PAYFAST_MERCHANT_ID'); }
  private get securedKey() { return env('PAYFAST_SECURED_KEY'); }
  private get merchantName() { return env('PAYFAST_MERCHANT_NAME') ?? 'Velocity'; }
  private get isLive() { return env('PAYFAST_ENV') === 'live'; }

  /** Sandbox has a known host; live must be set explicitly (see the note above). */
  private get baseUrl(): string | undefined {
    const explicit = env('PAYFAST_BASE_URL');
    if (explicit) return explicit.replace(/\/+$/, '');
    return this.isLive ? undefined : PAYFAST_SANDBOX_URL;
  }

  isConfigured(): boolean {
    return Boolean(this.merchantId && this.securedKey && this.baseUrl);
  }

  /** CONFIRM against the merchant pack before going live. */
  private signature(amount: number, basketId: string): string {
    return createHash('md5')
      .update(`${this.merchantId}:${this.merchantName}:${amount}:${basketId}`)
      .digest('hex');
  }

  /**
   * Leg 1: exchange the merchant credentials for a short-lived access token.
   * Returns null when PayFast declines — the caller must not build a form then.
   */
  private async fetchAccessToken(amount: number, basketId: string): Promise<string | null> {
    try {
      const body = new URLSearchParams({
        MERCHANT_ID: this.merchantId!,
        SECURED_KEY: this.securedKey!,
        BASKET_ID: basketId,
        TXNAMT: String(amount),
        CURRENCY_CODE: 'PKR',
      });
      const res = await fetch(`${this.baseUrl}${PAYFAST_TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        logger.error('PayFast token HTTP error', { status: res.status, basketId });
        return null;
      }
      // VERIFIED against the sandbox 2026-07-20. A successful response is:
      //   {"MERCHANT_ID":14833.0,"ACCESS_TOKEN":"…","NAME":"…",
      //    "GENERATED_DATE_TIME":"2026-07-20T13:00:00+05:00"}
      // There is no status/code field — the presence of ACCESS_TOKEN is the
      // only success signal, so treat its absence as a decline.
      const data = (await res.json()) as { ACCESS_TOKEN?: string; Message?: string };
      if (!data.ACCESS_TOKEN) {
        logger.error('PayFast token declined', { basketId, message: data.Message ?? null });
        return null;
      }
      return data.ACCESS_TOKEN;
    } catch (e) {
      logger.error('PayFast token fetch failed', { basketId, e });
      return null;
    }
  }

  /**
   * PayFast needs an access token fetched over the network before the form can
   * be built, which the synchronous `buildCheckoutForm` contract cannot express.
   * `paymentCheckout` calls this first and passes the result through.
   */
  async prepare(ctx: ChargeContext): Promise<string | null> {
    if (!this.isConfigured()) return null;
    return this.fetchAccessToken(ctx.amount, ctx.providerRef);
  }

  buildCheckoutForm(ctx: ChargeContext, callbackUrl: string, accessToken?: string): CheckoutForm {
    if (!this.isConfigured()) throw new Error('PayFast is not configured.');
    if (!accessToken) throw new Error('PayFast access token could not be obtained.');
    const separator = callbackUrl.includes('?') ? '&' : '?';
    return {
      actionUrl: `${this.baseUrl}${PAYFAST_TXN_PATH}`,
      method: 'POST',
      fields: {
        MERCHANT_ID: this.merchantId!,
        MERCHANT_NAME: this.merchantName,
        TOKEN: accessToken,
        PROCCODE: '00',
        TXNAMT: String(ctx.amount),
        CUSTOMER_MOBILE_NO: ctx.phone ?? '',
        CUSTOMER_EMAIL_ADDRESS: '',
        SIGNATURE: this.signature(ctx.amount, ctx.providerRef),
        TXNDESC: (ctx.description ?? 'Velocity wallet top-up').slice(0, 100),
        BASKET_ID: ctx.providerRef,
        ORDER_DATE: new Date().toISOString().slice(0, 10),
        CURRENCY_CODE: 'PKR',
        SUCCESS_URL: `${callbackUrl}${separator}pfoutcome=success`,
        FAILURE_URL: `${callbackUrl}${separator}pfoutcome=failure`,
      },
    };
  }

  ownsCallback(params: Record<string, string>): boolean {
    // basket_id + err_code is PayFast's own signature on a return; pfoutcome is
    // the marker we put on our return URLs, kept as a belt-and-braces fallback.
    return ('basket_id' in params && 'err_code' in params) || 'pfoutcome' in params;
  }

  async verifyCallback(params: Record<string, string>): Promise<CallbackOutcome | null> {
    if (!this.isConfigured()) return null;
    const providerRef = params.basket_id ?? params.BASKET_ID ?? params.pfref;
    if (!providerRef) return null;

    // VERIFIED against a real sandbox card payment 2026-07-20. A success is:
    //   err_code=000, err_msg="Transaction completed successfully",
    //   transaction_id=<uuid>, basket_id=<our ref>, PaymentName="Card",
    //   transaction_amount="152.00", merchant_amount="150.00",
    //   validation_hash=<64 hex>, Recurring_txn="false"
    //
    // Note transaction_amount ≠ merchant_amount: PayFast added its fee on top
    // of the PKR 150 we asked for, charged the payer 152, and settled us the
    // full 150. So the payer can be charged more than the wallet is credited —
    // which is correct, and why the credit always comes from our own intent.
    const settled = Number.parseFloat(params.merchant_amount ?? '');

    return {
      providerRef,
      // err_code "000" is PayFast's success code; fall back to the marker on
      // our own return URL if a future response ever omits it.
      success: params.err_code === '000'
        || (params.err_code === undefined && params.pfoutcome === 'success'),
      // The response carries validation_hash (SHA-256), but its formula is not
      // published and could not be derived from a captured response, so we
      // cannot check it. Until it can be, the per-intent secret in the callback
      // URL is the proof — paymentWebhook enforces that when verified is false.
      verified: false,
      responseCode: params.err_code,
      message: params.err_msg,
      settledAmount: Number.isFinite(settled) ? settled : undefined,
      methodName: params.PaymentName || undefined,
    };
  }
}

// ─── Mock — development only, no real money ──────────────────────────────────
// Implements tokenisation in full so the entire saved-payment-method flow —
// connect an account, set a default, one-tap top-up, remove it — is testable
// end to end without any merchant contract.
class MockProvider implements TokenizingProvider {
  readonly name = 'mock';
  isConfigured(): boolean { return true; }

  buildCheckoutForm(): CheckoutForm {
    throw new Error('The mock provider has no hosted checkout; use mockConfirmTopup.');
  }

  ownsCallback(params: Record<string, string>): boolean {
    return 'mockProviderRef' in params;
  }

  async verifyCallback(params: Record<string, string>): Promise<CallbackOutcome | null> {
    if (!params.mockProviderRef) return null;
    return { providerRef: params.mockProviderRef, success: params.success === 'true', verified: false };
  }

  supportedMethodKinds(): SavedMethodKind[] {
    return ['easypaisa', 'jazzcash', 'card', 'bank'];
  }

  buildSetupForm(): CheckoutForm {
    throw new Error('The mock provider has no hosted setup page; use mockConfirmPaymentMethod.');
  }

  ownsSetupCallback(params: Record<string, string>): boolean {
    return 'mockSetupRef' in params;
  }

  async verifySetupCallback(params: Record<string, string>): Promise<SetupOutcome | null> {
    if (!params.mockSetupRef) return null;
    return {
      providerRef: params.mockSetupRef,
      success: true,
      verified: false,
      token: `mocktok_${params.mockSetupRef}`,
      maskedAccount: '4321',
    };
  }

  async chargeToken(token: string): Promise<TokenChargeResult> {
    return { success: true, providerTxnRef: `mockcharge_${token.slice(-8)}_${Date.now()}` };
  }

  async revokeToken(): Promise<void> { /* nothing to revoke */ }
}

const jazzcash = new JazzCashProvider();
const easypaisa = new EasypaisaProvider();
const payfast = new PayFastProvider();
const mock = new MockProvider();

const REGISTRY: Record<string, PaymentProvider> = { jazzcash, easypaisa, payfast, mock };

/** Every real provider, in the order the app should offer them. */
const REAL_PROVIDERS: PaymentProvider[] = [payfast, jazzcash, easypaisa];

/** Real providers that currently have credentials configured. */
export function configuredProviders(): PaymentProvider[] {
  return REAL_PROVIDERS.filter((p) => p.isConfigured());
}

/**
 * The provider that saved payment methods run through: the configured one that
 * can actually tokenise. Falls back to mock in development so the flow is
 * exercisable without a merchant account.
 */
export function tokenizingProvider(): TokenizingProvider | null {
  const real = configuredProviders().find(supportsTokenization);
  if (real) return real;
  return configuredProviders().length === 0 ? mock : null;
}

/**
 * Resolve the provider for a top-up. An explicit user choice must be
 * configured; otherwise fall back to PAYMENTS_PROVIDER, then to any configured
 * real provider, then to mock (development).
 */
export function resolveProvider(requested?: string): PaymentProvider {
  if (requested) {
    const p = REGISTRY[requested];
    if (!p || (p !== mock && !p.isConfigured())) {
      throw new Error(`Payment provider "${requested}" is not available.`);
    }
    return p;
  }
  const configured = env('PAYMENTS_PROVIDER');
  if (configured && REGISTRY[configured]?.isConfigured()) return REGISTRY[configured];
  return configuredProviders()[0] ?? mock;
}

export function getProviderByName(name: string): PaymentProvider | null {
  return REGISTRY[name] ?? null;
}

/** Find which provider a gateway callback belongs to. */
export function providerForCallback(params: Record<string, string>): PaymentProvider | null {
  for (const p of [...REAL_PROVIDERS, mock]) {
    if (p.ownsCallback(params)) return p;
  }
  return null;
}

/** Find which tokenizing provider a saved-method setup callback belongs to. */
export function providerForSetupCallback(params: Record<string, string>): TokenizingProvider | null {
  for (const p of [...REAL_PROVIDERS, mock]) {
    if (supportsTokenization(p) && p.ownsSetupCallback(params)) return p;
  }
  return null;
}

export function isMockProvider(): boolean {
  return resolveProvider().name === 'mock';
}

export { easypaisa as easypaisaProvider, payfast as payfastProvider };
