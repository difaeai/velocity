'use client';

/**
 * Manage social → Content calendar.
 *
 * A month at a glance: what went out, what is waiting, and which days are
 * empty. The gaps are the point — a channel that quietly skipped four days is
 * invisible in a list and obvious in a grid.
 *
 * A day can hold several pieces now (a reel and a carousel are different posts
 * on the same date), so a square carries one dot per piece rather than one dot
 * per day. Any day can be briefed on demand, with the format and angle chosen
 * by hand, which is how you get ahead of a launch or a holiday instead of
 * taking whatever the rotation happens to land on.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import {
  SOCIAL_FORMATS,
  socialApi,
  type SocialFormat,
  type SocialPostDoc,
  type SocialSettings,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { FORMAT_META, FormatChip, StatusPill, longDate, postSummary } from '@/components/social/shared';

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
  changes_requested: '#eb6834',
  planning: '#2a78d6',
  researching: '#2a78d6',
  drafting: '#2a78d6',
  designing: '#2a78d6',
  rendering: '#2a78d6',
  publishing: '#2a78d6',
  failed: '#d03b3b',
  rejected: '#898781',
};

export default function CalendarPage() {
  const today = todayPkt();
  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // YYYY-MM
  /** Keyed by date, because one date can now hold several pieces. */
  const [posts, setPosts] = useState<Record<string, SocialPostDoc[]>>({});
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [angle, setAngle] = useState('');
  const [format, setFormat] = useState<SocialFormat | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'socialPosts'), orderBy('date', 'desc'), limit(120)),
        (snap) => {
          const next: Record<string, SocialPostDoc[]> = {};
          snap.docs.forEach((d) => {
            const post = { ...(d.data() as SocialPostDoc), id: d.id };
            (next[post.date] ??= []).push(post);
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
      await socialApi.generate({
        date,
        angle: angle || undefined,
        format: format || undefined,
        replace: true,
      });
      setAngle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate that post.');
    } finally {
      setBusy(false);
    }
  }

  const selectedPosts = (selected ? posts[selected] : undefined) ?? [];

  return (
    <div>
      <header style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Content calendar</h1>
          <p style={{ color: colors.muted, margin: 0 }}>
            Everything the crew has made, by the day it belongs to. The empty squares are the ones to worry about.
          </p>
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
                  <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {(posts[date] ?? []).slice(0, 4).map((post) => (
                      <span
                        key={post.id}
                        title={`${FORMAT_META[post.format ?? 'reel'].label} — ${post.status}`}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: STATUS_DOT[post.status] ?? colors.muted,
                        }}
                      />
                    ))}
                  </span>
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
              {selectedPosts.length ? (
                <div style={{ display: 'grid', gap: 14 }}>
                  {selectedPosts.map((post) => (
                    <div key={post.id} style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <FormatChip format={post.format} />
                        <StatusPill status={post.status} />
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: colors.muted,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                        }}
                      >
                        {post.angle}
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 700, margin: 0, lineHeight: 1.4 }}>
                        {postSummary(post)}
                      </p>
                      {post.caption ? (
                        <p style={{ fontSize: 13, color: colors.muted, margin: 0, lineHeight: 1.5 }}>
                          {post.caption}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  <Link href="/dashboard/social/queue">
                    <Button variant="secondary">Open in the queue</Button>
                  </Link>
                  <details>
                    <summary style={{ fontSize: 12.5, color: colors.secondary, cursor: 'pointer', fontWeight: 700 }}>
                      Add another piece to this day
                    </summary>
                    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                      <FormatPicker value={format} onChange={setFormat} />
                      <AnglePicker value={angle} onChange={setAngle} angles={settings?.angles ?? []} />
                      <Button onClick={() => generate(selected)} disabled={busy}>
                        {busy ? 'The crew is working…' : 'Brief the crew'}
                      </Button>
                    </div>
                  </details>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <p style={{ fontSize: 13.5, color: colors.muted, margin: 0 }}>
                    Nothing here. Brief the crew — pick a format and an angle, or leave both to the rotation.
                  </p>
                  <FormatPicker value={format} onChange={setFormat} />
                  <AnglePicker value={angle} onChange={setAngle} angles={settings?.angles ?? []} />
                  <Button onClick={() => generate(selected)} disabled={busy}>
                    {busy ? 'The crew is working…' : 'Brief the crew'}
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

function FormatPicker({
  value,
  onChange,
}: {
  value: SocialFormat | '';
  onChange: (v: SocialFormat | '') => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as SocialFormat | '')} style={selectStyle}>
      <option value="">Next format in the rotation</option>
      {SOCIAL_FORMATS.map((f) => (
        <option key={f} value={f}>
          {FORMAT_META[f].label}
        </option>
      ))}
    </select>
  );
}

function AnglePicker({
  value,
  onChange,
  angles,
}: {
  value: string;
  onChange: (v: string) => void;
  angles: string[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
      <option value="">Next angle in the rotation</option>
      {angles.map((a) => (
        <option key={a} value={a}>
          {a}
        </option>
      ))}
    </select>
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
