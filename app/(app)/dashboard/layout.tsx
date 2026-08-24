'use client';

/**
 * The console shell.
 *
 * The dashboard now runs two businesses that have almost nothing to do with
 * each other: operating the ride-hailing platform, and marketing it. Nineteen
 * flat nav items made that invisible — Advertise (a paid product sold to shop
 * owners) sat next to Payouts, and there was nowhere for the social accounts to
 * live at all.
 *
 * So the sidebar has two sections. **Manage app** is everything about running
 * Velocity, grouped by the job you came here to do. **Manage social** is the
 * accounts and the daily content pipeline that posts to them. The switcher is
 * driven by the URL, so a link into either section lands with the right section
 * open and a refresh keeps it.
 */

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { Button } from '@/components/ui';
import { VelocityIcon } from '@/components/BrandMark';

interface NavItem {
  href: string;
  label: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Everything about running the platform, grouped by the job at hand. */
const APP_NAV: NavGroup[] = [
  {
    title: '',
    items: [{ href: '/dashboard', label: '📊 Overview' }],
  },
  {
    title: 'People',
    items: [
      { href: '/dashboard/drivers', label: '🚗 Driver approvals' },
      { href: '/dashboard/cnic', label: '🪪 CNIC verification' },
      { href: '/dashboard/passengers', label: '👥 Passengers' },
      { href: '/dashboard/disputes', label: '⚖️ Disputes' },
      { href: '/dashboard/safety', label: '🆘 Safety desk' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/dashboard/live-ops', label: '🗺️ Live ops map' },
      { href: '/dashboard/ride-settings', label: '⚙️ Ride settings' },
      { href: '/dashboard/special-rides', label: '🚙 Special Rides' },
      { href: '/dashboard/travel-mate', label: '🤝 Travel Partner' },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/dashboard/payouts', label: '💳 Payouts' },
      { href: '/dashboard/commission', label: '📋 Commission' },
      { href: '/dashboard/settlements', label: '🧾 Settlements' },
      { href: '/dashboard/cancellations', label: '🚫 Cancellation fees' },
    ],
  },
  {
    title: 'Growth',
    items: [
      { href: '/dashboard/partners', label: '🏢 Partner Program' },
      { href: '/dashboard/fleet-submissions', label: '📄 Fleet submissions' },
      { href: '/dashboard/advertise', label: '📣 Advertise' },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/dashboard/features', label: '🚦 Feature flags' },
      { href: '/dashboard/app-version', label: '⬆️ App version' },
    ],
  },
];

/** The marketing side: the accounts, and the machine that feeds them. */
const SOCIAL_NAV: NavGroup[] = [
  {
    title: '',
    items: [{ href: '/dashboard/social', label: '📡 Overview' }],
  },
  {
    title: 'Channels',
    items: [{ href: '/dashboard/social/accounts', label: '🔗 Connected accounts' }],
  },
  {
    title: 'Content',
    items: [
      { href: '/dashboard/social/calendar', label: '🗓️ Content calendar' },
      { href: '/dashboard/social/queue', label: '✅ Approval queue' },
      { href: '/dashboard/social/automation', label: '🤖 Automation' },
    ],
  },
];

const SECTIONS = [
  { key: 'app', label: 'Manage app', home: '/dashboard', nav: APP_NAV },
  { key: 'social', label: 'Manage social', home: '/dashboard/social', nav: SOCIAL_NAV },
] as const;

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
          <span style={{ color: colors.muted, fontSize: 14 }}>This account is not an admin.</span>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Center>
    );
  }

  // The URL decides which section is open, so deep links and refreshes agree.
  const section = pathname.startsWith('/dashboard/social') ? SECTIONS[1] : SECTIONS[0];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={asideStyle}>
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <VelocityIcon size={32} />
          <strong>Velocity</strong>
        </Link>

        <div style={switcherStyle}>
          {SECTIONS.map((s) => {
            const active = s.key === section.key;
            return (
              <Link
                key={s.key}
                href={s.home}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '7px 6px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 800,
                  background: active ? colors.surface : 'transparent',
                  color: active ? colors.primary : colors.muted,
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
                }}
              >
                {s.label}
              </Link>
            );
          })}
        </div>

        <nav style={{ display: 'grid', gap: 2, marginTop: 16 }}>
          {section.nav.map((group) => (
            <div key={group.title || 'root'} style={{ display: 'grid', gap: 2 }}>
              {group.title ? <div style={groupTitleStyle}>{group.title}</div> : null}
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      padding: '9px 12px',
                      borderRadius: 10,
                      fontWeight: 700,
                      fontSize: 13.5,
                      background: active ? `${colors.primary}1A` : 'transparent',
                      color: active ? colors.primary : colors.text,
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 24 }}>
          <div style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>{user.email}</div>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 28, overflow: 'auto', minWidth: 0 }}>{children}</main>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>{children}</div>;
}

const asideStyle: React.CSSProperties = {
  width: 246,
  flex: 'none',
  borderRight: `1px solid ${colors.border}`,
  background: colors.surface,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  position: 'sticky',
  top: 0,
  height: '100vh',
  overflowY: 'auto',
};

const switcherStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: 3,
};

const groupTitleStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: 0.7,
  textTransform: 'uppercase',
  color: colors.muted,
  padding: '14px 12px 4px',
};
