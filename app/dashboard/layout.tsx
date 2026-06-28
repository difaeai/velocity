'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { Button } from '@/components/ui';

const NAV = [
  { href: '/dashboard',                label: '📊 Overview' },
  { href: '/dashboard/drivers',        label: '🚗 Driver approvals' },
  { href: '/dashboard/passengers',     label: '👥 Passengers' },
  { href: '/dashboard/disputes',       label: '⚖️ Disputes' },
  { href: '/dashboard/franchises',     label: '🏢 Franchises' },
  { href: '/dashboard/ride-settings',  label: '⚙️ Ride settings' },
  { href: '/dashboard/payouts',        label: '💳 Payouts' },
  { href: '/dashboard/live-ops',        label: '🗺️ Live ops map' },
  { href: '/dashboard/travel-mate',    label: '🤝 Travel Mate' },
  { href: '/dashboard/safety',         label: '🆘 Safety desk' },
  { href: '/dashboard/commission',     label: '📋 Commission' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { initializing, user, isAdmin, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!initializing && !user) router.replace('/login');
  }, [initializing, user, router]);

  if (initializing) return <Center>Loading…</Center>;
  if (!user) return <Center>Redirecting…</Center>;
  if (!isAdmin) {
    return (
      <Center>
        <div style={{ display: 'grid', gap: 12, textAlign: 'center' }}>
          <strong style={{ color: colors.danger }}>Not authorized</strong>
          <span style={{ color: colors.muted, fontSize: 14 }}>
            This account is not an admin.
          </span>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Center>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={asideStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={logoStyle}>V</div>
          <strong>Velocity</strong>
        </div>
        <nav style={{ display: 'grid', gap: 4 }}>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: 14,
                  background: active ? `${colors.primary}1A` : 'transparent',
                  color: active ? colors.primary : colors.text,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', paddingTop: 24 }}>
          <div style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>{user.email}</div>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 28, overflow: 'auto' }}>{children}</main>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>{children}</div>;
}

const asideStyle: React.CSSProperties = {
  width: 240,
  borderRight: `1px solid ${colors.border}`,
  background: colors.surface,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
};
const logoStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 9,
  background: colors.primary,
  color: '#fff',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 900,
};
