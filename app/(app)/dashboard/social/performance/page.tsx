/**
 * What is working — the desk reading its own page back.
 *
 * Everything else in Manage social decides what to make. This is the only
 * screen that says whether any of it worked, and it is deliberately not a
 * dashboard: there are no vanity totals, no follower chart, no "engagement
 * rate". There are two questions, and they are the only two worth a screen.
 *
 * **Which of our own posts travelled, and how far past our own normal?** Raw
 * reach is meaningless without that baseline — 4,000 views is a triumph on one
 * account and a quiet Tuesday on another — so every row is a multiple over
 * this account's own median, and the worst five are shown next to the best
 * because the failures are the more useful half.
 *
 * **And what does the profile they all land on look like to a stranger?**
 * Scored out of 100 against a fixed rubric, worst item first, with the
 * rewrites written out rather than described.
 *
 * The numbers are read by the backend from the network's own insights, which
 * cost nothing. Nothing here is editable: it is what happened.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import {
  socialApi,
  type SocialPageRead,
  type SocialProfileAudit,
  type SocialRankedPost,
  type SocialReview,
  type SocialReviewFinding,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';

export default function PerformancePage() {
  const { path } = useWorkspace();
  const [read, setRead] = useState<SocialPageRead | null>(null);
  const [audit, setAudit] = useState<SocialProfileAudit | null>(null);
  const [review, setReview] = useState<SocialReview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Both documents are written by the scheduled jobs as well as by the buttons
  // here, so they are watched rather than fetched — press "read it now" and the
  // page fills in when the job finishes, without anybody reloading.
  useEffect(() => {
    const a = onSnapshot(doc(db, path('socialInsights/latest')), (snap) => {
      setRead(snap.exists() ? (snap.data() as SocialPageRead) : null);
    });
    const b = onSnapshot(doc(db, path('socialInsights/profile')), (snap) => {
      setAudit(snap.exists() ? (snap.data() as SocialProfileAudit) : null);
    });
    const c = onSnapshot(doc(db, path('socialInsights/review')), (snap) => {
      setReview(snap.exists() ? (snap.data() as SocialReview) : null);
    });
    return () => {
      a();
      b();
      c();
    };
  }, [path]);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 980 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>What is working</h1>
        <p style={{ fontSize: 13, color: colors.muted, margin: '6px 0 0', lineHeight: 1.55, maxWidth: 680 }}>
          Our own posts, ranked by how far each one went past this account&rsquo;s own normal — not by raw
          views, which say more about how old a post is than about whether it was any good. The team reads this
          before standup, so the next piece is argued in front of what our audience actually did.
        </p>
      </header>

      {error ? (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: '#ff6b6b' }}>{error}</p>
        </Card>
      ) : null}

      {/* ── the five-day review: the desk marking its own work ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={h2}>The last five days</h2>
          <Button onClick={() => run('review', () => socialApi.selfReview({}))} disabled={busy === 'review'}>
            {busy === 'review' ? 'Working through it…' : 'Review now'}
          </Button>
        </div>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '6px 0 12px', lineHeight: 1.5 }}>
          Every five days the desk marks its own work: was the job done, did the reach come and if not why, is
          the ad money the right size, and what is somebody else doing better. You do not have to act on any of
          it &mdash; what the numbers showed goes into the team&rsquo;s instructions by itself.
        </p>

        {!review ? (
          <Empty>
            Not reviewed yet. The first one runs five days after the desk starts, and the button above does it
            now.
          </Empty>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 34, fontWeight: 900, color: scoreTone(review.score) }}>{review.score}</span>
              <span style={{ fontSize: 13, color: colors.muted }}>
                / 100 &middot;{' '}
                {review.previousScore === null
                  ? 'the first one, so nothing to compare with'
                  : `${review.score - review.previousScore >= 0 ? '+' : ''}${review.score - review.previousScore} against last time`}{' '}
                &middot; {new Date(review.atMs).toLocaleDateString()}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                margin: '14px 0',
              }}
            >
              <Tile
                label="Went out"
                value={`${review.delivery.published}${review.delivery.expected ? ` / ${review.delivery.expected}` : ''}`}
                note={
                  review.delivery.waiting
                    ? `${review.delivery.waiting} waiting for you`
                    : review.delivery.failed
                      ? `${review.delivery.failed} failed`
                      : `${review.windowDays - review.delivery.quietDays} of ${review.windowDays} days covered`
                }
              />
              <Tile
                label="Reach"
                value={review.reach.sampled ? review.reach.medianReach.toLocaleString() : '—'}
                note={
                  review.reach.trendPct === null
                    ? `${review.reach.sampled} posts measured`
                    : `${review.reach.trendPct >= 0 ? '+' : ''}${review.reach.trendPct}% on the five days before`
                }
                tone={review.reach.trendPct === null ? undefined : review.reach.trendPct >= 0 ? '#28c76f' : '#ff6b6b'}
              />
              <Tile
                label="Ad spend"
                value={
                  review.spend
                    ? `${review.spend.currency} ${Math.round(review.spend.spent).toLocaleString()}`
                    : 'None'
                }
                note={
                  review.spend
                    ? `${Math.round(review.spend.shouldHave).toLocaleString()} is what ${
                        review.spend.running === 1 ? 'it' : 'they'
                      } needed`
                    : 'no ad account connected'
                }
                tone={
                  review.spend && review.spend.shouldHave > 0 && review.spend.spent < review.spend.shouldHave * 0.6
                    ? '#ffd166'
                    : undefined
                }
              />
              <Tile
                label="Somebody else"
                value={review.competitors?.theirsPerK ? `${review.competitors.theirsPerK}/1k` : '—'}
                note={
                  review.competitors
                    ? review.competitors.oursPerK === null
                      ? 'ours not counted yet'
                      : `ours ${review.competitors.oursPerK}/1k followers`
                    : 'no handles to read'
                }
                tone={review.competitors?.ahead ? '#ff6b6b' : undefined}
              />
              {review.sales ? (
                <Tile
                  label="Leads closed"
                  value={`${review.sales.won}`}
                  note={
                    review.sales.waiting
                      ? `${review.sales.waiting} waiting for you on WhatsApp`
                      : `${review.sales.live} conversations live, ${review.sales.lost} lost`
                  }
                  tone={review.sales.waiting ? '#ff6b6b' : review.sales.won ? '#28c76f' : undefined}
                />
              ) : null}
            </div>

            {review.summary ? (
              <p style={{ fontSize: 13, lineHeight: 1.7, margin: '0 0 4px', whiteSpace: 'pre-line' }}>
                {review.summary}
              </p>
            ) : null}

            {review.findings.length ? (
              <div style={{ marginTop: 16 }}>
                <Label>What to fix, worst first</Label>
                {review.findings.map((f) => (
                  <FindingRow key={f.id} finding={f} />
                ))}
              </div>
            ) : null}

            {review.directives.doMore.length ||
            review.directives.stopDoing.length ||
            review.directives.fromIndustry.length ? (
              <div style={{ marginTop: 18 }}>
                <Label>What the team does differently from now on</Label>
                <p style={{ fontSize: 12, color: colors.muted, margin: '4px 0 8px', lineHeight: 1.5 }}>
                  Already in front of every employee on every job. Your own standing instructions still outrank
                  it.
                </p>
                <div
                  style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
                >
                  {review.directives.doMore.length ? (
                    <Pills title="Do more of" tone="#28c76f" items={review.directives.doMore} />
                  ) : null}
                  {review.directives.stopDoing.length ? (
                    <Pills title="Stop doing" tone="#ff6b6b" items={review.directives.stopDoing} />
                  ) : null}
                  {review.directives.fromIndustry.length ? (
                    <Pills
                      title="From businesses like yours"
                      tone="#ffd166"
                      items={review.directives.fromIndustry}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {review.history.length > 1 ? (
              <p style={{ fontSize: 12, color: colors.muted, margin: '16px 0 0' }}>
                Score each time: {review.history.map((h) => h.score).join(' → ')}
              </p>
            ) : null}

            {review.error ? (
              <p style={{ fontSize: 12, color: colors.muted, margin: '10px 0 0' }}>
                The numbers above are measured; the words were written without the model this time (
                {review.error}).
              </p>
            ) : null}
          </>
        )}
      </Card>

      {/* ── the page read ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={h2}>Our own posts</h2>
          <Button onClick={() => run('read', () => socialApi.readOwnPage({}))} disabled={busy === 'read'}>
            {busy === 'read' ? 'Reading…' : 'Read it now'}
          </Button>
        </div>

        {!read ? (
          <Empty>Nothing read yet. The team reads the page every morning once automation is on.</Empty>
        ) : read.error ? (
          <Empty>{read.error}</Empty>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: colors.muted, margin: '6px 0 14px' }}>
              {read.sampled} posts · median reach <strong>{read.medianReach.toLocaleString()}</strong> ·
              read {new Date(read.atMs).toLocaleDateString()}
            </p>

            {read.lessons.length ? (
              <div style={{ marginBottom: 16 }}>
                <Label>What we now know</Label>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.65 }}>
                  {read.lessons.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {read.useMore.length ? (
                <Pills title="Do more of" tone="#28c76f" items={read.useMore} />
              ) : null}
              {read.useLess.length ? <Pills title="Stop doing" tone="#ff6b6b" items={read.useLess} /> : null}
            </div>

            {read.best.length ? (
              <div style={{ marginTop: 18 }}>
                <Label>Travelled furthest</Label>
                {read.best.map((p) => (
                  <PostRow key={p.mediaId} post={p} />
                ))}
              </div>
            ) : null}

            {read.worst.length ? (
              <div style={{ marginTop: 18 }}>
                <Label>Went nowhere — the more useful half</Label>
                {read.worst.map((p) => (
                  <PostRow key={p.mediaId} post={p} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </Card>

      {/* ── the profile audit ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={h2}>The profile</h2>
          <Button onClick={() => run('audit', () => socialApi.auditProfile({}))} disabled={busy === 'audit'}>
            {busy === 'audit' ? 'Scoring…' : 'Score it now'}
          </Button>
        </div>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '6px 0 12px', lineHeight: 1.5 }}>
          What somebody who arrived from one reel processes before they decide to follow. Scored weekly against
          a twelve-point rubric, worst first — which is the order to fix them in.
        </p>

        {!audit ? (
          <Empty>Not scored yet.</Empty>
        ) : audit.error ? (
          <Empty>{audit.error}</Empty>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 34, fontWeight: 900, color: scoreTone(audit.score) }}>{audit.score}</span>
              <span style={{ fontSize: 13, color: colors.muted }}>
                / 100 · {audit.profile?.username ?? 'the account'} ·{' '}
                {audit.profile?.followers?.toLocaleString() ?? '—'} followers
              </span>
            </div>

            {audit.items.map((item) => (
              <div
                key={item.id}
                style={{ padding: '9px 0', borderTop: `1px solid ${colors.border}`, fontSize: 13 }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span
                    style={{
                      fontWeight: 900,
                      minWidth: 52,
                      color: scoreTone((item.scored / Math.max(item.outOf, 1)) * 100),
                    }}
                  >
                    {item.scored}/{item.outOf}
                  </span>
                  <span style={{ fontWeight: 700 }}>{item.label}</span>
                </div>
                {item.why ? (
                  <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 2, paddingLeft: 62 }}>
                    {item.why}
                  </div>
                ) : null}
                {item.fix ? (
                  <div style={{ fontSize: 12.5, marginTop: 3, paddingLeft: 62 }}>→ {item.fix}</div>
                ) : null}
              </div>
            ))}

            {audit.rewrites.length ? (
              <div style={{ marginTop: 18 }}>
                <Label>Ready to paste</Label>
                {audit.rewrites.map((r) => (
                  <div
                    key={r.field}
                    style={{
                      marginTop: 8,
                      padding: 10,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 9,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>
                      {r.field.toUpperCase()}
                    </div>
                    {r.now ? (
                      <div style={{ color: colors.muted, textDecoration: 'line-through', marginTop: 4 }}>
                        {r.now}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 4, fontWeight: 600 }}>{r.better}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

/** One post, with the multiple doing the talking rather than the raw reach. */
function PostRow({ post }: { post: SocialRankedPost }) {
  return (
    <div style={{ padding: '9px 0', borderTop: `1px solid ${colors.border}`, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 900, color: post.multiple >= 1.5 ? '#28c76f' : colors.muted, minWidth: 54 }}>
          {post.multiple}x
        </span>
        <span style={{ flex: 1, minWidth: 220 }}>
          {post.permalink ? (
            <a href={post.permalink} target="_blank" rel="noreferrer" style={{ color: colors.text }}>
              {post.hook || '(no caption)'}
            </a>
          ) : (
            post.hook || '(no caption)'
          )}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: colors.muted, marginTop: 3, paddingLeft: 64 }}>
        {post.reach.toLocaleString()} reached · {post.sends} sends ({post.sendRate}/1k) · {post.saves} saves (
        {post.saveRate}/1k) · {post.comments} comments · hook {post.hookScore}/100
      </div>
    </div>
  );
}

