'use client';

/**
 * Manage social → Dashboard. One thing: the Brain.
 *
 * It used to be four boxes stacked down the page — ask, content, ads, sales —
 * each a summary of a page that already exists in the menu. The owner asked
 * (2026-11-26) for the dashboard to be the Brain and nothing else, with
 * everything else in the sidebar, so:
 *
 *  • this page is the ask, the map of where the work goes, and the one
 *    decision that matters — who presses send;
 *  • the numbers that were in the tiles are now counts on the nav rows they
 *    were always about, and what she is doing this minute is the status block
 *    under the menu. Both are fed by `publishDeskStatus` below, from the reads
 *    this page already makes — the sidebar costs no extra call.
 *
 * Load-bearing, and kept: **asked once** — should the desk ask before posting
 * (`autoPublish`), which is the Approval box, and stays unanswered until you
 * answer it.
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
  type SalesSettingsDoc,
  type SocialAccountDoc,
  type SocialEmployee,
  type SocialFormat,
  type SocialPlatform,
  type SalesChatDoc,
  type SocialCommentDoc,
  type SocialPostDoc,
  type SocialReadiness,
  type SocialSettings,
} from '@/lib/api';
import { PLATFORM_META, longDate } from '@/components/social/shared';
import { InstagramConnect } from '@/components/social/instagramConnect';
import { VideoConnect } from '@/components/social/videoConnect';
import { readBlockers } from '@/components/social/blockers';
import { localHourLabel } from '@/components/social/launch';
import { ApprovalBox, readDesk } from '@/components/social/dashboard';
import { SEARCH_CSS } from '@/components/social/search';
import { BRAIN_CSS, Brain } from '@/components/social/brain';
import { FX_CSS } from '@/components/social/fx';
import { publishDeskStatus } from '@/lib/deskStatus';
import { useDraft } from '@/lib/draft';

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
  const { path, includes, ws } = useWorkspace();
  const [accounts, setAccounts] = useState<SocialAccountDoc[]>([]);
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [readiness, setReadiness] = useState<SocialReadiness | null>(null);
  const [staff, setStaff] = useState<SocialEmployee[]>([]);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [ads, setAds] = useState<AdsConfigDoc | null>(null);
  const [campaigns, setCampaigns] = useState<AdCampaignDoc[]>([]);
  const [sales, setSales] = useState<SalesSettingsDoc | null>(null);
  const [chats, setChats] = useState<SalesChatDoc[]>([]);
  const [comments, setComments] = useState<SocialCommentDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [want, setWant] = useState<SocialFormat>('reel');
  const { workspaceId } = useAuth();
  // Held here so "Make one like this" on the content page can fill the box — and kept in
  // this browser until the piece is made, so a reload or a sign-in that ended loses nothing.
  const [brief, setBrief] = useDraft(`composer.brief.${workspaceId ?? 'house'}`);
  const [refLink, setRefLink] = useState('');
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
    return stopSettings;
  }, [path, showSales]);

  // The funnel's two halves: what people asked in public under a post, and the
  // conversations themselves. Both are watched on the overview because the
  // funnel is the one place they are read as a single story.
  useEffect(() => {
    if (!showSales) return;
    return onSnapshot(
      query(collection(db, path('salesChats')), orderBy('updatedAtMs', 'desc'), limit(200)),
      (snap) => setChats(snap.docs.map((d) => ({ ...(d.data() as SalesChatDoc), waId: d.id }))),
      () => setChats([]),
    );
  }, [path, showSales]);

  useEffect(() => {
    if (!showSales) return;
    return onSnapshot(
      query(collection(db, path('socialComments')), orderBy('createdAtMs', 'desc'), limit(300)),
      (snap) => setComments(snap.docs.map((d) => ({ ...(d.data() as SocialCommentDoc), id: d.id }))),
      () => setComments([]),
    );
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
  }, [setBrief]);

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

  /**
   * The one question the console opens with. Answering it is also what starts
   * the work — which is the whole point of asking it here (owner, 2026-11-14).
   *
   * Two calls on purpose: the goal is saved on its own first, so that a refusal
   * to start the daily run (an empty office is one) never loses the answer and
   * never asks the question twice.
   */
  async function answerGoal(goal: string) {
    setSwitching(true);
    setNotice(null);
    setError(null);
    try {
      setSettings((await socialApi.updateSettings({ goal })).settings);
      const res = await socialApi.updateSettings(RUN_ON);
      setSettings(res.settings);
      setNotice(
        `Got it — everything I make is aimed at that from now on, starting today at ${localHourLabel(res.settings.runHour)}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSwitching(false);
    }
  }

  const setRunning = (on: boolean) =>
    save(on ? RUN_ON : { enabled: false }, (s) =>
      on
        ? `The daily run is on: every day at ${localHourLabel(s.runHour)}${
            s.autoPublish ? ', posted directly.' : ', and everything waits for your Approve.'
          }`
        : 'The daily run is paused. Nothing will be made until you start it again, or ask for something above.',
    );

  const desk = useMemo(() => readDesk(posts, nowMs), [posts, nowMs]);
  const networks = connected.length
    ? connected.map((a) => PLATFORM_META[a.platform].label.replace(' Page', '')).join(' and ')
    : 'your accounts';

  // One read, shared: the counts the nav rows show and the line under the menu
  // come from what this page already watches.
  const doing = useMemo(() => {
    const live = [...desk.doing.values()].filter((d) => d.now);
    if (!live.length) return null;
    const one = live[0];
    return `${one.stage.replace(/_/g, ' ')} — “${one.post.angle?.slice(0, 46) || 'a piece'}”`;
  }, [desk]);

  useEffect(() => {
    publishDeskStatus({
      waiting: desk.waiting.length,
      comments: comments.filter((c) => c.status === 'new' || c.status === 'drafted').length,
      liveAds: campaigns.filter((c) => c.status === 'active').length,
      chats: chats.filter((c) => !['won', 'lost', 'stopped'].includes(c.stage)).length,
      blockers: blockers.length,
      running: Boolean(settings?.enabled),
      nextRun,
      doing,
    });
  }, [desk, comments, campaigns, chats, blockers, settings, nextRun, doing]);

  return (
    <div className="fx fx-brain-page">
      <style>{FX_CSS + BRAIN_CSS + SEARCH_CSS + PAGE_CSS}</style>

      {/* The dashboard is the ask and nothing else. Everything that used to be
          stacked under it — content, ads, sales, the numbers — is in the menu,
          with its count on the row (owner, 2026-11-26). */}
      <header className="bp-head fx-rise">
        <h1>
          Tell Vexa what you want<span>.</span>
        </h1>
        <p>
          In your own words. She works out which part of the team should do it — and down there you choose who presses
          send.
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}
      {notice ? (
        <p className="fx-rise" style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>
          {notice}
        </p>
      ) : null}

      {/* Nothing can go out until an account is connected, so the one blocker
          that stops the ask working stays on this page rather than only in the
          menu. It disappears the moment they are all in. */}
      {ws?.platforms?.length ? <ChosenPlatforms platforms={ws.platforms} accounts={accounts} /> : null}

      {settings ? (
        <div id="make" style={{ scrollMarginTop: 16 }} data-tour="area-brain">
          <Brain
            settings={settings}
            accounts={accounts}
            sales={sales}
            nowMs={nowMs}
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
            onGoal={answerGoal}
            goalBusy={switching}
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
        <div className="fx-skel" style={{ height: 420, borderRadius: 28 }} />
      )}
    </div>
  );
}

const PAGE_CSS = `
/* The page is one thing now, so it can breathe: the ask sits where the eye
   lands, and nothing competes with it down the page. */
.fx-brain-page { max-width: 1180px; }
.bp-head { margin: 2px 0 18px; }
.bp-head h1 { margin: 0; font-size: clamp(26px, 3.4vw, 38px); font-weight: 900; letter-spacing: -.5px; color: #0c2418; }
.bp-head h1 span { color: #16a34a; }
.bp-head p { margin: 8px 0 0; max-width: 62ch; font-size: 14.5px; line-height: 1.6; color: #5d6b63; }
`;

function ChosenPlatforms({ platforms, accounts }: { platforms: SocialPlatform[]; accounts: SocialAccountDoc[] }) {
  const by = (p: SocialPlatform) => accounts.find((x) => x.platform === p);
  const open = platforms.filter((p) => by(p)?.status !== 'connected');
  if (!open.length) return null;
  // Instagram and Facebook share one Facebook sign-in; the rest are pasted on Connected accounts.
  const pasted = open.filter((p) => !['instagram', 'facebook', 'youtube', 'tiktok'].includes(p));
  return (
    <section className="fx-rise" style={{ marginBottom: 16 }}>
      <strong style={{ fontSize: 14 }}>Connect where you post</strong>
      <p className="fx-muted" style={{ fontSize: 13, margin: '4px 0 12px', lineHeight: 1.55 }}>
        You chose {open.map((p) => PLATFORM_META[p].label).join(', ')} at sign-up. Nothing goes out until an account is connected.
      </p>
      {open.includes('instagram') || open.includes('facebook') ? <InstagramConnect account={by('instagram')} /> : null}
      {open.includes('youtube') ? <VideoConnect provider="youtube" account={by('youtube')} /> : null}
      {open.includes('tiktok') ? <VideoConnect provider="tiktok" account={by('tiktok')} /> : null}
      {pasted.length ? (
        <Link href="/dashboard/social/accounts" style={{ color: colors.secondary, fontWeight: 800, fontSize: 13.5 }}>
          Connect {pasted.map((p) => PLATFORM_META[p].label).join(', ')} on Connected accounts →
        </Link>
      ) : null}
    </section>
  );
}
