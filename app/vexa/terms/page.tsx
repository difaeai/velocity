import type { Metadata } from 'next';

import { LegalDoc } from '@/components/site/LegalDoc';
import { VEXA_TERMS } from '@/lib/vexaLegal';

/**
 * Vexa's terms: what is sold, what it costs, how it is paid for, when money
 * comes back, and what each side is responsible for. The ride app's terms,
 * which are about fares and trips, stay at /terms.
 */
export const metadata: Metadata = {
  title: { absolute: 'Terms of Service — Vexa' },
  description:
    'The agreement for Vexa: what the service does, the plans and prices, paying by card or transfer, refunds and stopping, and the limits of our responsibility.',
  alternates: { canonical: '/vexa/terms' },
};

export default function VexaTermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      lede="The agreement between your business and ours when you hire Vexa: what she does, what it costs, how you pay, how you stop, and what each of us is responsible for."
      clauses={VEXA_TERMS}
      current="/vexa/terms"
    />
  );
}
