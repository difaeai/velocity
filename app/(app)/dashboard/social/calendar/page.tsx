'use client';

/**
 * Manage social → Content calendar.
 *
 * A month at a glance: what went out, what is waiting, and which days are
 * empty. The gaps are the point — a daily channel that quietly skipped four
 * days is invisible in a list and obvious in a grid.
 *
 * Any day can be drafted on demand, with the angle chosen by hand, which is
 * how you get ahead of a launch or a holiday instead of taking whatever the
 * rotation happens to land on.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { socialApi, type SocialPostDoc, type SocialSettings } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { StatusPill, longDate, postSummary } from '@/components/social/shared';

/** Pakistan's today, as `YYYY-MM-DD`. PKT is UTC+5, no daylight saving. */
function todayPkt(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_DOT: Record<string, string> = {
  published: '#0ca30c',
  partial: '#eb6834',
  ready: '#2a78d6',
  awaiting_approval: '#fab219',
  drafting: '#2a78d6',
  rendering: '#2a78d6',
  publishing: '#2a78d6',
  failed: '#d03b3b',
  rejected: '#898781',
};

export default function CalendarPage() {
  const today = todayPkt();
  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [posts, setPosts] = useState<Record<string, SocialPostDoc>>({});
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [angle, setAngle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'socialPosts'), orderBy('date', 'desc'), limit(120)),
        (snap) => {
          const next: Record<string, SocialPostDoc> = {};
          snap.docs.forEach((d) => {
            next[d.id] = { ...(d.data() as SocialPostDoc), id: d.id };
          });
          setPosts(next);
        },
        (e) => setError(e.message),
      ),
    [],
  );

  useEffect(() => {
    socialApi.getSettings({}).then((r) => setSettings(r.settings)).catch(() => undefined);
  }, []);

  const cells = useMemo(() => buildMonth(cursor), [cursor]);
  const monthLabel = new Date(`${cursor}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  function shiftMonth(delta: number) {
    const d = new Date(`${cursor}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    setCursor(d.toISOString().slice(0, 7));
    setSelected(null);
  }

  async function generate(date: string) {
    setBusy(true);
    setError(null);
    try {
      await socialApi.generate({ date, angle: angle || undefined, replace: true });
      setAngle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate that post.');
    } finally {
      setBusy(false);
    }
  }

  const selectedPost = selected ? posts[selected] : undefined;

  return (
    <div>
      <header style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Content calendar</h1>
          <p style={{ color: colors.muted, margin: 0 }}>One post a day. The empty squares are the ones to worry about.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" onClick={() => shiftMonth(-1)}>
            ←
          </Button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{monthLabel}</strong>
          <Button variant="ghost" onClick={() => shiftMonth(1)}>
            →
          </Button>
        </div>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card style={{ padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {DAY_LABELS.map((d) => (
              <div key={d} style={{ fontSize: 11, fontWeight: 800, color: colors.muted, textAlign: 'center', paddingBottom: 4 }}>
                {d}
              </div>
            ))}
            {cells.map((date, i) =>
              date === null ? (
                <div key={`pad-${i}`} />
              ) : (
                <button
                  key={date}
                  onClick={() => setSelected(date)}
                  style={{
                    aspectRatio: '1 / 1',
                    border: `1px solid ${selected === date ? colors.primary : colors.border}`,
                    background: date === today ? `${colors.primary}0D` : colors.surface,
                    borderRadius: 10,
                    padding: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 4,
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: date === today ? colors.primary : colors.text }}>
                    {Number(date.slice(8))}
                  </span>
                  {posts[date] ? (
                    <span
                      title={posts[date].status}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: STATUS_DOT[posts[date].status] ?? colors.muted,
                      }}
                    />
                  ) : null}
                </button>
              ),
            )}
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14, fontSize: 11.5, color: colors.muted }}>
            {[
              ['Published', STATUS_DOT.published],
              ['Ready', STATUS_DOT.ready],
              ['Needs approval', STATUS_DOT.awaiting_approval],
              ['Failed', STATUS_DOT.failed],
            ].map(([label, color]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
                {label}
              </span>
            ))}
          </div>
        </Card>

        <Card>
          {selected ? (
            <>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>{longDate(selected)}</h2>
              {selectedPost ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <StatusPill status={selectedPost.status} />
                  <div style={{ fontSize: 12, color: colors.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {selectedPost.angle}
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 700, margin: 0, lineHeight: 1.4 }}>{postSummary(selectedPost)}</p>
                  {selectedPost.caption ? (
                    <p style={{ fontSize: 13, color: colors.muted, margin: 0, lineHeight: 1.5 }}>{selectedPost.caption}</p>
                  ) : null}
                  <Link href="/dashboard/social/queue">
                    <Button variant="secondary">Open in the queue</Button>
                  </Link>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <p style={{ fontSize: 13.5, color: colors.muted, margin: 0 }}>
                    Nothing scheduled. Draft one now — pick an angle, or leave it to the rotation.
                  </p>
                  <select value={angle} onChange={(e) => setAngle(e.target.value)} style={selectStyle}>
                    <option value="">Next in the rotation</option>
                    {(settings?.angles ?? []).map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <Button onClick={() => generate(selected)} disabled={busy}>
                    {busy ? 'Writing…' : 'Draft this day'}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p style={{ fontSize: 13.5, color: colors.muted, margin: 0 }}>Pick a day to see or draft its post.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** The month laid out Monday-first, padded to whole weeks. */
function buildMonth(yyyymm: string): (string | null)[] {
  const first = new Date(`${yyyymm}-01T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7; // Sunday is 0 in JS; we start on Monday

  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${yyyymm}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const selectStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  padding: '0 10px',
  fontSize: 14,
  fontFamily: 'inherit',
  background: colors.surface,
};
