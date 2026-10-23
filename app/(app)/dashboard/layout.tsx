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

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

import { useAuth } from '@/lib/auth';
import { STUDIO_PLANS, type StudioNeed } from '@/lib/studio';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace';
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
      { href: '/dashboard/support', label: '⚡ Rapid Response' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/dashboard/live-ops', label: '🗺️ Live ops map' },
      // Live ops is the rides happening now; this is every ride that ever did.
      // Next to each other because an operator moves between the two mid-call.
      { href: '/dashboard/rides', label: '🧾 Ride record' },
      { href: '/dashboard/locations', label: '📍 Locations' },
      { href: '/dashboard/ride-settings', label: '⚙️ Ride settings' },
      { href: '/dashboard/pricing', label: '🧮 Pricing engine' },
      { href: '/dashboard/market-rates', label: '📊 Market rates' },
      { href: '/dashboard/special-rides', label: '🚙 Rent a car' },
      { href: '/dashboard/travel-mate', label: '🤝 Travel Partner' },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/dashboard/payouts', label: '💳 Payouts' },
      { href: '/dashboard/commission', label: '📋 Commission' },
      { href: '/dashboard/settlements', label: '🧾 Settlements' },
      { href: '/dashboard/manual-topups', label: '🏦 Balance top-ups' },
      { href: '/dashboard/receiving-accounts', label: '🏧 Receiving accounts' },
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
      { href: '/dashboard/testing', label: '🧪 Testing' },
      { href: '/dashboard/app-version', label: '⬆️ App version' },
      { href: '/dashboard/costs', label: '💸 Cost of Velocity Rides' },
    ],
  },
];

/** The marketing side: the accounts, and the machine that feeds them. */
const SOCIAL_NAV: NavGroup[] = [
  {
    title: '',
    items: [{ href: '/dashboard/social', label: '🏠 Dashboard' }],
  },
  // Two groups, not four: what you do every day, then the things you set up
  // once and rarely open again. A sidebar heading per link is a filing system,
  // not navigation.
  {
    title: 'Every day',
    items: [
      { href: '/dashboard/social/queue', label: '✅ Posts & approval' },
      { href: '/dashboard/social/ads', label: '💸 Meta Ad Expert' },
      { href: '/dashboard/social/calendar', label: '🗓️ Content calendar' },
      { href: '/dashboard/social/inbox', label: '💬 Comments' },
      { href: '/dashboard/social/performance', label: '📈 Analytics' },
      { href: '/dashboard/social/sales', label: '🤝 Sales agent' },
    ],
  },
  {
    title: 'Set up once',
    items: [
      { href: '/dashboard/social/accounts', label: '🔗 Connected accounts' },
      { href: '/dashboard/social/employees', label: '🤖 AI agents' },
      { href: '/dashboard/social/automation', label: '⚙️ Settings' },
    ],
  },
];

/** Admins only: the businesses using Velocity Studio, and the payments waiting for a decision. */
const STUDIO_ADMIN_NAV: NavGroup = {
  title: 'Velocity Studio',
  items: [{ href: '/dashboard/social/studio-customers', label: '💼 Customers & payments' }],
};

/** Which plan part each desk page belongs to; a customer sees only what theirs includes. */
const NEED_OF: Record<string, StudioNeed> = {
  '/dashboard/social': 'content',
  '/dashboard/social/queue': 'content',
  '/dashboard/social/calendar': 'content',
  '/dashboard/social/inbox': 'content',
  '/dashboard/social/performance': 'content',
  '/dashboard/social/ads': 'ads',
  '/dashboard/social/sales': 'sales',
  '/dashboard/social/accounts': 'any',
  '/dashboard/social/employees': 'any',
  '/dashboard/social/automation': 'any',
  '/dashboard/social/billing': 'any',
};

const SECTIONS = [
  { key: 'app', label: 'Manage app', home: '/dashboard', nav: APP_NAV },
  { key: 'social', label: 'Manage social', home: '/dashboard/social', nav: SOCIAL_NAV },
] as const;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { initializing, user, isAdmin, workspaceId, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!initializing && !user) router.replace('/login');
  }, [initializing, user, router]);

  if (initializing) return <Center>Loading…</Center>;
  if (!user) return <Center>Redirecting…</Center>;
  if (!isAdmin && !workspaceId) {
    return (
      <Center>
        <div style={{ display: 'grid', gap: 12, textAlign: 'center' }}>
          <strong style={{ color: colors.danger }}>Not authorized</strong>
          <span style={{ color: colors.muted, fontSize: 14 }}>
            This account is not an admin and has no Velocity Studio workspace.
          </span>
          <Link href="/studio/start" style={{ color: colors.secondary, fontWeight: 800 }}>
            Start Velocity Studio →
          </Link>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Center>
    );
  }
  return (
    <WorkspaceProvider>
      {workspaceId ? (
        <StudioShell email={user.email} signOut={signOut}>
          {children}
        </StudioShell>
      ) : (
        <AdminShell email={user.email} signOut={signOut}>
          {children}
        </AdminShell>
      )}
    </WorkspaceProvider>
  );
}

