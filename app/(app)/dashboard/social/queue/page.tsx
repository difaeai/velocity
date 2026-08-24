'use client';

/**
 * Manage social → Approval queue.
 *
 * The gate between four agents and the whole audience. Nothing this desk makes
 * reaches a network without passing through this screen, so everything the crew
 * produced is here in full — the concept they agreed at standup, the hook, the
 * frames, the slides or the video, the per-network captions, and the numbers
 * the script was written from. Approving a claim you cannot check is the exact
 * failure this feature has to avoid.
 *
 * Four things you can do with a draft, and they are deliberately different
 * weights:
 *
 *   Approve         — it is right. Post it now, or mark it ready for later.
 *   Ask for changes — say what is wrong; only the stages you name re-run.
 *   Reject          — not this one. It stays readable, it just never goes out.
 *   Delete          — as if it never happened.
 *
 * The caption is editable in place, because the common case is a good post with
 * one phrase you would rather word differently, and re-running the crew for
 * that wastes a render.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { colors } from '@/lib/config';
import {
  postAssets,
  socialApi,
  type SocialPlatform,
  type SocialPostDoc,
  type SocialRevision,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import {
  CrewLine,
  FormatChip,
  PLATFORM_META,
  PlatformBadge,
  StatusPill,
  longDate,
} from '@/components/social/shared';

const OPEN_STATES = [
  'planning',
  'researching',
  'drafting',
  'designing',
  'rendering',
  'awaiting_approval',
  'changes_requested',
  'ready',
  'failed',
  'partial',
];

const WORKING_STATES = ['planning', 'researching', 'drafting', 'designing', 'rendering', 'publishing'];

type ChangeScope = 'script' | 'design' | 'video' | 'caption';

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
            Everything the crew has made. Read it, check the numbers, then approve it — or tell them what to fix.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: 3,
          }}
        >
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
            {tab === 'open'
              ? 'Nothing waiting. The queue is clear.'
              : 'The crew has not made anything yet — brief them from the overview.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {shown.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({ post }: { post: SocialPostDoc }) {
  const [caption, setCaption] = useState(post.caption);
  const [targets, setTargets] = useState<SocialPlatform[]>(post.targets ?? []);
  const [feedback, setFeedback] = useState('');
  const [scope, setScope] = useState<ChangeScope[]>(['script']);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  /**
   * The document is live, so an edit in this box has to survive an unrelated
   * snapshot — but must be thrown away the moment the crew rewrites the thing
   * being edited. Adjusting during render (rather than in an effect) is React's
   * own answer to that: it re-renders before anything is painted, so the stale
   * value is never on screen.
   */
  const [serverCaption, setServerCaption] = useState(post.caption);
  if (post.caption !== serverCaption) {
    setServerCaption(post.caption);
    setCaption(post.caption);
  }
  const serverTargets = (post.targets ?? []).join(',');
  const [lastTargets, setLastTargets] = useState(serverTargets);
  if (serverTargets !== lastTargets) {
    setLastTargets(serverTargets);
    setTargets(post.targets ?? []);
  }

  const assets = postAssets(post);
  const working = WORKING_STATES.includes(post.status);
  const format = post.format ?? 'reel';

  async function run(label: string, fn: () => Promise<string | null>) {
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

  const approve = (publishNow: boolean) =>
    run(publishNow ? 'publish' : 'approve', async () => {
      const res = await socialApi.review({ postId: post.id, approve: true, caption, targets, publishNow });
      if (!publishNow) return 'Approved. It is ready whenever you want it out.';
      return `Posted to ${res.published ?? 0} network${res.published === 1 ? '' : 's'}${
        res.failed ? `, ${res.failed} failed — see below.` : '.'
      }`;
    });

  const askForChanges = () =>
    run('changes', async () => {
      if (feedback.trim().length < 3) throw new Error('Say what you want changed.');
      if (!scope.length) throw new Error('Pick what should be redone.');
      const res = await socialApi.requestChanges({ postId: post.id, feedback: feedback.trim(), scope });
      setFeedback('');
      return `Sent back to the crew. Re-running: ${res.reran.join(', ')}.`;
    });

  const reject = () => run('reject', async () => {
    await socialApi.review({ postId: post.id, approve: false });
    return 'Rejected. It stays here to read, but it will not go out.';
  });

  const remove = () =>
    run('delete', async () => {
      if (!confirm('Delete this post entirely?')) return null;
      await socialApi.deletePost({ postId: post.id });
      return null;
    });

  async function attach(file: File) {
    await run('attach', async () => {
      const kind = file.type.startsWith('video') ? 'video' : 'image';
      const path = `socialUploads/${post.id}-${Date.now()}-${file.name.replace(/[^\w.-]/g, '')}`;
      await uploadBytes(ref(storage, path), file);
      await socialApi.attachMedia({ postId: post.id, storagePath: path, kind });
      return `${kind === 'video' ? 'Video' : 'Image'} attached.`;
    });
  }

  return (
    <Card>
      {/* header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontWeight: 900, fontSize: 15 }}>{longDate(post.date)}</span>
        <FormatChip format={format} />
        <span style={{ fontSize: 12.5, color: colors.muted }}>{post.angle}</span>
        <span style={{ flex: 1 }} />
        <StatusPill status={post.status} />
      </div>

      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(220px, 300px) 1fr', alignItems: 'start' }}>
        {/* what they made */}
        <div style={{ display: 'grid', gap: 10 }}>
          <MediaPreview assets={assets} format={format} />
          <label
            style={{
              fontSize: 12,
              color: colors.muted,
              border: `1px dashed ${colors.border}`,
              borderRadius: 10,
              padding: '8px 10px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            {busy === 'attach' ? 'Uploading…' : 'Attach a file made elsewhere'}
            <input
              type="file"
              accept="video/*,image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void attach(file);
                e.target.value = '';
              }}
            />
          </label>

          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
            <CrewLine crew={post.crew} compact />
          </div>
        </div>

        {/* what they wrote */}
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          {post.plan?.concept ? (
            <div style={{ background: `${colors.primary}0a`, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: colors.primary, marginBottom: 3 }}>
                AGREED AT STANDUP
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{post.plan.concept}</div>
              {post.plan.why ? (
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{post.plan.why}</div>
              ) : null}
            </div>
          ) : null}

          {post.script ? (
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.3 }}>{post.script.hook}</div>
              {post.script.viralHook ? (
                <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 3 }}>
                  Why it should travel: {post.script.viralHook}
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: colors.muted }}>
              {working ? 'The crew is working on it…' : 'Nothing written yet.'}
            </div>
          )}

          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>CAPTION</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                marginTop: 4,
                padding: 10,
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: 'inherit',
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                resize: 'vertical',
              }}
            />
          </div>

          {/* where it goes */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 6 }}>POSTING TO</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(post.targets ?? []).length === 0 ? (
                <span style={{ fontSize: 12.5, color: colors.muted }}>
                  Nowhere yet — no connected account takes a {format}.
                </span>
              ) : null}
              {(post.targets ?? []).map((platform) => {
                const on = targets.includes(platform);
                const result = post.results?.[platform];
                return (
                  <button
                    key={platform}
                    onClick={() => setTargets(on ? targets.filter((t) => t !== platform) : [...targets, platform])}
                    title={result?.error ?? PLATFORM_META[platform].note}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: on ? `${colors.primary}12` : 'transparent',
                      border: `1px solid ${on ? colors.primary : colors.border}`,
                      color: on ? colors.primary : colors.muted,
                      borderRadius: 999,
                      padding: '4px 10px 4px 4px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <PlatformBadge platform={platform} size={20} />
                    {PLATFORM_META[platform].label}
                    {result ? <span>{result.ok ? '✓' : '✕'}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => setShowDetail(!showDetail)}
            style={{
              alignSelf: 'start',
              background: 'none',
              border: 'none',
              padding: 0,
              color: colors.secondary,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {showDetail ? 'Hide the working' : 'Show the working — script, numbers, sources, history'}
          </button>

          {showDetail ? <Working post={post} /> : null}
        </div>
      </div>

      {post.error ? (
        <p style={{ color: colors.danger, fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>{post.error}</p>
      ) : null}
      {error ? <p style={{ color: colors.danger, fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>{notice}</p> : null}

      {/* the four decisions */}
      <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 14, paddingTop: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={() => approve(true)} disabled={working || !!busy || assets.length === 0}>
            {busy === 'publish' ? 'Posting…' : 'Approve & post now'}
          </Button>
          <Button variant="secondary" onClick={() => approve(false)} disabled={working || !!busy}>
            Approve only
          </Button>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={reject} disabled={working || !!busy}>
            Reject
          </Button>
          <Button variant="danger" onClick={remove} disabled={!!busy}>
            Delete
          </Button>
        </div>

        <div style={{ background: colors.bg, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 6 }}>
            ASK FOR CHANGES — the crew reads this, and keeps reading it on every later version
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="e.g. the hook is generic, open on the driver's hands instead — and stop using the word seamless"
            style={{
              width: '100%',
              padding: 10,
              fontSize: 13,
              fontFamily: 'inherit',
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            {(['script', 'design', 'video', 'caption'] as ChangeScope[]).map((s) => {
              const on = scope.includes(s);
              const disabled = s === 'video' && format !== 'reel' && format !== 'video';
              return (
                <label
                  key={s}
                  style={{
                    display: 'flex',
                    gap: 5,
                    alignItems: 'center',
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: disabled ? colors.border : on ? colors.text : colors.muted,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on && !disabled}
                    disabled={disabled}
                    onChange={() => setScope(on ? scope.filter((x) => x !== s) : [...scope, s])}
                  />
                  Redo the {s}
                </label>
              );
            })}
            <span style={{ flex: 1 }} />
            <Button variant="secondary" onClick={askForChanges} disabled={working || !!busy}>
              {busy === 'changes' ? 'Sending back…' : 'Send back to the crew'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The video, or the slides, exactly as they will appear. */
function MediaPreview({
  assets,
  format,
}: {
  assets: ReturnType<typeof postAssets>;
  format: string;
}) {
  const vertical = format === 'reel' || format === 'story';
  const frame = {
    width: '100%',
    borderRadius: 12,
    background: '#1a1c1c',
    aspectRatio: vertical ? '9 / 16' : format === 'video' ? '16 / 9' : '4 / 5',
    objectFit: 'cover' as const,
    display: 'block' as const,
  };

  if (!assets.length) {
    return (
      <div style={{ ...frame, display: 'grid', placeItems: 'center', color: '#8a938e', fontSize: 12.5 }}>
        Nothing rendered yet
      </div>
    );
  }

  const video = assets.find((a) => a.kind === 'video');
  if (video?.url) return <video src={video.url} controls style={frame} />;

  const slides = assets.filter((a) => a.kind === 'image');
  if (slides.length === 1) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={slides[0].url ?? ''} alt={slides[0].alt} style={frame} />;
  }

  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
      {slides.map((slide) => (
        <div key={slide.slide} style={{ position: 'relative', flex: 'none', width: '72%' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.url ?? ''} alt={slide.alt} style={frame} />
          <span
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              background: '#000000a8',
              color: '#fff',
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {slide.slide}/{slides.length}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Everything behind the post: the script, the numbers, the sources, the history. */
function Working({ post }: { post: SocialPostDoc }) {
  const frames = post.script?.frames ?? [];
  const legacyBeats = post.script?.beats ?? [];

  return (
    <div style={{ display: 'grid', gap: 12, background: colors.bg, borderRadius: 10, padding: 12 }}>
      {post.script?.hookVariants?.length ? (
        <Section title="Other hooks the writer offered">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
            {post.script.hookVariants.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {frames.length || legacyBeats.length ? (
        <Section title={post.format === 'carousel' ? 'The slides' : 'The shots'}>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
            {frames.map((f, i) => (
              <li key={i}>
                {f.scene}
                {f.overlay ? <strong> — “{f.overlay}”</strong> : null}
              </li>
            ))}
            {frames.length === 0 ? legacyBeats.map((b, i) => <li key={i}>{b}</li>) : null}
          </ol>
        </Section>
      ) : null}

      {post.script?.voiceover ? (
        <Section title="Voiceover">
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>{post.script.voiceover}</p>
        </Section>
      ) : null}

      {post.captions && Object.keys(post.captions).length ? (
        <Section title="Caption, per network">
          <div style={{ display: 'grid', gap: 8 }}>
            {Object.entries(post.captions).map(([platform, text]) => (
              <div key={platform}>
                <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>
                  {PLATFORM_META[platform as SocialPlatform]?.label ?? platform}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{text}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {post.cut?.prompt ? (
        <Section title="The cut Raftar wrote">
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: colors.muted, whiteSpace: 'pre-wrap' }}>
            {post.cut.prompt}
          </p>
        </Section>
      ) : null}

      <Section title="The numbers this was written from">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(post.facts ?? {}).map(([key, value]) => (
            <span
              key={key}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '3px 8px',
                fontSize: 11.5,
              }}
            >
              <span style={{ color: colors.muted }}>{key}</span> <strong>{String(value)}</strong>
            </span>
          ))}
        </div>
      </Section>

      {post.research && !post.research.error ? (
        <Section title="What the market read found">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
            {post.research.trends.slice(0, 4).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {post.research.sources.length ? (
            <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {post.research.sources.slice(0, 8).map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11.5, color: colors.secondary }}
                >
                  {s.title.slice(0, 40)}
                </a>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {post.revisions?.length ? (
        <Section title="What you have already asked for">
          <div style={{ display: 'grid', gap: 6 }}>
            {post.revisions.map((r: SocialRevision, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <span style={{ color: colors.muted }}>{r.scope.join(' + ')}:</span> {r.feedback}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {Object.entries(post.results ?? {}).some(([, r]) => r && !r.ok) ? (
        <Section title="Networks that refused it">
          <div style={{ display: 'grid', gap: 4 }}>
            {Object.entries(post.results ?? {})
              .filter(([, r]) => r && !r.ok)
              .map(([platform, r]) => (
                <div key={platform} style={{ fontSize: 12.5, color: colors.danger }}>
                  <strong>{PLATFORM_META[platform as SocialPlatform]?.label ?? platform}:</strong> {r?.error}
                </div>
              ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 5 }}>
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}