/** One number from the review, with what it is measured against under it. */
function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 9, padding: '9px 11px' }}>
      <Label>{label}</Label>
      <div style={{ fontSize: 19, fontWeight: 900, marginTop: 2, color: tone ?? colors.text }}>{value}</div>
      <div style={{ fontSize: 11.5, color: colors.muted, marginTop: 2, lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}

/** One shortcoming: what, the numbers behind it, and whose move it is. */
function FindingRow({ finding }: { finding: SocialReviewFinding }) {
  const tone = finding.severity === 'blocking' ? '#ff6b6b' : finding.severity === 'big' ? '#ffd166' : colors.muted;
  return (
    <div style={{ padding: '9px 0', borderTop: `1px solid ${colors.border}`, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 900, color: tone, minWidth: 58, textTransform: 'uppercase' }}>
          {finding.severity === 'blocking' ? 'stops it' : finding.severity}
        </span>
        <span style={{ flex: 1, minWidth: 220, fontWeight: 700 }}>{finding.what}</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: finding.who === 'you' ? '#ffd166' : '#28c76f' }}>
          {finding.who === 'you' ? 'NEEDS YOU' : 'VEXA HANDLES IT'}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 3, paddingLeft: 66, lineHeight: 1.5 }}>
        {finding.evidence}
      </div>
      <div style={{ fontSize: 12.5, marginTop: 3, paddingLeft: 66, lineHeight: 1.5 }}>&rarr; {finding.fix}</div>
    </div>
  );
}

function Pills({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div>
      <Label>{title}</Label>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: tone }}>
        {items.map((i) => (
          <li key={i} style={{ color: colors.text }}>
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>
    {String(children).toUpperCase()}
  </div>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: 13, color: colors.muted, margin: '8px 0 0', lineHeight: 1.55 }}>{children}</p>
);

const scoreTone = (n: number) => (n >= 70 ? '#28c76f' : n >= 45 ? '#ffd166' : '#ff6b6b');

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0 };
