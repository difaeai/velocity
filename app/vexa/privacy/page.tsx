import { LegalDoc } from '@/components/site/LegalDoc';
import { VEXA_PRIVACY, vexaDocMetadata } from '@/lib/vexaLegal';

/**
 * Vexa's privacy policy, on its own address — what Meta, TikTok and Stripe are
 * given, and what a customer reads. The ride app's policy stays at /privacy.
 */
export const metadata = vexaDocMetadata(
  'Privacy Policy',
  'What Vexa stores about your business and your connected accounts, who else sees it, how long it is kept and how to have it all deleted.',
  '/vexa/privacy',
);

export default function VexaPrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      lede="What Vexa knows about you and your business, why she knows it, who else sees it, and how to have all of it deleted."
      clauses={VEXA_PRIVACY}
      current="/vexa/privacy"
    />
  );
}
