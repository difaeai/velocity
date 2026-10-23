'use client';

/**
 * Manage social → Content calendar.
 *
 * The month as the team plans it and as it actually went: the strategy on top
 * (goal, pillars, a theme per week, the paid campaigns and sales moves), and in
 * every square what is planned for that day and what was made. The daily run
 * follows the plan; a day without one falls back to the rotation.
 *
 * A day can hold several pieces (a reel and a carousel are different posts on
 * the same date), so a square carries one dot per made piece and one line per
 * planned one. Any day can be made on demand — from its plan, or by hand.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, onSnapshot, orderBy, query, limit } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import {
  SOCIAL_FORMATS,
  socialApi,
  type SocialFormat,
  type SocialMonthPlan,
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

type Slot = SocialMonthPlan['days'][string][number];

export default function CalendarPage() {
  const today = todayPkt();
  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // YYYY-MM
  /** Keyed by date, because one date can now hold several pieces. */
  const [posts, setPosts] = useState<Record<string, SocialPostDoc[]>>({});
  const [plan, setPlan] = useState<SocialMonthPlan | null>(null);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [angle, setAngle] = useState('');
  const [format, setFormat] = useState<SocialFormat | ''>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'socialPlans', cursor),
        (snap) => setPlan(snap.exists() ? (snap.data() as SocialMonthPlan) : null),
        () => setPlan(null),
      ),
    [cursor],
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

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const planIt = () =>
    run('plan', async () => {
      const res = await socialApi.planMonth({ month: cursor });
      return `The team planned ${res.days} days of ${monthLabel}. The daily run follows it from now on.`;
    });

  const make = (date: string, slot?: Slot) =>
    run(slot ? `${date}-${slot.format}` : 'make', async () => {
      const res = await socialApi.generate({
        date,
        replace: true,
        ...(slot
          ? {
              format: slot.format,
              brief: `${slot.topic}${slot.hook ? ` — open with: ${slot.hook}` : ''}`,
              ...(slot.pillar.length >= 2 ? { angle: slot.pillar.slice(0, 60) } : {}),
            }
          : { angle: angle || undefined, format: format || undefined }),
      });
      setAngle('');
      return `Made the ${FORMAT_META[res.format].label.toLowerCase()} for ${longDate(date)}. It is in the queue.`;
    });

  const selectedPosts = (selected ? posts[selected] : undefined) ?? [];
  const selectedPlan = (selected ? plan?.days[selected] : undefined) ?? [];
  const weekOf = (date: string) => Math.min(Math.floor((Number(date.slice(8)) - 1) / 7), (plan?.weeks.length ?? 1) - 1);

  return (
    <div>
      <header style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Content calendar</h1>
          <p style={{ color: colors.muted, margin: 0 }}>
            The month the team planned, and what it actually made. The daily run follows the plan.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            ←
          </Button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{monthLabel}</strong>
          <Button variant="ghost" onClick={() => shiftMonth(1)} aria-label="Next month">
            →
          </Button>
        </div>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, marginBottom: 14 }}>{notice}</p> : null}

      <Strategy plan={plan} month={monthLabel} busy={busy === 'plan'} onPlan={planIt} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card style={{ padding: 14, minWidth: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
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
                    minHeight: 92,
                    border: `1px solid ${selected === date ? colors.primary : colors.border}`,
                    background: date === today ? `${colors.primary}0D` : colors.surface,
                    borderRadius: 10,
                    padding: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 4,
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    minWidth: 0,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: date === today ? colors.primary : colors.text }}>
                      {Number(date.slice(8))}
                    </span>
                    {(posts[date] ?? []).slice(0, 4).map((post) => (
                      <span
                        key={post.id}
                        title={`${FORMAT_META[post.format ?? 'reel'].label} — ${post.status}`}
                        style={{ width: 7, height: 7, borderRadius: 999, background: STATUS_DOT[post.status] ?? colors.muted }}
                      />
                    ))}
                  </span>
                  {(plan?.days[date] ?? []).slice(0, 3).map((s) => (
                    <span
                      key={s.format}
                      title={s.topic}
                      style={{
                        fontSize: 10.5,
                        lineHeight: 1.3,
                        color: colors.text,
                        background: colors.bg,
                        borderRadius: 5,
                        padding: '2px 4px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <strong>{FORMAT_META[s.format].label}</strong> {s.topic}
                    </span>
                  ))}
                </button>
              ),
            )}
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14, fontSize: 11.5, color: colors.muted }}>
            {[
              ['Published', STATUS_DOT.published],
              ['Being made', STATUS_DOT.ready],
              ['Needs approval', STATUS_DOT.awaiting_approval],
              ['Failed', STATUS_DOT.failed],
            ].map(([label, color]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
                {label}
              </span>
            ))}
            <span>Grey lines = planned</span>
          </div>
        </Card>

        <Card style={{ minWidth: 0 }}>
          {selected ? (
            <div style={{ display: 'grid', gap: 14 }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{longDate(selected)}</h2>
              {plan?.weeks.length ? (
                <p style={{ fontSize: 12.5, color: colors.muted, margin: 0 }}>
                  Week theme: <strong style={{ color: colors.text }}>{plan.weeks[weekOf(selected)]?.theme}</strong>
                </p>
              ) : null}

              {selectedPlan.length ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={sectionLabel}>Planned</div>
                  {selectedPlan.map((s) => (
                    <div key={s.format} style={{ display: 'grid', gap: 5, padding: 10, borderRadius: 10, background: colors.bg }}>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <FormatChip format={s.format} />
                        {s.pillar ? <span style={{ fontSize: 11.5, color: colors.muted }}>{s.pillar}</span> : null}
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.4 }}>{s.topic}</span>
                      {s.hook ? <span style={{ fontSize: 12.5, color: colors.muted }}>Hook: “{s.hook}”</span> : null}
                      <Button
                        variant="secondary"
                        onClick={() => make(selected, s)}
                        disabled={busy !== null}
                      >
                        {busy === `${selected}-${s.format}` ? 'The team is working…' : 'Make this now'}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedPosts.length ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={sectionLabel}>Made</div>
                  {selectedPosts.map((post) => (
                    <Link
                      key={post.id}
                      href={`/dashboard/social/queue?open=${post.id}`}
                      style={{ display: 'grid', gap: 6, color: 'inherit' }}
                    >
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <FormatChip format={post.format} />
                        <StatusPill status={post.status} />
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.4 }}>{postSummary(post)}</span>
                    </Link>
                  ))}
                </div>
              ) : null}

              <details>
                <summary style={{ fontSize: 12.5, color: colors.secondary, cursor: 'pointer', fontWeight: 700 }}>
                  Make something else for this day
                </summary>
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  <FormatPicker value={format} onChange={setFormat} />
                  <AnglePicker value={angle} onChange={setAngle} angles={settings?.angles ?? []} />
                  <Button onClick={() => make(selected)} disabled={busy !== null}>
                    {busy === 'make' ? 'The team is working…' : 'Make one'}
                  </Button>
                </div>
              </details>
            </div>
          ) : (
            <p style={{ fontSize: 13.5, color: colors.muted, margin: 0 }}>
              Pick a day to see its plan, what was made, or to make something for it.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** The month's strategy in one card — or the button that writes it. */
function Strategy({
  plan,
  month,
  busy,
  onPlan,
}: {
  plan: SocialMonthPlan | null;
  month: string;
  busy: boolean;
  onPlan: () => void;
}) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: plan ? 12 : 0 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Strategy for {month}</h2>
          <p style={{ fontSize: 12.5, color: colors.muted, margin: 0, lineHeight: 1.5 }}>
            {plan
              ? `Planned by ${plan.by} on ${new Date(plan.atMs).toLocaleDateString('en-GB')}.`
              : 'No plan yet. The team writes one on the first run of the month — or now, if you ask.'}
          </p>
        </div>
        <Button variant={plan ? 'ghost' : 'primary'} onClick={onPlan} disabled={busy}>
          {busy ? 'The team is planning…' : plan ? 'Plan it again' : 'Plan this month'}
        </Button>
      </div>

      {plan ? (
        <div style={{ display: 'grid', gap: 14 }}>
          {plan.goal ? (
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0, lineHeight: 1.5 }}>🎯 {plan.goal}</p>
          ) : null}
          {plan.pillars.length ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {plan.pillars.map((p) => (
                <span
                  key={p}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: `${colors.primary}14`,
                    color: colors.primary,
                  }}
                >
                  {p}
                </span>
              ))}
            </div>
          ) : null}
          {plan.weeks.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
              {plan.weeks.map((w, i) => (
                <div key={i} style={{ background: colors.bg, borderRadius: 10, padding: 10 }}>
                  <div style={sectionLabel}>Week {i + 1}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, margin: '2px 0' }}>{w.theme}</div>
                  <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.45 }}>{w.focus}</div>
                </div>
              ))}
            </div>
          ) : null}
          {plan.ads.length || plan.sales.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              {plan.ads.length ? <Moves title="💸 Paid campaigns this month" items={plan.ads} /> : null}
              {plan.sales.length ? <Moves title="🤝 Sales moves this month" items={plan.sales} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Moves({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 12.5, lineHeight: 1.5 }}>
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
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

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: colors.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const selectStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  padding: '0 10px',
  fontSize: 14,
  fontFamily: 'inherit',
  background: colors.surface,
};
