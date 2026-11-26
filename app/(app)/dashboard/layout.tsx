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
 * Velocity, grouped by the job you came here to do. **Manage social** is Vexa:
 * the accounts and the daily content pipeline that posts to them. The switcher
 * is driven by the URL, so a link into either section lands with the right
 * section open and a refresh keeps it.
 *
 * Vexa's half is grouped by *department*, not by page (owner, 2026-11-15). A
 * person who has just bought this does not want a list of eleven tools; they
 * want to know which part of the screen is making their content, which part is
 * spending their ad money, and which part is talking to customers and closing
 * them. Each group says that in one line, and `Sidebar` draws it.
 *
 * The help button at the bottom right and the guided tour are mounted here, so
 * they are on every page of the console rather than on the one page somebody
 * remembered to put them.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

import { useAuth } from '@/lib/auth';
import { SUPPORT_EMAIL } from '@/lib/site';
import { STUDIO_PLAN_IDS, STUDIO_PLANS, planIncludes, type StudioNeed, type StudioNeeds } from '@/lib/studio';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import { useDeskStatus } from '@/lib/deskStatus';
import { Button, glass } from '@/components/ui';
import { VelocityIcon } from '@/components/BrandMark';
import { Sidebar, type SideGroup } from '@/components/social/sidebar';
import { HelpLauncher, Tour, type TourStep } from '@/components/social/tour';
import { SetupGuide, type GuideKey } from '@/components/social/setupGuide';

type NavGroup = SideGroup;

/** The accent each Vexa department takes: its icons, its highlight, its heading. */
const TINT = {
  content: '#0058bb',
  ads: '#b45309',
  sales: '#11794c',
  research: '#7c3aed',
  setup: '#004c31',
  account: '#6f7a72',
} as const;

