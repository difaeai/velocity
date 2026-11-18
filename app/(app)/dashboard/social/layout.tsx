import type { Metadata } from 'next';

/**
 * The social half of the console is Vexa — the same product a Velocity Studio
 * customer logs into — so the browser tab says Vexa, not "Velocity Rides Admin".
 */
export const metadata: Metadata = {
  title: { absolute: 'Vexa' },
};

export default function VexaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
