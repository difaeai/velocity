import { LegalDoc } from '@/components/site/LegalDoc';
import { VEXA_SUPPORT, vexaDocMetadata } from '@/lib/vexaLegal';

/**
 * Vexa's support page: who we are, the number and address that are answered,
 * what she costs and what happens to your money. The card gateway asks for
 * exactly this, and it has to be about her — the ride app's version, which is
 * about fares, cash and drivers, stays at /support.
 */
export const metadata = vexaDocMetadata(
  'Support',
  'How to reach Vexa: support email, phone and WhatsApp, business address, what the plans cost, how you pay and how refunds work.',
  '/vexa/support',
);

export default function VexaSupportPage() {
  return (
    <LegalDoc
      title="Support"
      lede="Who you are dealing with, how to reach a person, what Vexa costs, how you pay and what happens if you want your money back."
      clauses={VEXA_SUPPORT}
      current="/vexa/support"
    />
  );
}
