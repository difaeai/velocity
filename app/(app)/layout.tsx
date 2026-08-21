import type { Metadata } from 'next';

import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  // `absolute` so the marketing template on the root layout does not append
  // " · Velocity" to every console screen.
  title: { absolute: 'Velocity Admin' },
  description: 'Operations console for the Velocity ride-hailing platform.',
  // Neither the console nor a one-off share link belongs in a search index.
  robots: { index: false, follow: false },
};

/**
 * Everything behind Firebase auth — the admin console, the sign-in page and the
 * share-link interstitial. Kept in a route group so the Firebase SDK never ships
 * with the public marketing page at `/`. URLs are unchanged: route groups do not
 * appear in the path.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Providers>{children}</Providers>;
}
