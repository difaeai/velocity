'use client';

/**
 * Manage social → Content & calendar → Calendar.
 *
 * The month as the team plans it and as it actually went: the strategy on top
 * (goal, pillars, a theme per week, the paid campaigns and sales moves), and in
 * every square what is planned for that day and what was made. The daily run
 * follows the plan; a day without one falls back to the rotation.
 *
 * A day can hold several pieces (a reel and a carousel are different posts on
 * the same date), so a square carries one dot per made piece and one line per
 * planned one. Any day can be made on demand — from its plan, or by hand.
 *
 * With the calendar kept made ahead (a Studio workspace's 30 days), this is
 * also where the owner reads the month before it goes out: any made piece can
 * be approved or sent back with changes right here, any planned one rewritten
 * before it is made, and the posting time is set in the owner's own clock.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, onSnapshot, orderBy, query, limit } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import {
  SOCIAL_FORMATS,
  postAssets,
  socialApi,
  type SocialFormat,
  type SocialMonthPlan,
  type SocialPostDoc,
  type SocialSettings,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { FORMAT_META, FormatChip, StatusPill, longDate, postSummary } from '@/components/social/shared';
import { PostingTime, localHourLabel } from '@/components/social/launch';
import { ContentTabs } from '@/components/social/contentTabs';

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
  const { path } = useWorkspace();
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
        query(collection(db, path('socialPosts')), orderBy('date', 'desc'), limit(120)),
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
    [path],
  );

  useEffect(
    () =>
      onSnapshot(
        doc(db, path(`socialPlans/${cursor}`)),
        (snap) => setPlan(snap.exists() ? (snap.data() as SocialMonthPlan) : null),
        () => setPlan(null),
      ),
    [cursor, path],
  );

  useEffect(() => {
    socialApi.getSettings({}).then((r) => setSettings(r.settings)).catch(() => undefined);
  }, [path]);

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

  const setHour = (runHour: number) =>
    run('hour', async () => {
      const res = await socialApi.updateSettings({ runHour });
      setSettings(res.settings);
      return `Posts now go out at ${localHourLabel(runHour)} your time — the whole month moves with it.`;
    });

  const selectedPosts = (selected ? posts[selected] : undefined) ?? [];
  // A planned piece that has been made shows once, as the made piece.
  const selectedPlan = ((selected ? plan?.days[selected] : undefined) ?? []).filter(
    (s) => !selectedPosts.some((p) => (p.format ?? 'reel') === s.format),
  );
  const weekOf = (date: string) => Math.min(Math.floor((Number(date.slice(8)) - 1) / 7), (plan?.weeks.length ?? 1) - 1);
  const ahead = settings?.makeAheadDays ?? 0;
  const madeAhead = Object.entries(posts).filter(([date]) => date > today).reduce((n, [, list]) => n + list.length, 0);

  return (
    <div>
      <ContentTabs active="calendar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            ←
          </Button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{monthLabel}</strong>
          <Button variant="ghost" onClick={() => shiftMonth(1)} aria-label="Next month">
            →
          </Button>
        </div>
      </ContentTabs>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, marginBottom: 14 }}>{notice}</p> : null}

      {settings ? (
        <Card style={{ marginBottom: 16, padding: 14 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <PostingTime settings={settings} disabled={busy !== null} onPick={setHour} />
            <span style={{ fontSize: 12.5, color: colors.muted, flex: 1, minWidth: 220 }}>
              {ahead
                ? `${
                    settings.batchUntil
                      ? `The team is making the next ${ahead} days in one go — ${madeAhead} pieces made so far.`
                      : settings.calendarUntil
                        ? `The calendar is made until ${settings.calendarUntil}; until then the team only posts. The next ${ahead} days are made when it runs low.`
                        : `The team makes ${ahead} days at a time, then only posts until the calendar runs low.`
                  } ${settings.autoPublish ? 'Each goes out on its day by itself.' : 'Approve any day below and it goes out on its day.'}`
                : 'Each day is made on its day, at this time.'}
            </span>
          </div>
        </Card>
      ) : null}

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
                    <PlannedSlot
                      key={s.format}
                      date={selected}
                      slot={s}
                      busy={busy}
                      onMake={() => make(selected, s)}
                      onEdit={(topic, hook) =>
                        run(`edit-${s.format}`, async () => {
                          await socialApi.editPlanSlot({ date: selected, format: s.format, topic, hook });
                          return `Changed what ${longDate(selected)} is about. The team makes it from your words.`;
                        })
                      }
                    />
                  ))}
                </div>
              ) : null}

              {selectedPosts.length ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={sectionLabel}>Made</div>
                  {selectedPosts.map((post) => (
                    <MadePiece key={post.id} post={post} runHour={settings?.runHour ?? 10} busy={busy} run={run} />
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

/** When a piece for `date` goes out: that Pakistan day at the desk hour. Mirrors `dueAtMs` in pipeline.ts. */
const dueAt = (date: string, runHour: number) => Date.parse(`${date}T00:00:00Z`) - 5 * 3600_000 + runHour * 3600_000;

