import type { Metadata } from 'next';

import { Providers } from '@/components/Providers';

/**
 * The Pro partner's fleet portal.
 *
 * Its own route group because it needs Firebase auth but *not* the admin gate
 * in `(app)` — the people signing in here are partners, whose role claim is
 * `passenger`. Authorisation is not done in this layout at all: every portal
 * callable re-derives it server-side from the signed-in uid, so a client that
 * skips the UI gate still gets nothing.
 */
export const metadata: Metadata = {
  title: { absolute: 'Velocity Fleet Portal' },
  description: 'Run your Velocity fleet: add drivers, share your code, track approvals.',
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Providers>{children}</Providers>;
}
