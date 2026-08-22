'use client';

import { useParams } from 'next/navigation';

import { FranchisePortal } from '@/components/portal/FranchisePortal';

export default function FranchisePortalPage() {
  const params = useParams<{ portalId: string }>();
  const portalId = typeof params?.portalId === 'string' ? params.portalId : '';
  return <FranchisePortal portalId={portalId} />;
}
