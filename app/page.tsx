'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth';

export default function Home() {
  const { initializing, user, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    router.replace(user && isAdmin ? '/dashboard' : '/login');
  }, [initializing, user, isAdmin, router]);

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <p style={{ color: '#6f7a72' }}>Loading…</p>
    </main>
  );
}
