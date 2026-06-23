/**
 * Payment provider abstraction.
 *
 * Money never moves on the client. Top-ups create a server-side intent, the
 * provider charges the customer, and a verified webhook credits the wallet in a
 * Firestore transaction. Real Pakistani gateways (JazzCash / Easypaisa) are
 * wired here as adapters; their credentials live in Cloud Functions secrets and
 * are NOT committed. Until configured, the project runs on the `mock` provider.
 */

export interface ChargeRequest {
  amount: number; // integer PKR
  reference: string; // our intent id
  uid: string;
  phone?: string;
  description?: string;
}

export interface ChargeResult {
  providerRef: string;
  /** Where to send the user to complete payment (gateway-hosted page). */
  redirectUrl?: string;
}

export interface WebhookResult {
  reference: string;
  providerRef: string;
  success: boolean;
}

export interface PaymentProvider {
  readonly name: string;
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  /** Validates an incoming gateway webhook and extracts the outcome. */
  verifyWebhook(headers: Record<string, string | undefined>, body: unknown): WebhookResult | null;
}

/**
 * Development provider: no real money. createCharge returns a deeplink the app
 * can "confirm" via the mockConfirmTopup callable; the webhook trusts its body.
 */
class MockProvider implements PaymentProvider {
  readonly name = 'mock';

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    return {
      providerRef: `mock_${req.reference}`,
      redirectUrl: `velocity://payments/mock?ref=${req.reference}`,
    };
  }

  verifyWebhook(_headers: Record<string, string | undefined>, body: unknown): WebhookResult | null {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.reference !== 'string' || typeof b.providerRef !== 'string') return null;
    return { reference: b.reference, providerRef: b.providerRef, success: b.success === true };
  }
}

/**
 * Placeholder adapter for a real gateway. Throws until its credentials are
 * provided via Functions secrets (see docs/PAYMENTS.md). Implement createCharge
 * (gateway "initiate" API) and verifyWebhook (HMAC/secure-hash check) here.
 */
class UnconfiguredProvider implements PaymentProvider {
  constructor(readonly name: string) {}

  async createCharge(): Promise<ChargeResult> {
    throw new Error(
      `Payment provider "${this.name}" is not configured. Set its credentials ` +
        `(Functions secrets) and implement the adapter — see docs/PAYMENTS.md.`,
    );
  }

  verifyWebhook(): WebhookResult | null {
    return null;
  }
}

let provider: PaymentProvider | null = null;

/** Selected provider, from PAYMENTS_PROVIDER (default `mock`). */
export function getProvider(): PaymentProvider {
  if (provider) return provider;
  const choice = (process.env.PAYMENTS_PROVIDER ?? 'mock').toLowerCase();
  switch (choice) {
    case 'jazzcash':
      provider = new UnconfiguredProvider('jazzcash');
      break;
    case 'easypaisa':
      provider = new UnconfiguredProvider('easypaisa');
      break;
    default:
      provider = new MockProvider();
  }
  return provider;
}

export function isMockProvider(): boolean {
  return getProvider().name === 'mock';
}
