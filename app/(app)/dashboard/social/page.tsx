'use client';

/**
 * Manage social → Dashboard.
 *
 * A glance, not a read: tell the brain what you want and it sends the work to
 * the right agent, wired into the Approval box that decides how it goes out;
 * then the numbers, how the ads are running and how the sales agents are
 * doing. Everything the team made lives on the content page with the calendar;
 * each section here links to its own page for the detail.
 *
 * Kept from the page before it, because each is load-bearing:
 *  - **asked once**: should the desk ask before posting? (`autoPublish`) — now
 *    the Approval box, which says "Choose one" until it is answered
 *  - **one box** for everything the desk makes, posts and ads alike — the brain
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import {
  socialApi,
  type AdCampaignDoc,
  type AdsConfigDoc,
  type SalesLeadDoc,
  type SalesSettingsDoc,
  type SocialAccountDoc,
  type SocialEmployee,
  type SocialFormat,
  type SocialPageRead,
  type SocialPostDoc,
  type SocialReadiness,
  type SocialSettings,
} from '@/lib/api';
import { PLATFORM_META, longDate } from '@/components/social/shared';
import { Blockers, readBlockers } from '@/components/social/blockers';
import { LaunchSequence, localHourLabel } from '@/components/social/launch';
import { AdsSection, ApprovalBox, Hero, KpiTile, SalesSection, readDesk } from '@/components/social/dashboard';
import { BRAIN_CSS, Brain } from '@/components/social/brain';
import { AreaSpark, FX_CSS } from '@/components/social/fx';
import { compact } from '@/components/charts';

/** Every switch the daily run needs; pausing touches `enabled` and nothing else — a stop, not a reset. */
const RUN_ON: Partial<SocialSettings> = {
  enabled: true,
  dailyStory: true,
  autoRenderVideo: true,
  learnFromOwnPage: true,
  engagementEnabled: true,
};

/** The backend's defaults for what the Brain and the Approval box read, so they draw before the callable answers. */
const FIRST_PAINT = {
  enabled: false,
  runHour: 10,
  postsPerDay: 1,
  makeAheadDays: 0,
  dailyStory: true,
  autoPublish: false,
  publishModeChosen: false,
} as SocialSettings;

