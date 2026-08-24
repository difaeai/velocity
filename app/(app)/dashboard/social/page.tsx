'use client';

/**
 * Manage social → Overview.
 *
 * The one screen that answers "is the marketing desk actually running?" — who
 * is on shift, what is wired up, which accounts are live, when the next piece
 * gets planned, and what is waiting for a decision. Everything else in this
 * section is a detail view of one of those.
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
  Mascot,
  PlatformBadge,
  PLATFORM_META,
  Readiness,
  ROLE_META,
  StatusPill,
  longDate,
  postSummary,
} from '@/components/social/shared';

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
  const offDuty = staff.filter((e) => e.status !== 'active');
  const connected = accounts.filter((a) => a.status === 'connected');
  const broken = accounts.filter((a) => a.status === 'error');
  const awaiting = posts.filter((p) => p.status === 'awaiting_approval' || p.status === 'changes_requested');

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
        <p style={{ color: colors.muted, margin: 0 }}>
          The team you hired plans, writes, designs, cuts and posts Velocity’s content — and stops at your approval,
          every time.
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, marginBottom: 14 }}>{notice}</p> : null}

      {/* who is on shift */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>On shift</h2>
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
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              {onShift.map((person) => (
                <div key={person.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Mascot role={person.role} size={40} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 900 }}>{person.name}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: colors.muted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {person.title || ROLE_META[person.role].label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {offDuty.length ? (
              <p style={{ fontSize: 12.5, color: colors.muted, margin: '12px 0 0' }}>
                Off duty: {offDuty.map((p) => p.name).join(', ')}.
              </p>
            ) : null}
            {coverage.length ? (
              <p style={{ fontSize: 12.5, color: colors.warn, margin: '10px 0 0', lineHeight: 1.5 }}>
                {coverage[0]}
              </p>
            ) : null}
          </>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card>
          <h2 style={h2}>Before it can run</h2>
          {readiness ? (
            <Readiness readiness={readiness} connectedCount={connected.length} staffed={onShift.length} />
          ) : (
            <p style={{ color: colors.muted, fontSize: 13 }}>Checking…</p>
          )}
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>The daily run</h2>
            <StatusPill status={settings?.enabled ? 'connected' : 'disconnected'} />
          </div>
          {settings ? (
            <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
              <Row
                label="Schedule"
                value={
                  settings.enabled
                    ? `${settings.postsPerDay} piece${settings.postsPerDay === 1 ? '' : 's'} a day at ${String(
                        settings.runHour,
                      ).padStart(2, '0')}:00 PKT`
                    : 'Paused — the team only works when you ask'
                }
              />
              {nextRun ? (
                <Row
                  label="Next run"
                  value={`${longDate(nextRun.toISOString().slice(0, 10))}, ${String(settings.runHour).padStart(2, '0')}:00`}
                />
              ) : null}
              <Row label="Up next" value={upNext ? FORMAT_META[upNext].label : '—'} />
              <Row
                label="Rendering"
                value={[
                  settings.imageProvider === 'none' ? 'images by hand' : 'images on',
                  settings.videoProvider === 'none' ? 'video by hand' : `video on (${settings.videoModel})`,
                ].join(' · ')}
              />
              <Row label="Approval" value="Always — nothing posts itself" />
              <Row
                label="Comments"
                value={
                  settings.engagementEnabled
                    ? settings.autoReply
                      ? 'Read and replied to automatically'
                      : 'Read; replies wait for you'
                    : 'Not being read'
                }
              />
              <Row
                label="Last run"
                value={
                  settings.lastRunAtMs
                    ? `${new Date(settings.lastRunAtMs).toLocaleString('en-PK')} — ${settings.lastRunStatus ?? ''}`
                    : 'Never'
                }
              />
            </div>
          ) : (
            <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
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
              <Button variant="ghost">Settings</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>Channels</h2>
            <Link
              href="/dashboard/social/accounts"
              style={{ fontSize: 12.5, fontWeight: 700, color: colors.secondary }}
            >
              Manage
            </Link>
          </div>
          {accounts.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 13 }}>
              Nothing connected yet.{' '}
              <Link href="/dashboard/social/accounts" style={{ color: colors.secondary, fontWeight: 700 }}>
                Connect your first account
              </Link>
              .
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
          {broken.length ? (
            <p style={{ color: colors.warn, fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
              {broken.length} account{broken.length === 1 ? '' : 's'} stopped working — most often an expired token.
              Reconnect from the accounts page.
            </p>
          ) : null}
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
            <p style={{ color: colors.muted, fontSize: 13 }}>Nothing made yet.</p>
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
          {awaiting.length ? (
            <p style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
              <Link href="/dashboard/social/queue" style={{ color: colors.secondary, fontWeight: 700 }}>
                {awaiting.length} piece{awaiting.length === 1 ? '' : 's'} waiting on you →
              </Link>
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: colors.muted, minWidth: 82 }}>{label}</span>
      <span style={{ flex: 1, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 12 };