interface ShellProps {
  email: string | null;
  signOut: () => void;
  children: React.ReactNode;
}

/** Velocity's own console: both sections, plus the Studio customers desk. */
function AdminShell({ email, signOut, children }: ShellProps) {
  const pathname = usePathname();

  // The URL decides which section is open, so deep links and refreshes agree.
  const section = pathname.startsWith('/dashboard/social') ? SECTIONS[1] : SECTIONS[0];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={asideStyle}>
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <VelocityIcon size={32} />
          <strong>Velocity Rides</strong>
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
          {(section.key === 'social' ? [...section.nav, STUDIO_ADMIN_NAV] : section.nav).map((group) => (
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
          <div style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>{email}</div>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 28, overflow: 'auto', minWidth: 0 }}>{children}</main>
    </div>
  );
}

/**
 * A Velocity Studio customer's console: only the social desk, only what their
 * plan includes, and a line at the top while the trial runs or after it ends.
 * The server refuses anything outside the plan; this only keeps it out of sight.
 */
function StudioShell({ email, signOut, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { ws, includes } = useWorkspace();
  const home = ws && !includes('content') ? '/dashboard/social/ads' : '/dashboard/social';

  // Customers have no business outside the social desk, nor on its admin pages.
  const misplaced =
    !pathname.startsWith('/dashboard/social') ||
    pathname === '/dashboard/social/studio-customers' ||
    (pathname === '/dashboard/social' && home !== pathname);
  useEffect(() => {
    if (ws && misplaced) router.replace(home);
  }, [ws, misplaced, home, router]);

  // The wall clock is subscribed to, not read during render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const read = () => setNowMs(Date.now());
    const first = setTimeout(read, 0);
    const every = setInterval(read, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  if (!ws) return <Center>Loading your workspace…</Center>;

  const need = NEED_OF[pathname] ?? 'any';
  const nav = [
    ...SOCIAL_NAV.map((g) => ({ ...g, items: g.items.filter((i) => includes(NEED_OF[i.href] ?? 'any')) })),
    { title: 'Account', items: [{ href: '/dashboard/social/billing', label: '💳 Plan & billing' }] },
  ].filter((g) => g.items.length);

  const hoursLeft = Math.max(1, Math.ceil((ws.trialEndsAtMs - nowMs) / 3600_000));
  const trial = nowMs > 0 && ws.paidUntilMs <= nowMs && ws.trialEndsAtMs > nowMs;
  const over = nowMs > 0 && Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs;
  const what = need === 'ads' ? 'The Meta Ad Expert' : need === 'sales' ? 'The sales agent' : 'The content team';

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={asideStyle}>
        <Link href={home} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <VelocityIcon size={32} />
          <strong>Velocity Studio</strong>
        </Link>
        <div style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
          {ws.name} · {STUDIO_PLANS[ws.plan].name} plan
        </div>
        <nav style={{ display: 'grid', gap: 2, marginTop: 8 }}>
          {nav.map((group) => (
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
          <div style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>{email}</div>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 28, overflow: 'auto', minWidth: 0 }}>
        {trial ? (
          <Banner tone="info" href="/dashboard/social/billing" cta="Choose a plan">
            Free trial — {hoursLeft} hour{hoursLeft === 1 ? '' : 's'} left. Pay before it ends and nothing stops.
          </Banner>
        ) : null}
        {over && pathname !== '/dashboard/social/billing' ? (
          <Banner tone="stop" href="/dashboard/social/billing" cta="Pay now">
            {ws.paidUntilMs ? 'Your plan has run out.' : 'Your free day is over.'} The team is paused until a payment is
            approved.
          </Banner>
        ) : null}
        {includes(need) ? (
          children
        ) : (
          <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center', display: 'grid', gap: 12 }}>
            <strong style={{ fontSize: 18 }}>Not in your {STUDIO_PLANS[ws.plan].name} plan</strong>
            <span style={{ color: colors.muted, fontSize: 14, lineHeight: 1.6 }}>
              {what} comes with {need === 'ads' ? 'the Meta Ad Expert and Everything plans' : 'the Everything plan'}.
            </span>
            <Link href="/dashboard/social/billing" style={{ color: colors.secondary, fontWeight: 800 }}>
              Upgrade on Plan &amp; billing →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function Banner({
  tone,
  href,
  cta,
  children,
}: {
  tone: 'info' | 'stop';
  href: string;
  cta: string;
  children: React.ReactNode;
}) {
  const c = tone === 'stop' ? colors.danger : colors.primary;
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '10px 14px',
        marginBottom: 16,
        borderRadius: 12,
        border: `1px solid ${c}3d`,
        background: `${c}0d`,
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      <span style={{ flex: 1, minWidth: 200 }}>{children}</span>
      <Link href={href} style={{ fontWeight: 800, color: c }}>
        {cta} →
      </Link>
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