export default function SocialOverview() {
  const { path, house, includes } = useWorkspace();
  const [accounts, setAccounts] = useState<SocialAccountDoc[]>([]);
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [readiness, setReadiness] = useState<SocialReadiness | null>(null);
  const [staff, setStaff] = useState<SocialEmployee[]>([]);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [ads, setAds] = useState<AdsConfigDoc | null>(null);
  const [campaigns, setCampaigns] = useState<AdCampaignDoc[]>([]);
  const [sales, setSales] = useState<SalesSettingsDoc | null>(null);
  const [leads, setLeads] = useState<SalesLeadDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [pageRead, setPageRead] = useState<SocialPageRead | null>(null);
  const [want, setWant] = useState<SocialFormat>('reel');
  // Held here so "Make one like this" on the content page can fill the box.
  const [brief, setBrief] = useState('');
  const [refLink, setRefLink] = useState('');
  const { user } = useAuth();
  const showAds = includes('ads');
  const showSales = includes('sales');

  useEffect(
    () =>
      onSnapshot(
        collection(db, path('socialAccounts')),
        (snap) =>
          setAccounts(
            snap.docs.map((d) => ({
              ...(d.data() as SocialAccountDoc),
              platform: d.id as SocialAccountDoc['platform'],
            })),
          ),
        (e) => setError(e.message),
      ),
    [path],
  );

  useEffect(
    () =>
      onSnapshot(
        collection(db, path('socialEmployees')),
        (snap) =>
          setStaff(
            snap.docs
              .map((d) => ({ ...(d.data() as SocialEmployee), id: d.id }))
              .sort((a, b) => a.hiredAtMs - b.hiredAtMs),
          ),
        (e) => setError(e.message),
      ),
    [path],
  );

  useEffect(
    () =>
      onSnapshot(
        // Two weeks at a few pieces a day, on top of up to a month made ahead —
        // which sorts first by date and would otherwise push this week out.
        query(collection(db, path('socialPosts')), orderBy('date', 'desc'), limit(80)),
        (snap) => setPosts(snap.docs.map((d) => ({ ...(d.data() as SocialPostDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [path],
  );

  useEffect(
    () =>
      onSnapshot(
        doc(db, path('socialInsights/latest')),
        (snap) => setPageRead(snap.exists() ? (snap.data() as SocialPageRead) : null),
        () => setPageRead(null),
      ),
    [path],
  );

  useEffect(
    () =>
      onSnapshot(
        doc(db, path('system/socialAds')),
        (snap) => setAds(snap.exists() ? (snap.data() as AdsConfigDoc) : null),
        () => setAds(null),
      ),
    [path],
  );

  useEffect(() => {
    if (!showAds) return;
    return onSnapshot(
      query(collection(db, path('socialAds')), limit(50)),
      (snap) => setCampaigns(snap.docs.map((d) => ({ ...(d.data() as AdCampaignDoc), id: d.id }))),
      () => setCampaigns([]),
    );
  }, [path, showAds]);

  useEffect(() => {
    if (!showSales) return;
    const stopSettings = onSnapshot(
      doc(db, path('system/sales')),
      (snap) => {
        const s = snap.data() as SalesSettingsDoc | undefined;
        // Saved before calling agents existed: no `callAgents` field at all.
        setSales(s ? { ...s, callAgents: s.callAgents ?? [] } : null);
      },
      () => setSales(null),
    );
    const stopLeads = onSnapshot(
      query(collection(db, path('salesLeads')), orderBy('createdAtMs', 'desc'), limit(300)),
      (snap) => setLeads(snap.docs.map((d) => ({ ...(d.data() as SalesLeadDoc), id: d.id }))),
      () => setLeads([]),
    );
    return () => {
      stopSettings();
      stopLeads();
    };
  }, [path, showSales]);

  // Settings come through the callable (it also reports which keys exist), but
  // the doc itself is watched so `lastRunStatus` updates without a refresh — and
  // so the Brain draws from it at once instead of waiting out a cold start.
  useEffect(() => {
    socialApi
      .getSettings({})
      .then((r) => {
        setSettings(r.settings);
        setReadiness(r.readiness);
        setCoverage(r.coverage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the automation settings.'));

    return onSnapshot(doc(db, path('system/socialAutomation')), (snap) => {
      const stored = (snap.data() ?? {}) as Partial<SocialSettings>;
      setSettings((prev) => ({ ...(prev ?? FIRST_PAINT), ...stored }));
    });
  }, [path]);

  // "Make one like this" from the content page arrives as ?like=<url>&title=<title>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const like = params.get('like');
    if (!like) return;
    const t = setTimeout(() => {
      setWant('reel');
      setRefLink(like);
      setBrief((b) => b || `Our own version of: ${params.get('title') ?? 'this video'}`);
      document.getElementById('make')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const onShift = staff.filter((e) => e.status === 'active');
  const connected = accounts.filter((a) => a.status === 'connected');
  const broken = accounts.filter((a) => a.status === 'error');

  const blockers = useMemo(
    () => readBlockers(readiness, onShift.length, connected.length, broken.length),
    [readiness, onShift.length, connected.length, broken.length],
  );

  // The wall clock is an external system, so it is subscribed to rather than
  // read during render — and the "next run" line then advances on its own.
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

  const nextRun = useMemo(() => {
    if (!settings?.enabled || nowMs === 0) return null;
    // Settings hours are Pakistan hours; PKT is UTC+5 with no daylight saving.
    const nowPkt = new Date(nowMs + 5 * 3600_000);
    const at = new Date(nowPkt);
    at.setUTCMinutes(0, 0, 0);
    at.setUTCHours(settings.runHour);
    const today = at > nowPkt;
    if (!today) at.setUTCDate(at.getUTCDate() + 1);
    return `${today ? 'today' : longDate(at.toISOString().slice(0, 10))}, ${localHourLabel(settings.runHour)}`;
  }, [settings, nowMs]);

  /** Save one or more settings, and say so. */
  async function save(patch: Partial<SocialSettings>, said: (s: SocialSettings, scheduled: number) => string) {
    setSwitching(true);
    setNotice(null);
    setError(null);
    try {
      const res = await socialApi.updateSettings(patch);
      setSettings(res.settings);
      setNotice(said(res.settings, res.scheduled ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSwitching(false);
    }
  }

  /** The Approval box. Posting on its own every day also starts the daily run. */
  const chooseMode = (direct: boolean) =>
    save(direct ? { ...RUN_ON, autoPublish: true, publishModeChosen: true } : { autoPublish: false, publishModeChosen: true }, (s, scheduled) =>
      direct
        ? `Done — every day at ${localHourLabel(s.runHour)} the team makes the pieces and posts them straight away.` +
          (scheduled ? ` ${scheduled} waiting piece${scheduled === 1 ? '' : 's'} now go out on their calendar days.` : '')
        : 'Done — every piece waits for your Approve, and goes out the moment you press it.',
    );

  const setRunning = (on: boolean) =>
    save(on ? RUN_ON : { enabled: false }, (s) =>
      on
        ? `The daily run is on: every day at ${localHourLabel(s.runHour)}${
            s.autoPublish ? ', posted directly.' : ', and everything waits for your Approve.'
          }`
        : 'The daily run is paused. Nothing will be made until you start it again, or ask for something above.',
    );

  const running = Boolean(settings?.enabled);
  const desk = useMemo(() => readDesk(posts, nowMs), [posts, nowMs]);
  const followers = connected.reduce((n, a) => n + (a.followers ?? 0), 0);
  const pktHour = nowMs ? new Date(nowMs + 5 * 3600_000).getUTCHours() : null;
  const greeting =
    pktHour === null ? 'Welcome back' : pktHour < 12 ? 'Good morning' : pktHour < 17 ? 'Good afternoon' : 'Good evening';
  const networks = connected.length
    ? connected.map((a) => PLATFORM_META[a.platform].label.replace(' Page', '')).join(' and ')
    : 'your accounts';
  const summary = [
    desk.postedThisWeek
      ? `The team posted ${desk.postedThisWeek} piece${desk.postedThisWeek === 1 ? '' : 's'} this week`
      : 'Tell the team what to make — or let it post on its own every day',
    desk.waiting.length ? `${desk.waiting.length} waiting for your Approve` : running ? 'nothing waiting on you' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="fx">
      <style>{FX_CSS + BRAIN_CSS}</style>

      <Hero
        greeting={greeting}
        name={user?.displayName?.split(' ')[0] ?? null}
        today={nowMs ? desk.today : null}
        summary={`${summary}.`}
        running={running}
        waiting={desk.waiting.length}
        staff={staff}
        desk={desk}
      />

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}
      {notice ? (
        <p className="fx-rise" style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>
          {notice}
        </p>
      ) : null}

      {/* a Studio workspace's first days: market read → content → posting → funnel → close */}
      {!house ? <LaunchSequence settings={settings} /> : null}

      {/* what is actually stopping it, if anything */}
      {readiness ? <Blockers blockers={blockers} /> : null}

      {settings ? (
        <div id="make" style={{ scrollMarginTop: 16 }}>
          <Brain
            settings={settings}
            accounts={accounts}
            ads={ads}
            want={want}
            onWant={setWant}
            brief={brief}
            onBrief={setBrief}
            refLink={refLink}
            onRefLink={setRefLink}
            disabled={onShift.length === 0}
            onDone={(message) => {
              setError(null);
              setNotice(message);
            }}
            onError={(message) => {
              setNotice(null);
              setError(message);
            }}
          >
            <ApprovalBox
              settings={settings}
              waiting={desk.waiting.length}
              busy={switching}
              noTeam={onShift.length === 0}
              networks={networks}
              nextRun={nextRun}
              coverage={coverage[0] ?? null}
              onChoose={chooseMode}
              onRunning={setRunning}
            />
          </Brain>
        </div>
      ) : (
        <div className="fx-skel" style={{ height: 460, borderRadius: 28, marginBottom: 18 }} />
      )}

      <div className="fx-grid-kpi">
        <KpiTile
          i={3}
          icon="📤"
          tint="#e3f4ea"
          label="Posted this week"
          value={desk.postedThisWeek}
          delta={nowMs ? desk.postedThisWeek - desk.postedLastWeek : null}
          hint="vs last week"
          href="/dashboard/social/queue"
        >
          <AreaSpark values={desk.perDay} height={34} />
        </KpiTile>
        <KpiTile
          i={4}
          icon="👥"
          tint="#e6eefc"
          label="Followers"
          value={followers || null}
          format={(n) => compact(Math.round(n))}
          hint={
            connected.length
              ? connected.map((a) => PLATFORM_META[a.platform].label.split(' ')[0]).join(' + ')
              : 'No account connected'
          }
          href="/dashboard/social/accounts"
        />
        <KpiTile
          i={5}
          icon="👁"
          tint="#fde8ea"
          label="Usual reach per post"
          value={pageRead?.medianReach || null}
          format={(n) => compact(Math.round(n))}
          hint={pageRead?.medianReach ? 'From your own page' : 'Shows after the first posts'}
          href="/dashboard/social/performance"
        />
        <KpiTile
          i={6}
          icon="🔔"
          tint={desk.waiting.length ? '#fff1c7' : '#eef2ef'}
          label="Waiting for you"
          value={desk.waiting.length}
          hint={desk.waiting.length ? 'Open them and press Approve' : 'All clear'}
          href="/dashboard/social/queue"
        />
      </div>

      {showAds || showSales ? (
        <div className={`fx-grid-split${showAds && showSales ? '' : ' one'}`}>
          {showAds ? <AdsSection ads={ads} campaigns={campaigns} nowMs={nowMs} house={house} i={7} /> : null}
          {showSales ? <SalesSection sales={sales} leads={leads} nowMs={nowMs} i={8} /> : null}
        </div>
      ) : null}

      <p className="fx-muted" style={{ fontSize: 12.5, textAlign: 'center', margin: '4px 0 0' }}>
        Everything the team made, and the month ahead, is on{' '}
        <Link href="/dashboard/social/queue" style={{ color: colors.secondary, fontWeight: 800 }}>
          Content &amp; calendar
        </Link>
        .
      </p>
    </div>
  );
}
