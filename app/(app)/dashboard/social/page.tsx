'use client';

/**
 * Manage social → Overview.
 *
 * The page answers two questions and nothing else:
 *
 *  1. **Is the desk running?** — and if it is not, one button starts it. That
 *     button used to be five checkboxes and a Save on another screen, which is
 *     why the desk sat paused for weeks with everything else in place.
 *  2. **Where is a piece right now?** — the line a piece travels, lit from the
 *     documents themselves.
 *
 * Everything else on this page is detail under those two, in one column of
 * cards: who is on the desk, where it posts, what was made last.
 *
 * Two rules this file is built on, both of them load-bearing:
 *
 * - **The teaching text appears once.** The five-step strip explains itself in
 *   full until the desk has had a run, and then drops to captions. A page that
 *   explains itself forever is a page you stop reading.
 * - **Motion means something.** A dot travels a step only while a document is
 *   in that state, a count breathes only while it is waiting on the person
 *   reading the page, and an idle desk is completely still — see
 *   components/social/pipeline.tsx, where that is enforced.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, onSnapshot, orderBy, query, limit } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import {
  SOCIAL_FORMATS,
  socialApi,
  type SocialAccountDoc,
  type SocialEmployee,
  type SocialFormat,
  type SocialPostDoc,
  type SocialReadiness,
  type SocialSettings,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import {
  FORMAT_META,
  FormatChip,
  PlatformBadge,
  PLATFORM_META,
  StatusPill,
  longDate,
  postSummary,
} from '@/components/social/shared';
import { Blockers, Pipeline, readBlockers, readPipeline } from '@/components/social/pipeline';

export default function SocialOverview() {
  const [accounts, setAccounts] = useState<SocialAccountDoc[]>([]);
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [readiness, setReadiness] = useState<SocialReadiness | null>(null);
  const [staff, setStaff] = useState<SocialEmployee[]>([]);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [format, setFormat] = useState<SocialFormat | ''>('');

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
        query(collection(db, 'socialPosts'), orderBy('date', 'desc'), limit(6)),
        (snap) => setPosts(snap.docs.map((d) => ({ ...(d.data() as SocialPostDoc), id: d.id }))),
        (e) => setError(e.message),
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

  /** What the rotation will make next, so the button is not a surprise. */
  const upNext = useMemo(() => {
    if (!settings?.formats?.length) return null;
    return settings.formats[(settings.lastFormatIndex + 1) % settings.formats.length];
  }, [settings]);

  /** The desk has been round the loop at least once: stop explaining it. */
  const taught = Boolean(settings?.lastRunAtMs) || posts.length > 0;

  async function briefTeam() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await socialApi.generate({ replace: true, ...(format ? { format } : {}) });
      setNotice(`The team made a ${FORMAT_META[res.format].label.toLowerCase()}. It is in the approval queue.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The team could not produce anything.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Start or pause the whole desk in one call.
   *
   * Starting writes every switch the daily run actually needs, because the
   * alternative — find them on the Automation page, tick four of them, scroll
   * to Save — is the reason this stayed off. Each field written is named in the
   * card above the button, so nothing is switched on quietly. Pausing touches
   * `enabled` and nothing else: it is a stop, not a reset, and the settings are
   * there untouched when it starts again.
   */
  async function setRunning(on: boolean) {
    setSwitching(true);
    setNotice(null);
    setError(null);
    try {
      const res = await socialApi.updateSettings(
        on
          ? {
              enabled: true,
              dailyStory: true,
              autoRenderVideo: true,
              learnFromOwnPage: true,
              engagementEnabled: true,
            }
          : { enabled: false },
      );
      setSettings(res.settings);
      setNotice(
        on
          ? `The desk is on. It works every day at ${hour(res.settings.runHour)} PKT, and everything it makes waits for you in the approval queue.`
          : 'The desk is paused. Nothing will be made until you start it again, or brief the team by hand.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the schedule.');
    } finally {
      setSwitching(false);
    }
  }

  const running = Boolean(settings?.enabled);

  return (
    <div>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Social</h1>
        <p style={{ color: colors.muted, margin: 0, maxWidth: 760 }}>
          The team you hired plans, writes, designs, cuts and posts Velocity Rides’ content — and stops at your
          approval, every time.
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, marginBottom: 14 }}>{notice}</p> : null}

      {/* 1 — what is actually stopping it, if anything */}
      {readiness ? <Blockers blockers={blockers} /> : null}

      {/* 2 — the one control: is the desk on, and start a piece now */}
      {settings ? (
        <Card style={{ marginBottom: 16 }}>
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
              Settings
            </Link>
          </div>

          <p style={{ fontSize: 13.5, color: colors.text, margin: '0 0 4px', lineHeight: 1.6 }}>
            {running
              ? `Every day at ${hour(settings.runHour)} PKT it makes ${pieces(settings.postsPerDay)}${
                  settings.dailyStory ? ' and a story' : ''
                }, cuts its own reels, reads the comments every two hours, and measures its own page afterwards.`
              : `Start it and from ${
                  nextRunWhenStarted(settings.runHour, nowMs)
                } it makes ${pieces(settings.postsPerDay)} and a story every day, cuts its own reels, reads the comments every two hours, and measures its own page afterwards.`}
          </p>
          <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 14px', lineHeight: 1.55 }}>
            Nothing goes out on its own: every piece stops in the approval queue until you say yes.
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <Button
              onClick={() => setRunning(!running)}
              variant={running ? 'ghost' : 'primary'}
              disabled={switching || onShift.length === 0}
            >
              {switching ? 'Saving…' : running ? 'Pause the desk' : 'Start the desk'}
            </Button>

            <span style={{ width: 1, height: 24, background: colors.border }} />

            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as SocialFormat | '')}
              style={{
                padding: '8px 10px',
                fontSize: 13,
                fontFamily: 'inherit',
                border: `1px solid ${colors.border}`,
                borderRadius: 9,
                background: colors.surface,
                color: colors.text,
              }}
            >
              <option value="">Next in the rotation{upNext ? ` (${FORMAT_META[upNext].label})` : ''}</option>
              {SOCIAL_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_META[f].label} — {FORMAT_META[f].note}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={briefTeam} disabled={busy || onShift.length === 0}>
              {busy ? 'The team is working…' : 'Make one now'}
            </Button>
          </div>

          <div style={{ display: 'grid', gap: 7, fontSize: 13 }}>
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
            <Row
              label="On the desk"
              value={
                onShift.length === 0
                  ? 'Nobody — hire someone first'
                  : pipeline.live?.current
                    ? `${pipeline.live.current.name} is working — ${onShift.length} on the desk`
                    : `${onShift.length} people — ${onShift
                        .slice(0, 3)
                        .map((e) => e.name)
                        .join(', ')}${onShift.length > 3 ? ` and ${onShift.length - 3} more` : ''}`
              }
              href="/dashboard/social/employees"
            />
            {coverage.length ? (
              <p style={{ fontSize: 12.5, color: colors.warn, margin: '4px 0 0', lineHeight: 1.5 }}>{coverage[0]}</p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* 3 — the line a piece travels, lit by the documents themselves */}
      <Card style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <h2 style={{ ...h2, marginBottom: taught ? 6 : 2 }}>How a post gets made</h2>
          {taught ? null : (
            <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 6px' }}>
              Left to right, every time. A step lights up only while something is really in it.
            </p>
          )}
        </div>
        <div style={{ padding: '0 10px 14px' }}>
          <Pipeline state={pipeline} teach={!taught} />
        </div>
      </Card>

      {/* 4 — the detail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>Where it posts</h2>
            <Link
              href="/dashboard/social/accounts"
              style={{ fontSize: 12.5, fontWeight: 700, color: colors.secondary }}
            >
              Manage
            </Link>
          </div>
          {accounts.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 13, margin: 0, lineHeight: 1.55 }}>
              Nothing connected yet.{' '}
              <Link href="/dashboard/social/accounts" style={{ color: colors.secondary, fontWeight: 700 }}>
                Connect Instagram
              </Link>{' '}
              — it is one sign-in now, with no token to paste.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {accounts.map((a) => (
                <div key={a.platform} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <PlatformBadge platform={a.platform} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.displayName ?? PLATFORM_META[a.platform].label}
                    </div>
                    <div style={{ fontSize: 12, color: colors.muted }}>
                      {a.handle ?? PLATFORM_META[a.platform].label}
                      {typeof a.followers === 'number' ? ` · ${a.followers.toLocaleString('en-PK')} followers` : ''}
                    </div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>Latest work</h2>
            <Link
              href="/dashboard/social/calendar"
              style={{ fontSize: 12.5, fontWeight: 700, color: colors.secondary }}
            >
              Calendar
            </Link>
          </div>
          {posts.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>Nothing made yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {posts.map((p) => (
                <Link
                  key={p.id}
                  href="/dashboard/social/queue"
                  style={{ display: 'grid', gap: 4, paddingBottom: 10, borderBottom: `1px solid ${colors.border}` }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: colors.muted, fontWeight: 700 }}>{longDate(p.date)}</span>
                    <FormatChip format={p.format} />
                    <StatusPill status={p.status} />
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{postSummary(p)}</div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
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
 * the hour is still ahead, "tomorrow" once it has passed. Saying "every day"
 * and leaving somebody to work out whether that means in an hour or in
 * twenty-three is the sort of thing that gets a schedule switched off again.
 */
function nextRunWhenStarted(runHour: number, nowMs: number): string {
  if (nowMs === 0) return `${hour(runHour)} PKT`;
  const nowPkt = new Date(nowMs + 5 * 3600_000);
  return `${nowPkt.getUTCHours() < runHour ? 'today' : 'tomorrow'} at ${hour(runHour)} PKT`;
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 12 };
