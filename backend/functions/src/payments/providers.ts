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
import { createHmac, createCipheriv, timingSafeEqual } from 'crypto';
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

// ─── Mock — development only, no real money ──────────────────────────────────
class MockProvider implements PaymentProvider {
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
}

const jazzcash = new JazzCashProvider();
const easypaisa = new EasypaisaProvider();
const mock = new MockProvider();

const REGISTRY: Record<string, PaymentProvider> = { jazzcash, easypaisa, mock };

/** Real providers that currently have credentials configured. */
export function configuredProviders(): PaymentProvider[] {
  return [jazzcash, easypaisa].filter((p) => p.isConfigured());
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
  for (const p of [jazzcash, easypaisa, mock]) {
    if (p.ownsCallback(params)) return p;
  }
  return null;
}

export function isMockProvider(): boolean {
  return resolveProvider().name === 'mock';
}

export { easypaisa as easypaisaProvider };
