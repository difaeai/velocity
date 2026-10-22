'use client';

/**
 * Manage social → Dashboard.
 *
 * Laid out like the reference the user chose: the numbers across the top, the
 * team in a banner with quick actions, then — in the order a person needs
 * them — what to make, what is ready for you, who is doing what, the week, and
 * on the right what just happened and what worked.
 *
 * Kept from the page before it, because each is load-bearing:
 *  - **asked once**: should the desk ask before posting? (`autoPublish`)
 *  - **one box** for everything the desk makes, posts and ads alike
 *  - the desk switch, and the line a piece travels (components/social/pipeline.tsx,
 *    where motion only means something real is moving)
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, onSnapshot, orderBy, query, limit } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import {
  adsApi,
  socialApi,
  type AdsConfigDoc,
  type SocialAccountDoc,
  type SocialEmployee,
  type SocialFormat,
  type SocialPageRead,
  type SocialPostDoc,
  type SocialReadiness,
  type SocialSettings,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import {
  FORMAT_META,
  PlatformBadge,
  PLATFORM_META,
  StatusPill,
  longDate,
} from '@/components/social/shared';
import { Blockers, Pipeline, readBlockers, readPipeline } from '@/components/social/pipeline';
import { adMoney } from '@/components/social/ads';
import {
  AgentGrid,
  DASH_CSS,
  Hero,
  Kpi,
  MadeChart,
  ReadyForYou,
  RecentActivity,
  TopContent,
  WeekStrip,
  readDesk,
  type QuickAction,
} from '@/components/social/dashboard';
import { compact } from '@/components/charts';

// shortcut: one workspace until tenancy lands; read the name from the tenant doc then.
const WORKSPACE = 'Velocity Rides';

type Want = SocialFormat | 'ad';
const WANTS: Want[] = ['reel', 'post', 'story', 'carousel', 'ad'];

const PLACEHOLDER: Record<Want, string> = {
  reel: 'e.g. a reel for riders in Lahore: you name your own fare, no surge at night',
  post: 'e.g. a post about paying in cash — most of Pakistan still does',
  story: 'e.g. a story telling drivers the weekend is the busiest time',
  carousel: 'e.g. five slides: how a shared ride splits the fare per seat',
  video: 'e.g. a 30-second explainer of how bidding works',
  ad: 'e.g. get new drivers in Lahore and Karachi to download the app this week',
};

export default function SocialOverview() {
  const [accounts, setAccounts] = useState<SocialAccountDoc[]>([]);
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [readiness, setReadiness] = useState<SocialReadiness | null>(null);
  const [staff, setStaff] = useState<SocialEmployee[]>([]);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [ads, setAds] = useState<AdsConfigDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [pageRead, setPageRead] = useState<SocialPageRead | null>(null);
  const [want, setWant] = useState<Want>('reel');
  const { user } = useAuth();

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'socialAccounts'),
        (snap) =>
          setAccounts(
            snap.docs.map((d) => ({
              ...(d.data() as SocialAccountDoc),
              platform: d.id as SocialAccountDoc['platform'],
            })),
          ),
        (e) => setError(e.message),
      ),
    [],
  );

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'socialEmployees'),
        (snap) =>
          setStaff(
            snap.docs
              .map((d) => ({ ...(d.data() as SocialEmployee), id: d.id }))
              .sort((a, b) => a.hiredAtMs - b.hiredAtMs),
          ),
        (e) => setError(e.message),
      ),
    [],
  );

  useEffect(
    () =>
      onSnapshot(
        // Two weeks at a few pieces a day: enough for the week strip and the chart.
        query(collection(db, 'socialPosts'), orderBy('date', 'desc'), limit(40)),
        (snap) => setPosts(snap.docs.map((d) => ({ ...(d.data() as SocialPostDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [],
  );

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'socialInsights/latest'),
        (snap) => setPageRead(snap.exists() ? (snap.data() as SocialPageRead) : null),
        () => setPageRead(null),
      ),
    [],
  );

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'system', 'socialAds'),
        (snap) => setAds(snap.exists() ? (snap.data() as AdsConfigDoc) : null),
        () => setAds(null),
      ),
    [],
  );

  // Settings come through the callable (it also reports which keys exist), but
  // the doc itself is watched so `lastRunStatus` updates without a refresh.
  useEffect(() => {
    socialApi
      .getSettings({})
      .then((r) => {
        setSettings(r.settings);
        setReadiness(r.readiness);
        setCoverage(r.coverage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the automation settings.'));

    return onSnapshot(doc(db, 'system', 'socialAutomation'), (snap) => {
      if (snap.exists()) setSettings((prev) => (prev ? { ...prev, ...(snap.data() as Partial<SocialSettings>) } : prev));
    });
  }, []);

  const onShift = staff.filter((e) => e.status === 'active');
  const connected = accounts.filter((a) => a.status === 'connected');
  const broken = accounts.filter((a) => a.status === 'error');

  const pipeline = useMemo(
    () => readPipeline(posts, accounts, settings, onShift.length),
    [posts, accounts, settings, onShift.length],
  );
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
    return { at, today };
  }, [settings, nowMs]);

  /** The desk has been round the loop at least once: stop explaining it. */
  const taught = Boolean(settings?.lastRunAtMs) || posts.length > 0;

  /** Save one or more settings, and say so. */
  async function save(patch: Partial<SocialSettings>, said: (s: SocialSettings) => string) {
    setSwitching(true);
    setNotice(null);
    setError(null);
    try {
      const res = await socialApi.updateSettings(patch);
      setSettings(res.settings);
      setNotice(said(res.settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSwitching(false);
    }
  }

  const chooseMode = (direct: boolean) =>
    save({ autoPublish: direct, publishModeChosen: true }, () =>
      direct
        ? 'Done — finished pieces go straight out. Change it any time on this page.'
        : 'Done — every piece waits for your Approve, and goes out the moment you press it.',
    );

  /**
   * Start or pause the whole desk in one call. Starting writes every switch the
   * daily run needs; pausing touches `enabled` and nothing else — a stop, not a
   * reset.
   */
  const setRunning = (on: boolean) =>
    save(
      on
        ? { enabled: true, dailyStory: true, autoRenderVideo: true, learnFromOwnPage: true, engagementEnabled: true }
        : { enabled: false },
      (s) =>
        on
          ? `The desk is on. It works every day at ${hour(s.runHour)} PKT${
              s.autoPublish ? ' and posts what it makes directly.' : ', and everything it makes waits for your Approve.'
            }`
          : 'The desk is paused. Nothing will be made until you start it again, or ask for something above.',
    );

  const running = Boolean(settings?.enabled);
  const desk = useMemo(() => readDesk(posts, nowMs), [posts, nowMs]);
  const followers = connected.reduce((n, a) => n + (a.followers ?? 0), 0);
  const pktHour = nowMs ? new Date(nowMs + 5 * 3600_000).getUTCHours() : null;
  const greeting =
    pktHour === null ? 'Welcome back' : pktHour < 12 ? 'Good morning' : pktHour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.displayName?.split(' ')[0];

  /** A quick action picks the kind and puts the cursor in the box. */
  const make = (what: QuickAction) => {
    setWant(what);
    document.getElementById('make')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.getElementById('make-brief')?.focus({ preventScroll: true }), 350);
  };

  return (
    <div>
      <style>{DASH_CSS}</style>

      <header style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 4px' }}>
            {greeting}
            {firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p style={{ color: colors.muted, margin: 0 }}>Here is what your social media team is doing today.</p>
        </div>
        {desk.waiting.length ? (
          <Link
            href="/dashboard/social/queue"
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: '#8a6100',
              background: '#fab2192e',
              borderRadius: 999,
              padding: '7px 13px',
            }}
          >
            🔔 {desk.waiting.length} waiting for you
          </Link>
        ) : null}
        {nowMs ? (
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              borderRadius: 10,
              padding: '7px 12px',
            }}
          >
            📅 {longDate(desk.today)}
          </span>
        ) : null}
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, marginBottom: 14 }}>{notice}</p> : null}

      {/* what is actually stopping it, if anything */}
      {readiness ? <Blockers blockers={blockers} /> : null}

      {/* asked once: ask first, or post directly? */}
      {settings && !settings.publishModeChosen ? (
        <Card style={{ marginBottom: 16, borderColor: `${colors.primary}66` }}>
          <h2 style={h2}>Before anything goes out: should the desk ask you first?</h2>
          <p style={{ fontSize: 13.5, color: colors.muted, margin: '0 0 14px', lineHeight: 1.55 }}>
            Asked once. Either way you can change it later from the desk card.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            <Choice
              title="Ask me before posting"
              detail="Everything waits in the queue. Press Approve & post and it goes out straight away."
              onClick={() => chooseMode(false)}
              disabled={switching}
            />
            <Choice
              title="Post directly — don't ask me"
              detail="A finished piece goes straight to Instagram and Facebook. You can still delete it afterwards."
              onClick={() => chooseMode(true)}
              disabled={switching}
            />
          </div>
        </Card>
      ) : null}

      <div className="sd-kpis">
        <Kpi
          icon="📤"
          tint="#e3f4ea"
          label="Posted this week"
          value={String(desk.postedThisWeek)}
          delta={desk.postedThisWeek - desk.postedLastWeek}
          hint="vs last week"
        />
        <Kpi
          icon="👥"
          tint="#e6eefc"
          label="Followers"
          value={followers ? compact(followers) : '—'}
          hint={
            connected.length
              ? connected.map((a) => PLATFORM_META[a.platform].label.split(' ')[0]).join(' + ')
              : 'No account connected'
          }
        />
        <Kpi
          icon="👁"
          tint="#fde8ea"
          label="Usual reach per post"
          value={pageRead?.medianReach ? compact(pageRead.medianReach) : '—'}
          hint={pageRead?.medianReach ? 'From your own page' : 'Shows after the first posts'}
        />
        <Kpi
          icon="🤖"
          tint="#eafbd0"
          label="AI agents on duty"
          value={`${onShift.length} / ${staff.length}`}
          hint={running ? 'Working every day' : 'Paused'}
        />
      </div>

      <div className="sd-grid">
        <div className="sd-col">
          <Hero workspace={WORKSPACE} waiting={desk.waiting.length} onMake={make} />

          {settings ? (
            <div id="make">
              <Composer
                settings={settings}
                ads={ads}
                want={want}
                onWant={setWant}
                disabled={onShift.length === 0}
                onDone={(message) => {
                  setError(null);
                  setNotice(message);
                }}
                onError={(message) => {
                  setNotice(null);
                  setError(message);
                }}
              />
            </div>
          ) : null}

          <ReadyForYou waiting={desk.waiting} direct={Boolean(settings?.autoPublish)} />

          <AgentGrid staff={staff} desk={desk} nowMs={nowMs} />

          <div className="sd-row2">
            <WeekStrip posts={posts} desk={desk} />
            <MadeChart desk={desk} />
          </div>

          {/* the line a piece travels, lit by the documents themselves */}
          <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 0' }}>
              <h2 style={{ ...h2, marginBottom: taught ? 6 : 2 }}>Where every piece is right now</h2>
              {taught ? null : (
                <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 6px' }}>
                  Left to right, every time. A step lights up only while something is really in it.
                </p>
              )}
            </div>
            <div style={{ padding: '0 10px 14px' }}>
              <Pipeline state={pipeline} teach={!taught} />
            </div>
          </div>
        </div>

        <div className="sd-col">
          <RecentActivity desk={desk} nowMs={nowMs} />
          <TopContent read={pageRead} />

          {settings ? (
            <div className="sd-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <h2 style={{ ...h2, marginBottom: 0 }}>The desk</h2>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 900,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    padding: '3px 9px',
                    borderRadius: 999,
                    color: running ? colors.success : colors.muted,
                    background: running ? `${colors.success}14` : colors.border,
                  }}
                >
                  {running ? 'Running' : 'Paused'}
                </span>
                <Link
                  href="/dashboard/social/automation"
                  style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: colors.secondary }}
                >
                  Settings →
                </Link>
              </div>

              <p style={{ fontSize: 13, color: colors.text, margin: '0 0 12px', lineHeight: 1.55 }}>
                {running
                  ? `Every day at ${hour(settings.runHour)} PKT it makes ${pieces(settings.postsPerDay)}${
                      settings.dailyStory ? ' and a story' : ''
                    }, makes the pictures and videos, answers comments and measures the page.`
                  : `Start it and from ${nextRunWhenStarted(settings.runHour, nowMs)} it makes ${pieces(
                      settings.postsPerDay,
                    )} and a story every day on its own — on top of anything you ask for.`}
              </p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <Button
                  onClick={() => setRunning(!running)}
                  variant={running ? 'ghost' : 'primary'}
                  disabled={switching || onShift.length === 0}
                >
                  {switching ? 'Saving…' : running ? 'Pause the desk' : 'Start the desk'}
                </Button>
                <Button variant="ghost" onClick={() => chooseMode(!settings.autoPublish)} disabled={switching}>
                  {settings.autoPublish ? 'Ask me before posting' : 'Post directly'}
                </Button>
              </div>

              <div style={{ display: 'grid', gap: 7, fontSize: 12.5 }}>
                <Row
                  label="Posting"
                  value={settings.autoPublish ? 'Directly, as soon as it is made' : 'After your Approve'}
                />
                {nextRun ? (
                  <Row
                    label="Next run"
                    value={`${nextRun.today ? 'Today' : longDate(nextRun.at.toISOString().slice(0, 10))}, ${hour(settings.runHour)}`}
                  />
                ) : null}
                <Row
                  label="Last run"
                  value={
                    settings.lastRunAtMs
                      ? `${new Date(settings.lastRunAtMs).toLocaleString('en-PK')} — ${settings.lastRunStatus ?? ''}`
                      : 'Never'
                  }
                />
                {coverage.length ? (
                  <p style={{ fontSize: 12, color: colors.warn, margin: '4px 0 0', lineHeight: 1.5 }}>{coverage[0]}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="sd-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>Where it posts</h2>
              <Link
                href="/dashboard/social/accounts"
                style={{ fontSize: 12.5, fontWeight: 700, color: colors.secondary }}
              >
                Manage →
              </Link>
            </div>
            {accounts.length === 0 ? (
              <p style={{ color: colors.muted, fontSize: 13, margin: 0, lineHeight: 1.55 }}>
                Nothing connected yet.{' '}
                <Link href="/dashboard/social/accounts" style={{ color: colors.secondary, fontWeight: 700 }}>
                  Connect Instagram
                </Link>{' '}
                — it is one sign-in, with no token to paste.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {accounts.map((a) => (
                  <div key={a.platform} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <PlatformBadge platform={a.platform} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="sd-clip" style={{ fontSize: 13, fontWeight: 700 }}>
                        {a.displayName ?? PLATFORM_META[a.platform].label}
                      </div>
                      <div style={{ fontSize: 12, color: colors.muted }}>
                        {typeof a.followers === 'number' ? `${compact(a.followers)} followers` : (a.handle ?? '')}
                      </div>
                    </div>
                    <StatusPill status={a.status} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <AdsSnapshot ads={ads} />
        </div>
      </div>
    </div>
  );
}

/**
 * "What do you want?" — one box for everything the desk makes.
 *
 * A post, reel, story or carousel goes to the team with your words as the
 * brief, and is posted or queued by the switch beside the button (which starts
 * on whatever the desk is set to). An ad goes to the ads desk with the same
 * words; the budget is held to the daily limit set on the Ads page.
 */
function Composer({
  settings,
  ads,
  want,
  onWant,
  disabled,
  onDone,
  onError,
}: {
  settings: SocialSettings;
  ads: AdsConfigDoc | null;
  want: Want;
  onWant: (w: Want) => void;
  disabled: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [brief, setBrief] = useState('');
  const [direct, setDirect] = useState<boolean | null>(null);
  const [budget, setBudget] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);

  const postDirect = direct ?? settings.autoPublish;
  const adsReady = Boolean(ads?.adAccountId) && (ads?.dailyCap ?? 0) > 0 && ads?.mode != null;

  async function go() {
    setBusy(true);
    try {
      if (want === 'ad') {
        const res = await adsApi.create({
          brief: brief.trim(),
          dailyBudget: Number(budget) > 0 ? Number(budget) : undefined,
          days: Number(days) > 0 ? Math.round(Number(days)) : undefined,
        });
        onDone(
          `${res.launched ? 'Launched' : 'Made and waiting for your Approve on the Ads page'}: "${res.plan.name}", ` +
            `${adMoney(res.budget, ads?.currency ?? 'PKR')} a day for ${res.plan.days} days.${res.note ? ` ${res.note}` : ''}`,
        );
      } else {
        const res = await socialApi.generate({
          replace: true,
          format: want,
          ...(brief.trim().length >= 3 ? { brief: brief.trim() } : {}),
          publishWhenDone: postDirect,
        });
        onDone(
          postDirect
            ? `The team made the ${FORMAT_META[res.format].label.toLowerCase()} and is posting it — watch it in the queue.`
            : `The team made the ${FORMAT_META[res.format].label.toLowerCase()}. It is in the queue for your Approve.`,
        );
      }
      setBrief('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 style={{ ...h2, marginBottom: 4 }}>What should the team make?</h2>
      <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px' }}>
        Pick a kind, say what it is about in your own words, press Make it. Leave it empty and the team picks the topic.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }} role="radiogroup" aria-label="What to make">
        {WANTS.map((w) => {
          const on = w === want;
          return (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onWant(w)}
              style={{
                border: `1px solid ${on ? colors.primary : colors.border}`,
                background: on ? `${colors.primary}14` : colors.surface,
                color: on ? colors.primary : colors.text,
                fontWeight: 800,
                fontSize: 13,
                padding: '7px 14px',
                borderRadius: 999,
                cursor: 'pointer',
              }}
            >
              {w === 'ad' ? 'Paid ad' : FORMAT_META[w].label}
            </button>
          );
        })}
      </div>

      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        id="make-brief"
        rows={3}
        aria-label="What it should be about"
        placeholder={PLACEHOLDER[want]}
        style={{
          width: '100%',
          padding: 12,
          fontSize: 14,
          lineHeight: 1.5,
          fontFamily: 'inherit',
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          resize: 'vertical',
          marginBottom: 10,
        }}
      />

      {want === 'ad' ? (
        adsReady ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <label style={smallLabel}>
              Per day ({ads!.currency})
              <input
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="the expert decides"
                style={smallInput}
              />
            </label>
            <label style={smallLabel}>
              Days
              <input
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
                placeholder={`up to ${ads!.maxDays}`}
                style={smallInput}
              />
            </label>
            <span style={{ fontSize: 12.5, color: colors.muted }}>
              Limit {adMoney(ads!.dailyCap, ads!.currency)} a day ·{' '}
              {ads!.mode === 'direct' ? 'launches straight away' : 'waits for your Approve'}
            </span>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: colors.warn, margin: '0 0 10px' }}>
            The ads desk needs the ad account connected and a daily limit first.{' '}
            <Link href="/dashboard/social/ads" style={{ color: colors.secondary, fontWeight: 700 }}>
              Set it up
            </Link>
          </p>
        )
      ) : (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={postDirect} onChange={(e) => setDirect(e.target.checked)} />
          Post it as soon as it is ready — don&apos;t wait for my Approve
        </label>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          onClick={go}
          disabled={busy || disabled || (want === 'ad' && (!adsReady || brief.trim().length < 5))}
        >
          {busy ? (want === 'ad' ? 'The expert is building it…' : 'The team is working…') : want === 'ad' ? 'Plan and make the ad' : 'Make it'}
        </Button>
        {busy ? (
          <span style={{ fontSize: 12.5, color: colors.muted }}>
            Takes a few minutes. You can leave this page — it carries on.
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/** This week on the paid side, against what things should cost here. */
function AdsSnapshot({ ads }: { ads: AdsConfigDoc | null }) {
  const week = ads?.account?.week;
  const bench = ads?.account?.bench;
  return (
    <div className="sd-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>Ads this week</h2>
        <Link href="/dashboard/social/ads" style={{ fontSize: 12.5, fontWeight: 700, color: colors.secondary }}>
          Open Ads →
        </Link>
      </div>
      {!ads?.adAccountId ? (
        <p style={{ color: colors.muted, fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          Run Meta ads from here: say what the ad should do and the desk plans it, makes it, launches it and watches
          what each click costs.{' '}
          <Link href="/dashboard/social/ads" style={{ color: colors.secondary, fontWeight: 700 }}>
            Connect the ad account
          </Link>
        </p>
      ) : !week ? (
        <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>No numbers read yet — open Ads and press Refresh.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <Mini label="Spent" value={adMoney(week.spend, ads.currency)} />
            <Mini label="Link clicks" value={week.linkClicks.toLocaleString('en-PK')} />
            <Mini
              label="Per click"
              value={week.cpc ? adMoney(week.cpc, ads.currency) : '—'}
              hint={bench ? `normal ${adMoney(bench.cpc.low, ads.currency)}–${adMoney(bench.cpc.high, ads.currency)}` : undefined}
            />
          </div>
          {ads.review?.summary ? (
            <p style={{ fontSize: 12.5, color: colors.muted, margin: 0, lineHeight: 1.55 }}>{ads.review.summary}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: colors.bg, borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 16, fontWeight: 900 }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, color: colors.muted }}>{hint}</div> : null}
    </div>
  );
}

function Choice({
  title,
  detail,
  onClick,
  disabled,
}: {
  title: string;
  detail: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: 'left',
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        cursor: disabled ? 'wait' : 'pointer',
        font: 'inherit',
      }}
    >
      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, marginBottom: 4 }}>{title}</span>
      <span style={{ display: 'block', fontSize: 12.5, color: colors.muted, lineHeight: 1.5 }}>{detail}</span>
    </button>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = <span style={{ flex: 1, fontWeight: 600 }}>{value}</span>;
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: colors.muted, minWidth: 88 }}>{label}</span>
      {href ? (
        <Link href={href} style={{ flex: 1, color: 'inherit' }}>
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

const pieces = (n: number) => `${n} piece${n === 1 ? '' : 's'}`;

/**
 * When the first run would land if it were started this second — "today" while
 * the hour is still ahead, "tomorrow" once it has passed.
 */
function nextRunWhenStarted(runHour: number, nowMs: number): string {
  if (nowMs === 0) return `${hour(runHour)} PKT`;
  const nowPkt = new Date(nowMs + 5 * 3600_000);
  return `${nowPkt.getUTCHours() < runHour ? 'today' : 'tomorrow'} at ${hour(runHour)} PKT`;
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 12 };
const smallLabel: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 11.5,
  fontWeight: 800,
  color: colors.muted,
};
const smallInput: React.CSSProperties = {
  width: 150,
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 9,
};