const when = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** One planned piece not made yet: make it now, or change what the day is about before the team makes it. */
function PlannedSlot({
  date,
  slot,
  busy,
  onMake,
  onEdit,
}: {
  date: string;
  slot: Slot;
  busy: string | null;
  onMake: () => void;
  onEdit: (topic: string, hook: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(slot.topic);
  const [hook, setHook] = useState(slot.hook);
  return (
    <div style={{ display: 'grid', gap: 5, padding: 10, borderRadius: 10, background: colors.bg }}>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <FormatChip format={slot.format} />
        {slot.pillar ? <span style={{ fontSize: 11.5, color: colors.muted }}>{slot.pillar}</span> : null}
      </span>
      {editing ? (
        <>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            maxLength={240}
            aria-label="What this day is about"
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
          <input
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            maxLength={160}
            placeholder="The opening line (optional)"
            aria-label="The opening line"
            style={fieldStyle}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              onClick={() => {
                onEdit(topic.trim(), hook.trim());
                setEditing(false);
              }}
              disabled={busy !== null || topic.trim().length < 3}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.4 }}>{slot.topic}</span>
          {slot.hook ? <span style={{ fontSize: 12.5, color: colors.muted }}>Hook: “{slot.hook}”</span> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={onMake} disabled={busy !== null}>
              {busy === `${date}-${slot.format}` ? 'The team is working…' : 'Make this now'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setTopic(slot.topic);
                setHook(slot.hook);
                setEditing(true);
              }}
              disabled={busy !== null}
            >
              Change this day
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const WORKING = ['planning', 'researching', 'drafting', 'optimising', 'designing', 'rendering', 'publishing'];

/**
 * A finished piece in the day panel: look at it, approve it for its day, or
 * send it back with what to change — the words only, or the whole piece.
 */
function MadePiece({
  post,
  runHour,
  busy,
  run,
}: {
  post: SocialPostDoc;
  runHour: number;
  busy: string | null;
  run: (label: string, fn: () => Promise<string>) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState('');
  const [wordsOnly, setWordsOnly] = useState(false);
  const assets = postAssets(post);
  const image = assets.find((a) => a.kind === 'image' && a.url);
  const video = assets.find((a) => a.kind === 'video' && a.url);
  const ahead = post.date > todayPkt();
  const canApprove = post.status === 'awaiting_approval' && assets.length > 0;
  // A live piece is not reworked here: a new version could not replace what is already posted.
  const canChange = !WORKING.includes(post.status) && post.status !== 'published' && post.status !== 'partial';

  const approve = () =>
    run(`approve-${post.id}`, async () => {
      const res = await socialApi.review({ postId: post.id, approve: true, caption: post.caption, targets: post.targets, publishNow: true });
      return res.status === 'scheduled' && res.dueAtMs
        ? `Approved — it goes out ${when(res.dueAtMs)}.`
        : `Posted to ${res.published ?? 0} network${res.published === 1 ? '' : 's'}.`;
    });

  const change = () =>
    run(`change-${post.id}`, async () => {
      if (feedback.trim().length < 3) throw new Error('Say what you want changed.');
      await socialApi.requestChanges({ postId: post.id, feedback: feedback.trim(), scope: [wordsOnly ? 'caption' : 'script'] });
      setFeedback('');
      return wordsOnly ? 'The words are rewritten — check them above.' : 'The team remade it with your changes — check it above.';
    });

  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 10, border: `1px solid ${colors.border}` }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <FormatChip format={post.format} />
        <StatusPill status={post.status} />
        {post.status === 'ready' && post.scheduled ? (
          <span style={{ fontSize: 11.5, color: colors.success, fontWeight: 800 }}>Goes out {when(dueAt(post.date, runHour))}</span>
        ) : null}
      </span>
      {video ? (
        <video
          src={video.url ?? undefined}
          muted
          playsInline
          controls
          preload="metadata"
          style={{ width: '100%', maxHeight: 280, borderRadius: 8, background: '#000' }}
        />
      ) : image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url ?? ''} alt={image.alt ?? ''} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 8 }} />
      ) : null}
      <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.4 }}>{postSummary(post)}</span>
      {post.caption ? (
        <span style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'auto' }}>
          {post.caption}
        </span>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {canApprove ? (
          <Button onClick={approve} disabled={busy !== null}>
            {busy === `approve-${post.id}` ? 'Approving…' : ahead ? 'Approve for its day' : 'Approve & post'}
          </Button>
        ) : null}
        <Link href={`/dashboard/social/queue?open=${post.id}`} style={{ fontSize: 12.5, fontWeight: 700, color: colors.secondary }}>
          Open in the queue →
        </Link>
      </div>
      {canChange ? (
        <details>
          <summary style={{ fontSize: 12.5, color: colors.secondary, cursor: 'pointer', fontWeight: 800 }}>Ask for changes</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Talk about the breakfast box, not the cakes. Make the first line a question."
              aria-label="What to change"
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
              <input type="checkbox" checked={wordsOnly} onChange={(e) => setWordsOnly(e.target.checked)} />
              Only the words — keep the picture or video
            </label>
            <Button variant="secondary" onClick={change} disabled={busy !== null || feedback.trim().length < 3}>
              {busy === `change-${post.id}` ? 'The team is on it…' : 'Send it back'}
            </Button>
          </div>
        </details>
      ) : null}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 13.5,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  background: colors.surface,
};

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