/** Everything about running the platform, grouped by the job at hand. */
const APP_NAV: NavGroup[] = [
  {
    title: '',
    items: [{ href: '/dashboard', label: 'Overview', icon: 'analytics' }],
  },
  {
    title: 'People',
    items: [
      { href: '/dashboard/drivers', label: 'Driver approvals', icon: 'people' },
      { href: '/dashboard/cnic', label: 'CNIC verification', icon: 'shield' },
      { href: '/dashboard/passengers', label: 'Passengers', icon: 'people' },
      { href: '/dashboard/disputes', label: 'Disputes', icon: 'shield' },
      { href: '/dashboard/safety', label: 'Safety desk', icon: 'shield' },
      { href: '/dashboard/support', label: 'Rapid Response', icon: 'comments' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/dashboard/live-ops', label: 'Live ops map', icon: 'map' },
      // Live ops is the rides happening now; this is every ride that ever did.
      // Next to each other because an operator moves between the two mid-call.
      { href: '/dashboard/rides', label: 'Ride record', icon: 'content' },
      { href: '/dashboard/locations', label: 'Locations', icon: 'map' },
      { href: '/dashboard/travel-areas', label: 'Travel demand', icon: 'map' },
      { href: '/dashboard/whatsapp-leads', label: 'WhatsApp demand', icon: 'whatsapp' },
      { href: '/dashboard/ride-settings', label: 'Ride settings', icon: 'settings' },
      { href: '/dashboard/pooling', label: 'Ride pooling', icon: 'funnel' },
      { href: '/dashboard/pricing', label: 'Pricing engine', icon: 'money' },
      { href: '/dashboard/market-rates', label: 'Market rates', icon: 'analytics' },
      { href: '/dashboard/special-rides', label: 'Rent a car', icon: 'map' },
      { href: '/dashboard/travel-mate', label: 'Travel Partner', icon: 'people' },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/dashboard/payouts', label: 'Payouts', icon: 'money' },
      { href: '/dashboard/commission', label: 'Commission', icon: 'money' },
      { href: '/dashboard/settlements', label: 'Settlements', icon: 'money' },
      { href: '/dashboard/manual-topups', label: 'Balance top-ups', icon: 'money' },
      { href: '/dashboard/receiving-accounts', label: 'Receiving accounts', icon: 'money' },
      { href: '/dashboard/cancellations', label: 'Cancellation fees', icon: 'shield' },
    ],
  },
  {
    title: 'Growth',
    items: [
      { href: '/dashboard/partners', label: 'Partner Program', icon: 'people' },
      { href: '/dashboard/ambassadors', label: 'Ambassadors', icon: 'people' },
      { href: '/dashboard/fleet-submissions', label: 'Fleet submissions', icon: 'content' },
      { href: '/dashboard/advertise', label: 'Advertise', icon: 'ads' },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/dashboard/features', label: 'Feature flags', icon: 'tools' },
      { href: '/dashboard/testing', label: 'Testing', icon: 'tools' },
      { href: '/dashboard/app-version', label: 'App version', icon: 'tools' },
      { href: '/dashboard/website', label: 'Website', icon: 'map' },
      { href: '/dashboard/costs', label: 'Cost of Velocity Rides', icon: 'money' },
    ],
  },
];

/**
 * Vexa, grouped by department rather than by page.
 *
 * The order is the order the money moves in: you make something, you pay to put
 * it in front of people, somebody answers, you sell to them. Research sits
 * after those because it feeds all three. Everything you only ever touch once
 * is last, where it belongs.
 *
 * The caption on each group is the whole point of the regrouping — it is the
 * sentence a person needs to be able to say about their own business.
 */
const SOCIAL_NAV: NavGroup[] = [
  {
    title: '',
    items: [{ href: '/dashboard/social', label: 'Home', icon: 'home' }],
  },
  {
    title: 'Content',
    caption: 'Everything that goes out in your name.',
    tint: TINT.content,
    items: [
      { href: '/dashboard/social/queue', label: 'Content & calendar', icon: 'content', also: ['/dashboard/social/calendar'] },
      { href: '/dashboard/social/inbox', label: 'Comments', icon: 'comments' },
      { href: '/dashboard/social/performance', label: 'Analytics', icon: 'analytics' },
    ],
  },
  {
    title: 'Ads',
    caption: 'Your money buying reach, on Meta and Google.',
    tint: TINT.ads,
    items: [{ href: '/dashboard/social/ads', label: 'Meta & Google Ad Expert', icon: 'ads' }],
  },
  {
    title: 'Sales',
    caption: 'Vexa talking to people, and closing them.',
    tint: TINT.sales,
    items: [
      { href: '/dashboard/social/whatsapp', label: 'WhatsApp sales', icon: 'whatsapp' },
      { href: '/dashboard/social/email', label: 'Email agent', icon: 'email' },
      { href: '/dashboard/social/sales', label: 'Finding customers', icon: 'calls' },
    ],
  },
  {
    title: 'Research',
    caption: 'What your market and your competitors are doing.',
    tint: TINT.research,
    items: [
      { href: '/dashboard/social/research', label: 'Research Assistant', icon: 'research' },
      // Reads the customer's own site and tells their developer what to add.
      { href: '/dashboard/social/seo', label: 'SEO', icon: 'seo' },
    ],
  },
  {
    title: 'Set up once',
    caption: 'Connect it, then forget it.',
    tint: TINT.setup,
    items: [
      { href: '/dashboard/social/accounts', label: 'Connected accounts', icon: 'plug' },
      { href: '/dashboard/social/employees', label: 'Your AI team', icon: 'agents' },
      { href: '/dashboard/social/automation', label: 'Settings', icon: 'settings' },
    ],
  },
];

/** Admins only: everyone on Velocity Studio, the payments our AI has read, the sign-up mailbox, agent billing and AI spend. */
const STUDIO_ADMIN_NAV: NavGroup = {
  title: 'Vexa (Velocity only)',
  caption: 'The customers who bought Vexa, and what it costs us to run.',
  tint: TINT.account,
  items: [
    { href: '/dashboard/social/studio-customers', label: 'Users', icon: 'people' },
    { href: '/dashboard/social/studio-payments', label: 'Payments · AI checked', icon: 'money' },
    { href: '/dashboard/social/studio-email', label: 'Sign-up email', icon: 'email' },
    { href: '/dashboard/social/agents-billing', label: 'AI agents & billing', icon: 'calls' },
    { href: '/dashboard/social/ai-usage', label: 'AI keys & usage', icon: 'usage' },
  ],
};

/**
 * Every page a customer may open, and the plan part it belongs to; a customer
 * sees only what theirs includes. A page missing here (Velocity's own admin
 * pages, anything new) is not theirs at all. The AI agents and the settings
 * are the content team's tools. Analytics is the content team's and the
 * Research Assistant's both. Connected accounts holds both the posting
 * networks and the Ad Expert's ad accounts, so every plan opens it and the
 * page shows each plan only its own cards.
 */
const NEED_OF: Record<string, StudioNeeds> = {
  '/dashboard/social': 'content',
  '/dashboard/social/queue': 'content',
  '/dashboard/social/calendar': 'content',
  '/dashboard/social/inbox': 'content',
  '/dashboard/social/whatsapp': 'sales',
  '/dashboard/social/performance': ['content', 'research'],
  '/dashboard/social/research': 'research',
  '/dashboard/social/accounts': 'any',
  '/dashboard/social/employees': 'content',
  '/dashboard/social/crew': 'content',
  '/dashboard/social/automation': 'content',
  '/dashboard/social/ads': 'ads',
  '/dashboard/social/sales': 'sales',
  '/dashboard/social/email': 'sales',
  '/dashboard/social/billing': 'any',
  '/dashboard/social/upgrade': 'any',
  '/dashboard/social/usage': 'any',
};
const BILLING = '/dashboard/social/billing';
const UPGRADE = '/dashboard/social/upgrade';
const USAGE = '/dashboard/social/usage';
/** What a customer can still open with nothing paid for: the ways to pay. */
const ACCOUNT_PAGES = [UPGRADE, BILLING, USAGE];
const ACCOUNT_NAV: NavGroup = {
  title: 'Account',
  caption: 'What you pay, and what you have used.',
  tint: TINT.account,
  items: [
    { href: UPGRADE, label: 'Plans & upgrade', icon: 'plan', also: [BILLING] },
    { href: USAGE, label: 'Usage & credits', icon: 'usage' },
  ],
};

/** Who does each part, as the "Not in your plan" note names them. */
const WHO: Partial<Record<StudioNeed, string>> = {
  research: 'The Research Assistant',
  content: 'The content team',
  ads: 'The Meta & Google Ad Expert',
  sales: 'The sales, calling and email agents',
};

const SECTIONS = [
  { key: 'app', label: 'Manage app', home: '/dashboard', nav: APP_NAV },
  { key: 'social', label: 'Manage social', home: '/dashboard/social', nav: SOCIAL_NAV },
] as const;

/**
 * The guided tour of Vexa, in the order a business actually works: here is
 * where you ask for something, here is what goes out, here is what your ad
 * money is doing, here is the part that talks to customers and sells to them,
 * and here is where you plug your accounts in.
 *
 * Every step is written to be *said*, because it is — short sentences, no
 * punctuation a voice cannot read, no "click the button in the top right".
 * A step whose target is not on the page (a plan without ads, a card with no
 * data yet) is passed over by `Tour` without a word.
 */
const VEXA_TOUR: TourStep[] = [
  {
    // The tour opens on the one thing the dashboard now is, so there is
    // something lit up from the very first card. A tour that opens on a dimmed
    // screen with nothing pointed at reads as a mistake (owner, 2026-11-15).
    target: 'area-brain',
    title: 'This is Vexa',
    say: 'Think of it as a small marketing team that works for you all day, and this is how you talk to it. Type what you want in plain words. Make a reel about our weekend offer. Email everyone about Eid. It works out which part of the team should do it, and sends the job there. Let me show you the rest. It takes about a minute.',
    goto: '/dashboard/social',
  },
  {
    target: 'approval',
    title: 'Who presses send',
    say: 'This is the one decision that matters. Either every piece waits for you to approve it, or Vexa posts on its own every day. Start by approving them yourself. When you trust what it writes, switch it over.',
  },
  {
    target: 'nav',
    title: 'Everything else is in here',
    say: 'The dashboard is only the asking. The rest of the business is this menu, grouped the way you think about it: Content is what goes out, Ads is your money buying reach, Sales is Vexa talking to people and closing them, then Research and the things you set up once. The number on a row is what is waiting there — pieces to approve, comments nobody has answered, campaigns running. Underneath, it says what she is doing this minute.',
  },
  {
    target: 'accounts-list',
    title: 'Plug in your accounts',
    say: 'Nothing can go out until your accounts are connected. Press Connect, sign in, and you are done. If you get stuck, every one of them has step by step instructions next to the button.',
    goto: '/dashboard/social/accounts',
  },
  {
    target: 'help',
    title: 'That is the whole thing',
    say: 'This button is always here, at the bottom of every page. Press it to take this tour again, or to get the setting up instructions for any account. Good luck.',
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { initializing, user, isAdmin, workspaceId, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // The social desk is where Studio customers live, so a signed-out visit there goes to their own log-in.
  const loginPage = pathname.startsWith('/dashboard/social') ? '/studio/login' : '/login';
  useEffect(() => {
    if (!initializing && !user) router.replace(loginPage);
  }, [initializing, user, router, loginPage]);

  if (initializing) return <Center>Loading…</Center>;
  if (!user) return <Center>Redirecting…</Center>;
  if (!isAdmin && !workspaceId) {
    return (
      <Center>
        <div style={{ display: 'grid', gap: 12, textAlign: 'center' }}>
          <strong style={{ color: colors.danger }}>Not authorized</strong>
          <span style={{ color: colors.muted, fontSize: 14 }}>
            This account is not an admin and has no Vexa workspace.
          </span>
          <Link href="/studio/start" style={{ color: colors.secondary, fontWeight: 800 }}>
            Finish setting up Vexa →
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
        <StudioShell email={user.email} name={user.displayName} signOut={signOut}>
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
  name?: string | null;
  signOut: () => void;
  children: React.ReactNode;
}

/**
 * The help that follows you everywhere: the tour, and the connecting
 * instructions. Mounted by both shells, so it is on every page rather than on
 * whichever page somebody remembered to put it.
 *
 * `admin` decides how much the setup guide says: on Velocity's own console the
 * steps about tokens, app ids and secrets are shown, because somebody here
 * actually has to paste them. A customer never sees a word about a token.
 */
function Help({ admin, offerTour }: { admin: boolean; offerTour: boolean }) {
  const [tour, setTour] = useState(false);
  const [guide, setGuide] = useState<GuideKey | null | false>(false);

  return (
    <>
      <Tour steps={VEXA_TOUR} open={tour} onStart={() => setTour(true)} onClose={() => setTour(false)} autoOffer={offerTour} />
      {guide !== false ? (
        <SetupGuide which={guide} admin={admin} onClose={() => setGuide(false)} onPick={(k) => setGuide(k ?? null)} />
      ) : null}
      <HelpLauncher onTour={() => setTour(true)} onSetup={() => setGuide(null)} />
    </>
  );
}

/** Velocity's own console: both sections, plus the Studio customers desk. */
function AdminShell({ email, signOut, children }: ShellProps) {
  const pathname = usePathname();

  // The URL decides which section is open, so deep links and refreshes agree.
  const section = pathname.startsWith('/dashboard/social') ? SECTIONS[1] : SECTIONS[0];
  const groups = section.key === 'social' ? [...section.nav, STUDIO_ADMIN_NAV] : [...section.nav];

  return (
    <div style={pageStyle}>
      <Sidebar
          groups={groups}
          pathname={pathname}
          storageKey={`nav.${section.key}`}
          brand={
            // The social half is Vexa, the same product a Studio customer logs into, so it is named Vexa here too.
            <Link href={section.home}>
              <VelocityIcon size={30} />
              <span>{section.key === 'social' ? 'Vexa' : 'Velocity Rides'}</span>
            </Link>
          }
          top={
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
          }
          footer={
            <>
              <div style={{ fontSize: 12, color: colors.muted, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {email}
              </div>
              <Button variant="ghost" onClick={signOut}>
                Sign out
              </Button>
            </>
          }
      />
      <main style={{ flex: 1, padding: 28, overflow: 'auto', minWidth: 0 }}>{children}</main>
      {section.key === 'social' ? <Help admin offerTour={false} /> : null}
    </div>
  );
}

/**
 * A Velocity Studio customer's console: only the social desk, only what their
 * plan includes, only while it is paid for, and a line at the top while the
 * trial runs or after it ends. The server refuses anything outside the plan;
 * this keeps it out of sight.
 */
function StudioShell({ email, name, signOut, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { ws, includes } = useWorkspace();
  const status = useDeskStatus();

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

  const over = ws !== null && nowMs > 0 && Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs;
  const credits = ws?.creditDays ?? 0;
  // Nothing paid for right now — the free day over, the plan run out with no credits, or paused by Velocity: only
  // the ways to pay. With credits the desk stays open: its first call puts the day on credit.
  const locked = Boolean(ws?.suspended) || (over && credits < 1);
  const home = locked
    ? UPGRADE
    : !ws || includes('content')
      ? '/dashboard/social'
      : includes('ads')
        ? '/dashboard/social/ads'
        : includes('research')
          ? '/dashboard/social/research'
          : '/dashboard/social/sales';

  // A customer opens only their desk's own pages — never Velocity's admin ones — and only billing while locked.
  const need = NEED_OF[pathname];
  // What the desk last told us about itself. Published by the pages that read
  // it anyway, so the nav costs nothing extra.
  const desk = status;
  const misplaced =
    !need || (locked && !ACCOUNT_PAGES.includes(pathname)) || (pathname === '/dashboard/social' && home !== pathname);
  // Paid for, never described: the workspace is opened the moment the money
  // clears so a Facebook Page can be connected to it, and sign-up carries on
  // afterwards. The desk has no brief to work from until that is finished.
  // Explicitly `null`, never merely missing — every workspace made before
  // 2026-11-14 was described as it was made and has no such field.
  const unfinished = ws?.setupAtMs === null;
  useEffect(() => {
    if (unfinished) router.replace('/studio/start');
    else if (ws && misplaced) router.replace(home);
  }, [ws, unfinished, misplaced, home, router]);

  if (!ws) return <Center>Loading your workspace…</Center>;
  if (unfinished) return <Center>Finishing your sign-up…</Center>;

  /** The overview's numbers, now on the rows they were always about. */
  const countOf: Record<string, { count: number | null; tone?: 'warn' | 'ok' }> = desk
    ? {
        '/dashboard/social/queue': { count: desk.waiting, tone: 'warn' },
        '/dashboard/social/inbox': { count: desk.comments, tone: 'warn' },
        '/dashboard/social/ads': { count: desk.liveAds },
        '/dashboard/social/whatsapp': { count: desk.chats },
      }
    : {};

  const nav = locked
    ? [ACCOUNT_NAV]
    : [
        ...SOCIAL_NAV.map((g) => ({
          ...g,
          // The old Sales agents plan has nothing on Connected accounts: its mailbox is set on the Sales page.
          items: g.items
            .filter(
              (i) =>
                includes(NEED_OF[i.href] ?? 'any') &&
                (i.href !== '/dashboard/social/accounts' || includes(['content', 'ads', 'research'])),
            )
            .map((i) => ({ ...i, ...(countOf[i.href] ?? {}) })),
        })),
        ACCOUNT_NAV,
      ].filter((g) => g.items.length);

  const hoursLeft = Math.max(1, Math.ceil((ws.trialEndsAtMs - nowMs) / 3600_000));
  const trial = nowMs > 0 && ws.paidUntilMs <= nowMs && ws.trialEndsAtMs > nowMs;
  // A page two plans share belongs to neither team alone, so it is named as the page.
  const what = (typeof need === 'string' ? WHO[need] : null) ?? 'This page';
  // The plans on sale that include it, named as the pricing page names them: "the A, the B and the C plans".
  const sold = need ? STUDIO_PLAN_IDS.filter((id) => planIncludes(id, need)).map((id) => `the ${STUDIO_PLANS[id].name}`) : [];
  const soldIn = sold.length > 1 ? `${sold.slice(0, -1).join(', ')} and ${sold[sold.length - 1]} plans` : `${sold[0] ?? 'a paid'} plan`;

  return (
    <div style={pageStyle}>
      <Sidebar
          groups={nav}
          pathname={pathname}
          storageKey="nav.vexa"
          brand={
            <Link href={home}>
              <VelocityIcon size={30} />
              <span>Vexa</span>
            </Link>
          }
          top={
            <div style={{ fontSize: 12, color: colors.muted, margin: '0 0 2px 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ws.name} · {STUDIO_PLANS[ws.plan].name} plan
            </div>
          }
          status={
            desk ? (
              <>
                <span className="t">
                  <span className={`dot${desk.running ? '' : ' off'}`} aria-hidden />
                  {desk.running ? 'Working' : 'Paused'}
                </span>
                <p>
                  {desk.doing ??
                    (desk.running
                      ? desk.nextRun
                        ? `Next run ${desk.nextRun}.`
                        : 'Waiting for the next run.'
                      : 'The daily run is off. Ask for something and she starts.')}
                </p>
                {desk.blockers ? (
                  <Link href="/dashboard/social/accounts">
                    {desk.blockers} thing{desk.blockers === 1 ? '' : 's'} need you →
                  </Link>
                ) : null}
              </>
            ) : null
          }
          footer={
            <AccountMenu
              name={name || ws.name}
              email={email}
              status={`${STUDIO_PLANS[ws.plan].name} · ${ws.suspended ? 'Paused' : trial ? 'Free trial' : over ? (credits ? 'On credit' : 'Run out') : 'Paid'}`}
              signOut={signOut}
            />
          }
      />
      <main style={{ flex: 1, padding: 28, overflow: 'auto', minWidth: 0 }}>
        {ws.suspended ? (
          <Banner tone="stop" href={`mailto:${SUPPORT_EMAIL}`} cta="Email us">
            Velocity has paused this workspace. The team is stopped until it is resumed.
          </Banner>
        ) : null}
        {trial && !ws.suspended ? (
          <Banner tone="info" href={UPGRADE} cta="Choose a plan">
            Free trial — {hoursLeft} hour{hoursLeft === 1 ? '' : 's'} left. Pay before it ends and nothing stops.
          </Banner>
        ) : null}
        {over && !ws.suspended && !credits ? (
          <Banner tone="stop" href={UPGRADE} cta="Pay now">
            {ws.paidUntilMs ? 'Your plan has run out.' : 'Your day is over.'} Pay for a plan or add credits ($1 a day)
            and the desk opens again once the payment is approved.
          </Banner>
        ) : null}
        {over && !ws.suspended && credits ? (
          <Banner tone="info" href={USAGE} cta="See credits">
            {ws.paidUntilMs ? 'Your plan has run out' : 'Your day is over'} — your team carries on with your credits, $1 a
            day ({credits} day{credits === 1 ? '' : 's'} left).
          </Banner>
        ) : null}
        {!need || misplaced ? null : includes(need) ? (
          children
        ) : (
          <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center', display: 'grid', gap: 12 }}>
            <strong style={{ fontSize: 18 }}>Not in your {STUDIO_PLANS[ws.plan].name} plan</strong>
            <span style={{ color: colors.muted, fontSize: 14, lineHeight: 1.6 }}>
              {`${what} ${what.endsWith('agents') ? 'come' : 'comes'} with ${soldIn}.`}
            </span>
            <Link href={UPGRADE} style={{ color: colors.secondary, fontWeight: 800 }}>
              See the plans →
            </Link>
          </div>
        )}
      </main>
      {/* A customer gets the tour offered on their first visit; after that it waits behind the Help button. */}
      <Help admin={false} offerTour={!locked} />
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

/**
 * The customer's own corner of the sidebar: who is signed in and on what, and
 * a menu of the account things — usage, plans, help, log out.
 */
function AccountMenu({ name, email, status, signOut }: { name: string; email: string | null; status: string; signOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const item: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '9px 10px',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    color: colors.text,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  };

  return (
    <div ref={box} style={{ position: 'relative', marginTop: 'auto', paddingTop: 20 }}>
      {open ? (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            ...glass,
            borderRadius: 14,
            boxShadow: `${glass.boxShadow}, 0 18px 40px -12px rgba(4,35,26,0.28)`,
            padding: 6,
            display: 'grid',
            zIndex: 20,
          }}
        >
          <div style={{ padding: '8px 10px', fontSize: 12.5, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
          {[
            { href: USAGE, label: '📊 Usage & credits' },
            { href: UPGRADE, label: '⬆️ Upgrade plan' },
            { href: `${UPGRADE}#credits`, label: '➕ Add credits' },
            { href: `mailto:${SUPPORT_EMAIL}`, label: '❓ Get help' },
          ].map((m) => (
            <Link key={m.href} href={m.href} role="menuitem" style={item} onClick={() => setOpen(false)}>
              {m.label}
            </Link>
          ))}
          <div style={{ height: 1, background: colors.border, margin: '4px 6px' }} />
          <button type="button" role="menuitem" style={item} onClick={signOut}>
            ↪ Log out
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: 8,
          borderRadius: 12,
          border: `1px solid ${open ? colors.border : 'transparent'}`,
          background: open ? colors.bg : 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 34,
            height: 34,
            flex: 'none',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: colors.primary,
            color: '#ccff00',
            fontWeight: 900,
            fontSize: 14,
          }}
        >
          {(name || email || '?').trim().charAt(0).toUpperCase()}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: 13.5, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          <span style={{ display: 'block', fontSize: 12, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {status}
          </span>
        </span>
        <span aria-hidden style={{ color: colors.muted, fontSize: 11 }}>
          ▾
        </span>
      </button>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>{children}</div>;
}

/** Soft colour behind the console, so its glass panels have something to show through. */
const pageStyle: React.CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  background:
    'radial-gradient(circle at 8% 0%, rgba(204,255,0,0.22), transparent 36%),'
    + ' radial-gradient(circle at 100% 25%, rgba(0,88,187,0.10), transparent 40%),'
    + ` radial-gradient(circle at 45% 100%, rgba(4,107,65,0.14), transparent 45%), ${colors.bg}`,
  backgroundAttachment: 'fixed',
};


const switcherStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: 3,
};

