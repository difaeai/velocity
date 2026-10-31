'use client';

import { AuthProvider } from '@/lib/auth';
import { NetworkNotice } from '@/components/states';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <NetworkNotice />
    </AuthProvider>
  );
}
