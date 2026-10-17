'use client';

/**
 * Manage social → Overview.
 *
 * Rebuilt around one question: **how does a post get made here, and where is
 * one right now?** The old page answered "what exists" — a roster, a settings
 * block, two lists — and left the workflow to be inferred from the navigation.
 *
 * So the page is now, in order:
 *
 *  1. What is stopping it, if anything, with the fix one click away.
 *  2. The line a piece travels: brief → made → approved by you → posted →
 *     measured, with the live counts and, while something is genuinely in
 *     production, the stage it is on and who has it.
 *  3. The two controls that start work: brief the team, and the schedule.
 *  4. The detail — where it posts, and what was made last.
 *
 * On motion: there is some, and all of it is load-bearing. A dot travels a step
 * only while a document is in that state, a count breathes only while it is
 * waiting on the person reading the page, and both stop the instant the desk is
 * idle. Nothing on this page animates to look busy — see components/social/
 * pipeline.tsx, where that rule is enforced.
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
    if (at <= nowPkt) at.setUTCDate(at.getUTCDate() + 1);
    return at;
  }, [settings, nowMs]);

  /** What the rotation will make next, so the button is not a surprise. */
  const upNext = useMemo(() => {
    if (!settings?.formats?.length) return null;
    return settings.formats[(settings.lastFormatIndex + 1) % settings.formats.length];
  }, [settings]);

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

      {/* 2 — the line a piece travels, lit by the documents themselves */}
      <Card style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <h2 style={{ ...h2, marginBottom: 2 }}>How a post gets made</h2>
          <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 6px' }}>
            Left to right, every time. A step lights up only while something is really in it.
          </p>
        </div>
        <div style={{ padding: '0 10px 14px' }}>
          <Pipeline state={pipeline} />
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* 3 — the two controls that start work */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>Start a piece</h2>
            <StatusPill status={settings?.enabled ? 'connected' : 'disconnected'} />
          </div>

          <p style={{ fontSize: 13, color: colors.muted, margin: '0 0 12px', lineHeight: 1.55 }}>
            {settings?.enabled
              ? `The desk briefs itself every day at ${String(settings.runHour).padStart(2, '0')}:00 PKT. You can also start one now.`
              : 'The schedule is paused, so the desk only works when you press this.'}
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
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
            <Button onClick={briefTeam} disabled={busy || onShift.length === 0}>
              {busy ? 'The team is working…' : 'Brief the team now'}
            </Button>
            <Link href="/dashboard/social/automation">
              <Button variant="ghost">Schedule</Button>
            </Link>
          </div>

          <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
            {nextRun ? (
              <Row
                label="Next run"
                value={`${longDate(nextRun.toISOString().slice(0, 10))}, ${String(settings?.runHour ?? 0).padStart(2, '0')}:00`}
              />
            ) : null}
            <Row
              label="Last run"
              value={
                settings?.lastRunAtMs
                  ? `${new Date(settings.lastRunAtMs).toLocaleString('en-PK')} — ${settings.lastRunStatus ?? ''}`
                  : 'Never'
              }
            />
            <Row
              label="Comments"
              value={
                settings?.engagementEnabled
                  ? settings.autoReply
                    ? 'Read and replied to automatically'
                    : 'Read; replies wait for you'
                  : 'Not being read'
              }
            />
            <Row label="Pictures and video" value="Briefed here, made by you" />
          </div>
        </Card>

        {/* who is on the desk — the real roster, without the theatre */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>Who does it</h2>
            <Link
              href="/dashboard/social/employees"
              style={{ fontSize: 12.5, fontWeight: 700, color: colors.secondary }}
            >
              {onShift.length ? 'Manage the team' : 'Hire someone'}
            </Link>
          </div>

          {onShift.length === 0 ? (
            <p style={{ fontSize: 13.5, color: colors.muted, margin: 0, lineHeight: 1.55 }}>
              Nobody works here yet, so nothing gets made.{' '}
              <Link href="/dashboard/social/employees" style={{ color: colors.secondary, fontWeight: 700 }}>
                Hire your first employee
              </Link>{' '}
              — a content writer is enough to see a piece written end to end.
            </p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 9 }}>
                {onShift.map((e) => {
                  const working = pipeline.live?.current?.employeeId === e.id;
                  return (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          flex: 'none',
                          background: working ? colors.primary : colors.border,
                        }}
                      />
                      <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 0 }}>{e.name}</span>
                      <span style={{ fontSize: 12.5, color: colors.muted, flex: 1, minWidth: 0 }}>
                        {working ? (pipeline.live?.current?.note ?? 'working now') : e.title}
                      </span>
                    </div>
                  );
                })}
              </div>
              {coverage.length ? (
                <p style={{ fontSize: 12.5, color: colors.warn, margin: '12px 0 0', lineHeight: 1.5 }}>
                  {coverage[0]}
                </p>
              ) : null}
            </>
          )}
        </Card>

        {/* 4 — the detail */}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: colors.muted, minWidth: 88 }}>{label}</span>
      <span style={{ flex: 1, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 12 };
