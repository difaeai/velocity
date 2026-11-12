import type { Metadata } from 'next';

import { LegalDoc } from '@/components/site/LegalDoc';
import { VEXA_DELETION } from '@/lib/vexaLegal';

/**
 * How a Vexa workspace is deleted — the page Meta and TikTok require an app to
 * publish, and the one a customer looks for when they are done. Deleting a
 * rider's or driver's account is a different thing, at /delete-account.
 */
export const metadata: Metadata = {
  title: { absolute: 'Delete your workspace — Vexa' },
  description:
    'How to disconnect your accounts and have your Vexa workspace and everything in it deleted, what is deleted, and what has to be kept.',
  alternates: { canonical: '/vexa/delete-account' },
};

export default function VexaDeletePage() {
  return (
    <LegalDoc
      title="Delete your workspace"
      lede="How to disconnect your accounts and have your Vexa workspace — and everything in it — deleted, in two steps."
      clauses={VEXA_DELETION}
      current="/vexa/delete-account"
    />
  );
}
