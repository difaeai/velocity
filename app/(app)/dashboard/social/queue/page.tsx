'use client';

/**
 * Manage social → Approval queue.
 *
 * The gate between a machine-written post and 158k people. Everything the
 * pipeline produced is here in full — the hook, the shot list, the voiceover,
 * the caption, the video, and the numbers the script was written from — because
 * approving a claim you cannot check is the failure mode this whole feature has
 * to avoid.
 *
 * The caption is editable in place: the common case is a good post with one
 * phrase you'd rather word differently, and re-generating for that wastes a
 * render.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { socialApi, type SocialPlatform, type SocialPostDoc } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { PlatformBadge, PLATFORM_META, StatusPill, longDate } from '@/components/social/shared';

const OPEN_STATES = ['drafting', 'rendering', 'awaiting_approval', 'ready', 'failed', 'partial'];

export default function QueuePage() {
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'open' | 'all'>('open');

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'socialPosts'), orderBy('date', 'desc'), limit(60)),
        (snap) => setPosts(snap.docs.map((d) => ({ ...(d.data() as SocialPostDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [],
  );

  const shown = useMemo(
    () => (tab === 'open' ? posts.filter((p) => OPEN_STATES.includes(p.status)) : posts),
    [posts, tab],
  );

  return (
    <div>
      <header style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Approval queue</h1>
          <p style={{ color: colors.muted, margin: 0 }}>
            Read it, check the numbers, then let it out.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 3 }}>
          {(['open', 'all'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                border: 'none',
                background: t === tab ? `${colors.primary}14` : 'transparent',
                color: t === tab ? colors.primary : colors.muted,
                fontWeight: 800,
                fontSize: 12.5,
                padding: '6px 14px',
                borderRadius: 8,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}

      {shown.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>
            {tab === 'open' ? 'Nothing waiting. The queue is clear.' : 'No posts have been generated yet.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {shown.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({ post }: { post: SocialPostDoc }) {
  // Null means "not edited here yet", so the backend's caption keeps showing
  // while a post is still being written, and an admin's edit is never clobbered
  // by a later write to the same post.
  const [edited, setEdited] = useState<string | null>(null);
  const caption = edited ?? post.caption;
  const [targets, setTargets] = useState<SocialPlatform[]>(post.targets ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const canPublish = post.video?.url && ['ready', 'awaiting_approval', 'partial', 'failed'].includes(post.status);

  async function act(kind: 'approve' | 'reject' | 'publish' | 'delete') {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'reject') {
        await socialApi.review({ postId: post.id, approve: false });
        setMessage({ kind: 'ok', text: 'Rejected. It will not be posted.' });
      } else if (kind === 'approve') {
        await socialApi.review({ postId: post.id, approve: true, caption, targets });
        setMessage({ kind: 'ok', text: 'Approved. Publish when you are ready.' });
      } else if (kind === 'publish') {
        const r = await socialApi.review({ postId: post.id, approve: true, caption, targets, publishNow: true });
        setMessage(
          r.published
            ? { kind: 'ok', text: `Published to ${r.published} network${r.published === 1 ? '' : 's'}.` }
            : { kind: 'bad', text: 'Every network rejected it — see the per-network errors below.' },
        );
      } else {
        await socialApi.deletePost({ postId: post.id });
      }
    } catch (e) {
      setMessage({ kind: 'bad', text: e instanceof Error ? e.message : 'That did not work.' });
    } finally {
      setBusy(null);
    }
  }

  async function attach(file: File) {
    setBusy('attach');
    setMessage(null);
    setUploading(true);
    try {
      const path = `socialUploads/${post.id}-${Date.now()}.mp4`;
      await uploadBytes(ref(storage, path), file, { contentType: file.type || 'video/mp4' });
      await socialApi.attachVideo({ postId: post.id, storagePath: path });
      setMessage({ kind: 'ok', text: 'Video attached.' });
    } catch (e) {
      setMessage({ kind: 'bad', text: e instanceof Error ? e.message : 'The upload failed.' });
    } finally {
      setBusy(null);
      setUploading(false);
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <strong style={{ fontSize: 15 }}>{longDate(post.date)}</strong>
        <StatusPill status={post.status} />
        <span style={{ fontSize: 12, color: colors.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {post.angle}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={() => act('delete')} disabled={busy !== null}>
          Delete
        </Button>
      </div>

      {post.error ? (
        <p style={{ color: colors.danger, fontSize: 13, marginTop: 0 }}>{post.error}</p>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(240px, 1fr)', gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          {post.script ? (
            <>
              <h3 style={h3}>Hook</h3>
              <p style={{ fontSize: 17, fontWeight: 800, margin: '0 0 14px', lineHeight: 1.35 }}>{post.script.hook}</p>

              <h3 style={h3}>Shots</h3>
              <ol style={{ margin: '0 0 14px', paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6 }}>
                {post.script.beats.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ol>

              <h3 style={h3}>Voiceover</h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 14px' }}>{post.script.voiceover}</p>

              {post.script.onScreenText.length ? (
                <>
                  <h3 style={h3}>On screen</h3>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                    {post.script.onScreenText.map((t, i) => (
                      <span key={i} style={chip}>
                        {t}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}

              {post.script.rationale ? (
                <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 14px' }}>
                  Why this angle: {post.script.rationale}
                </p>
              ) : null}
            </>
          ) : (
            <p style={{ color: colors.muted, fontSize: 13.5 }}>No script yet.</p>
          )}

          <h3 style={h3}>Caption</h3>
          <textarea
            value={caption}
            onChange={(e) => setEdited(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              padding: 10,
              fontSize: 13.5,
              fontFamily: 'inherit',
              lineHeight: 1.5,
              resize: 'vertical',
            }}
          />

          {Object.keys(post.facts ?? {}).length ? (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: colors.muted }}>
                The numbers this was written from
              </summary>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12.5, marginTop: 8 }}>
                {Object.entries(post.facts).map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt style={{ color: colors.muted }}>{k}</dt>
                    <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </div>

        <div style={{ minWidth: 0 }}>
          <h3 style={h3}>Video</h3>
          {post.video?.url ? (
            <video
              src={post.video.url}
              controls
              style={{ width: '100%', borderRadius: 12, background: '#000', aspectRatio: post.video.aspect === '16:9' ? '16 / 9' : '9 / 16' }}
            />
          ) : (
            <div
              style={{
                border: `1px dashed ${colors.border}`,
                borderRadius: 12,
                padding: 18,
                textAlign: 'center',
                color: colors.muted,
                fontSize: 13,
              }}
            >
              {post.status === 'rendering' ? 'Rendering…' : 'No video yet.'}
            </div>
          )}

          <label style={{ display: 'block', marginTop: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Attach a video</span>
            <input
              type="file"
              accept="video/*"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void attach(file);
                e.target.value = '';
              }}
              style={{ display: 'block', marginTop: 6, fontSize: 12.5, width: '100%' }}
            />
            {uploading ? (
              <span style={{ fontSize: 12, color: colors.muted }}>Uploading…</span>
            ) : (
              <span style={{ fontSize: 12, color: colors.muted }}>
                Up to 200 MB. Use this for anything made outside the pipeline.
              </span>
            )}
          </label>

          <h3 style={{ ...h3, marginTop: 18 }}>Post to</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {(Object.keys(PLATFORM_META) as SocialPlatform[]).map((p) => {
              const result = post.results?.[p];
              const checked = targets.includes(p);
              return (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setTargets((t) => (e.target.checked ? [...t, p] : t.filter((x) => x !== p)))
                    }
                    id={`${post.id}-${p}`}
                  />
                  <PlatformBadge platform={p} size={20} />
                  <label htmlFor={`${post.id}-${p}`} style={{ fontSize: 13, flex: 1, cursor: 'pointer' }}>
                    {PLATFORM_META[p].label}
                  </label>
                  {result ? (
                    result.ok ? (
                      <a
                        href={result.url ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 11.5, fontWeight: 700, color: colors.success }}
                      >
                        Posted ↗
                      </a>
                    ) : (
                      <span title={result.error ?? ''} style={{ fontSize: 11.5, fontWeight: 700, color: colors.danger }}>
                        Failed
                      </span>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>

          {Object.entries(post.results ?? {}).some(([, r]) => r && !r.ok) ? (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: colors.danger }}>
              {Object.entries(post.results ?? {})
                .filter(([, r]) => r && !r.ok)
                .map(([p, r]) => (
                  <li key={p}>
                    <strong>{PLATFORM_META[p as SocialPlatform].label}:</strong> {r?.error}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      </div>

      {message ? (
        <p style={{ fontSize: 13, marginTop: 14, marginBottom: 0, color: message.kind === 'ok' ? colors.success : colors.danger }}>
          {message.text}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <Button onClick={() => act('publish')} disabled={busy !== null || !canPublish || targets.length === 0}>
          {busy === 'publish' ? 'Publishing…' : 'Approve and publish now'}
        </Button>
        <Button variant="secondary" onClick={() => act('approve')} disabled={busy !== null}>
          Approve only
        </Button>
        <Button variant="ghost" onClick={() => act('reject')} disabled={busy !== null}>
          Reject
        </Button>
      </div>
    </Card>
  );
}

const h3: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: colors.muted,
  margin: '0 0 6px',
};

const chip: React.CSSProperties = {
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: '4px 9px',
  fontSize: 12,
  fontWeight: 700,
};
