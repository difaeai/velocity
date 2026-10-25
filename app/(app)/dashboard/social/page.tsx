'use client';

/**
 * Manage social → Dashboard.
 *
 * A glance, not a read: say what to make and how it should go out (the two
 * boxes at the top), then the numbers, how the ads are running and how the
 * sales agents are doing. Everything the team made lives on the content page
 * with the calendar; each section here links to its own page for the detail.
 *
 * Kept from the page before it, because each is load-bearing:
 *  - **asked once**: should the desk ask before posting? (`autoPublish`) — now
 *    the Approval box, which says "Choose one" until it is answered
 *  - **one box** for everything the desk makes, posts and ads alike
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import {
  adsApi,
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
import { FORMAT_META, PLATFORM_META, longDate } from '@/components/social/shared';
import { Blockers, readBlockers } from '@/components/social/blockers';
import { adMoney } from '@/components/social/ads';
import { LaunchSequence, localHourLabel } from '@/components/social/launch';
import { AdsSection, ApprovalBox, Hero, KpiTile, SalesSection, readDesk } from '@/components/social/dashboard';
import { AreaSpark, FX_CSS } from '@/components/social/fx';
import { compact } from '@/components/charts';

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

/** Every switch the daily run needs; pausing touches `enabled` and nothing else — a stop, not a reset. */
const RUN_ON: Partial<SocialSettings> = {
  enabled: true,
  dailyStory: true,
  autoRenderVideo: true,
  learnFromOwnPage: true,
  engagementEnabled: true,
};

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
  const [want, setWant] = useState<Want>('reel');
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

    return onSnapshot(doc(db, path('system/socialAutomation')), (snap) => {
      if (snap.exists()) setSettings((prev) => (prev ? { ...prev, ...(snap.data() as Partial<SocialSettings>) } : prev));
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

  /** The Approval box. Posting on its own every day also starts the daily run. */
  const chooseMode = (direct: boolean) =>
    save(direct ? { ...RUN_ON, autoPublish: true, publishModeChosen: true } : { autoPublish: false, publishModeChosen: true }, (s) =>
      direct
        ? `Done — every day at ${localHourLabel(s.runHour)} the team makes the pieces and posts them straight away.`
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
      <style>{FX_CSS}</style>

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
        <div className="fx-grid-make">
          <div id="make" style={{ scrollMarginTop: 16, minWidth: 0 }}>
            <Composer
              settings={settings}
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
            />
          </div>
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
        </div>
      ) : (
        <div className="fx-grid-make">
          <div className="fx-skel" style={{ height: 260 }} />
          <div className="fx-skel" style={{ height: 260 }} />
        </div>
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

/**
 * "What should the team make?" — one box for everything the desk makes.
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
  brief,
  onBrief,
  refLink,
  onRefLink,
  disabled,
  onDone,
  onError,
}: {
  settings: SocialSettings;
  ads: AdsConfigDoc | null;
  want: Want;
  onWant: (w: Want) => void;
  brief: string;
  onBrief: (b: string) => void;
  refLink: string;
  onRefLink: (l: string) => void;
  disabled: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { path } = useWorkspace();
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refAsked, setRefAsked] = useState(false);
  const [direct, setDirect] = useState<boolean | null>(null);
  const [budget, setBudget] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);

  const postDirect = direct ?? settings.autoPublish;
  const adsReady = Boolean(ads?.adAccountId) && (ads?.dailyCap ?? 0) > 0 && ads?.mode != null;
  // Folded away until wanted: most pieces need only the kind and a sentence.
  const showRef = refAsked || Boolean(refLink.trim()) || Boolean(refFile);

  async function go() {
    setBusy(true);
    try {
      // "Make it like this": the file goes to Storage first and the backend reads it from there.
      let reference: { youtube: string } | { storagePath: string } | undefined;
      if (want !== 'ad' && refFile) {
        // storage.rules refuses anything bigger, with an error nobody could read.
        if (refFile.size > 200 * 1024 * 1024) throw new Error('That video is over 200 MB. Trim it to the part that matters.');
        const upload = path(`socialUploads/ref-${Date.now()}-${refFile.name.replace(/[^\w.-]/g, '')}`);
        await uploadBytes(ref(storage, upload), refFile, { contentType: refFile.type || 'video/mp4' });
        reference = { storagePath: upload };
      } else if (want !== 'ad' && refLink.trim()) {
        reference = { youtube: refLink.trim() };
      }

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
          ...(reference ? { reference } : {}),
        });
        setRefFile(null);
        onRefLink('');
        setRefAsked(false);
        onDone(
          postDirect
            ? `The team made the ${FORMAT_META[res.format].label.toLowerCase()} and is posting it — see it on Content & calendar.`
            : `The team made the ${FORMAT_META[res.format].label.toLowerCase()}. Approve it on Content & calendar.`,
        );
      }
      onBrief('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fx-card fx-focus fx-rise" style={{ ['--i' as string]: 1 } as React.CSSProperties} aria-labelledby="make-h">
      <div className="fx-head" style={{ marginBottom: 12 }}>
        <span className="fx-ico" style={{ background: '#e3f4ea' }} aria-hidden>
          🎬
        </span>
        <div>
          <h2 id="make-h" className="fx-h2">
            What should the team make?
          </h2>
          <p className="fx-sub">Pick a kind, say what it is about, press Make it. Leave it empty and the team picks the topic.</p>
        </div>
      </div>

      <div className="fx-seg" role="radiogroup" aria-label="What to make" style={{ marginBottom: 12 }}>
        {WANTS.map((w) => (
          <button key={w} type="button" role="radio" aria-checked={w === want} onClick={() => onWant(w)}>
            <span aria-hidden>{w === 'ad' ? '💸' : FORMAT_META[w].glyph}</span>
            {w === 'ad' ? 'Paid ad' : FORMAT_META[w].label}
          </button>
        ))}
      </div>

      <textarea
        value={brief}
        onChange={(e) => onBrief(e.target.value)}
        id="make-brief"
        rows={4}
        aria-label="What it should be about"
        placeholder={PLACEHOLDER[want]}
        className="fx-input"
        style={{ marginBottom: 10 }}
      />

      {want !== 'ad' && !showRef ? (
        <button type="button" onClick={() => setRefAsked(true)} style={refToggle}>
          🎞️ + Make it like a video I like (optional)
        </button>
      ) : null}

      {want !== 'ad' && showRef ? (
        <div style={refBox}>
          <p style={{ fontSize: 12, color: colors.muted, margin: '0 0 8px', lineHeight: 1.5 }}>
            The team watches it and copies the hook, pacing and structure — never the footage, faces or words. From
            Instagram or TikTok? Download it and upload the file.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ ...refPick, opacity: refLink.trim() ? 0.5 : 1 }}>
              {refFile ? `📎 ${refFile.name}` : 'Upload a video'}
              <input
                type="file"
                accept="video/*"
                disabled={Boolean(refLink.trim())}
                style={{ display: 'none' }}
                onChange={(e) => {
                  setRefFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </label>
            {refFile ? (
              <button type="button" onClick={() => setRefFile(null)} style={refClear} aria-label="Remove the video">
                ✕
              </button>
            ) : (
              <>
                <span style={{ fontSize: 12, color: colors.muted }}>or</span>
                <input
                  value={refLink}
                  onChange={(e) => onRefLink(e.target.value)}
                  placeholder="paste a YouTube or Shorts link"
                  aria-label="YouTube link"
                  style={{ ...smallInput, flex: 1, minWidth: 200 }}
                />
              </>
            )}
          </div>
        </div>
      ) : null}

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
            </Link>{' '}
            — or{' '}
            <Link href="/dashboard/social/ads#design" style={{ color: colors.secondary, fontWeight: 700 }}>
              design the campaign with the expert
            </Link>{' '}
            first.
          </p>
        )
      ) : (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '10px 0' }}>
          <input type="checkbox" checked={postDirect} onChange={(e) => setDirect(e.target.checked)} />
          Post it as soon as it is ready — don&apos;t wait for my Approve
        </label>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="fx-btn"
          onClick={go}
          disabled={busy || disabled || (want === 'ad' && (!adsReady || brief.trim().length < 5))}
        >
          {busy ? <span className="fx-typing" aria-hidden><span /><span /><span /></span> : <span aria-hidden>✨</span>}
          {busy
            ? want === 'ad'
              ? 'The expert is building it…'
              : refFile || refLink.trim()
                ? 'The team is watching the video…'
                : 'The team is working…'
            : want === 'ad'
              ? 'Plan and make the ad'
              : 'Make it'}
        </button>
        {busy ? (
          <span style={{ fontSize: 12.5, color: colors.muted }}>Takes a few minutes. You can leave this page — it carries on.</span>
        ) : null}
      </div>
    </section>
  );
}

const smallLabel: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 11.5,
  fontWeight: 800,
  color: colors.muted,
};
const refToggle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  color: colors.secondary,
  fontFamily: 'inherit',
  fontWeight: 800,
  fontSize: 13,
  cursor: 'pointer',
};
const refBox: React.CSSProperties = {
  border: `1px dashed ${colors.border}`,
  borderRadius: 12,
  padding: 12,
  background: colors.bg,
};
const refPick: React.CSSProperties = {
  border: `1px solid ${colors.primary}`,
  color: colors.primary,
  background: colors.surface,
  borderRadius: 9,
  padding: '7px 12px',
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const refClear: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  borderRadius: 8,
  padding: '5px 9px',
  cursor: 'pointer',
  fontSize: 12,
};
const smallInput: React.CSSProperties = {
  width: 150,
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 9,
};
