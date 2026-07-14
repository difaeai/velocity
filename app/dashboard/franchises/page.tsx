'use client';

/**
 * The franchises section is now the Partner Program desk — franchise management
 * lives on as a tab inside it. This route is kept only so that bookmarks and
 * anything still linking to /dashboard/franchises land in the right place
 * instead of a 404.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FranchisesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/partners?tab=franchises');
  }, [router]);
  return null;
}
