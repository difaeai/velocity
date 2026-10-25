'use client';

/**
 * Manage social → Content & calendar → Everything made (the approval queue).
 *
 * The gate between the team and the whole audience. Nothing this desk makes
 * reaches a network without passing through this screen, so everything they
 * produced is here in full — who did what, the concept they agreed at standup,
 * the hook, the slides or the video, the search work, the campaign brief, the
 * per-network captions, and the numbers the script was written from. Approving
 * a claim you cannot check is the exact failure this feature has to avoid.
 *
 * Four things you can do with a draft, and they are deliberately different
 * weights:
 *
 *   Approve & post  — it is right, so it goes out. There is no "approve and
 *                     wait": approved pieces are posted by a five-minute sweep
 *                     even if this tab is closed mid-post.
 *   Ask for changes — say what is wrong; the team rewrites it and makes the
 *                     picture or video again. "Only the caption" is the quick
 *                     path that touches nothing else.
 *   Reject          — not this one. It stays readable, it just never goes out.
 *   Delete          — as if it never happened.
 *
 * The caption is editable in place, because the common case is a good piece
 * with one phrase you would rather word differently, and calling the whole team
 * back for that wastes a render.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import {
  postAssets,
  socialApi,
  type SocialPlatform,
  type SocialPostDoc,
  type SocialPostStatus,
  type SocialResearch,
  type SocialRevision,
} from '@/lib/api';
import { ContentTabs } from '@/components/social/contentTabs';
import { ViralFinds } from '@/components/social/dashboard';
import { FX_CSS } from '@/components/social/fx';
import { Button, Card } from '@/components/ui';
import {
  FormatChip,
  PLATFORM_META,
  PlatformBadge,
  ROLE_META,
  StatusPill,
  WorkLine,
  longDate,
} from '@/components/social/shared';

/**
 * Where a piece is, as five shelves. One long column of full cards was the old
 * page, and at a piece or two a day it became unreadable within a week.
 */
type Shelf = 'needs' | 'making' | 'going' | 'live' | 'all';
const SHELVES: { key: Shelf; label: string; states: SocialPostStatus[] | null; empty: string }[] = [
  {
    key: 'needs',
    label: 'Needs you',
    states: ['awaiting_approval', 'changes_requested', 'failed', 'partial'],
    empty: 'Nothing waiting on you.',
  },
  {
    key: 'making',
    label: 'Being made',
    states: ['planning', 'researching', 'drafting', 'optimising', 'designing', 'rendering'],
    empty: 'The team is not working on anything right now.',
  },
  { key: 'going', label: 'Going out', states: ['ready', 'publishing'], empty: 'Nothing is being posted right now.' },
  { key: 'live', label: 'Live', states: ['published'], empty: 'Nothing has gone out yet.' },
  { key: 'all', label: 'All', states: null, empty: 'The team has not made anything yet — ask for something on the overview.' },
];

const PAGE = 30;

const WORKING_STATES = [
  'planning',
  'researching',
  'drafting',
  'optimising',
  'designing',
  'rendering',
  'publishing',
];

export default function QueuePage() {
  const { path } = useWorkspace();
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shelf, setShelf] = useState<Shelf>('needs');
  const [openId, setOpenId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(PAGE);
  const [research, setResearch] = useState<SocialResearch | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('socialResearch')), orderBy('date', 'desc'), limit(1)),
        (snap) => setResearch(snap.empty ? null : (snap.docs[0].data() as SocialResearch)),
        () => setResearch(null),
      ),
    [path],
  );

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('socialPosts')), orderBy('date', 'desc'), limit(pageSize)),
        (snap) => setPosts(snap.docs.map((d) => ({ ...(d.data() as SocialPostDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [pageSize, path],
  );

  // `?open=<id>` from the overview opens that piece on the shelf that shows it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('open');
    if (!id) return;
    const t = setTimeout(() => {
      setOpenId(id);
      setShelf('all');
    }, 0);
    return () => clearTimeout(t);
  }, [path]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        SHELVES.map((s) => [s.key, s.states ? posts.filter((p) => s.states!.includes(p.status)).length : posts.length]),
      ) as Record<Shelf, number>,
    [posts],
  );
  const opened = posts.find((p) => p.id === openId) ?? null;
  const current = SHELVES.find((s) => s.key === shelf)!;
  const shown = useMemo(
    () => (current.states ? posts.filter((p) => current.states!.includes(p.status)) : posts),
    [posts, current],
  );

  return (
    <div className="fx">
      <style>{FX_CSS}</style>
      <ContentTabs active="content" />

      <div role="tablist" aria-label="Pieces by where they are" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {SHELVES.map((s) => {
          const on = s.key === shelf;
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={on}
              onClick={() => setShelf(s.key)}
              style={{
                border: `1px solid ${on ? colors.primary : colors.border}`,
                background: on ? `${colors.primary}14` : colors.surface,
                color: on ? colors.primary : colors.text,
                fontWeight: 800,
                fontSize: 12.5,
                padding: '6px 12px',
                borderRadius: 999,
                cursor: 'pointer',
              }}
            >
              {s.label}
              {counts[s.key] ? <span style={{ marginLeft: 6, color: colors.muted }}>{counts[s.key]}</span> : null}
            </button>
          );
        })}
      </div>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}

      {/* The open piece sits above the boxes, full width: a card is too much to read in a box. */}
      {opened ? (
        <div id="open-piece" style={{ marginBottom: 14, scrollMarginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              Close ✕
            </Button>
          </div>
          <PostCard key={opened.id} post={opened} />
        </div>
      ) : null}

      {shown.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>{current.empty}</p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
          {shown.map((post) => (
            <PostTile
              key={post.id}
              post={post}
              open={post.id === openId}
              onOpen={() => {
                setOpenId(post.id);
                setTimeout(() => document.getElementById('open-piece')?.scrollIntoView({ behavior: 'smooth' }), 0);
              }}
            />
          ))}
        </div>
      )}

      {posts.length === pageSize ? (
        <div style={{ marginTop: 12 }}>
          <Button variant="ghost" onClick={() => setPageSize((n) => n + PAGE)}>
            Load older pieces
          </Button>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <ViralFinds research={research} />
      </div>
    </div>
  );
}

/** One piece as a box: the picture or first frame, then what it is and where it stands. */
function PostTile({ post, open, onOpen }: { post: SocialPostDoc; open: boolean; onOpen: () => void }) {
  const assets = postAssets(post);
  const image = assets.find((a) => a.kind === 'image' && a.url);
  const video = assets.find((a) => a.kind === 'video' && a.url);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={open}
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        padding: 0,
        border: `${open ? 2 : 1}px solid ${open ? colors.primary : colors.border}`,
        borderRadius: 14,
        overflow: 'hidden',
        background: colors.surface,
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
        color: colors.text,
        minWidth: 0,
      }}
    >
      <div
        style={{
          aspectRatio: '4 / 5',
          background: '#1a1c1c',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          color: '#ccff00',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {video ? (
          <video
            src={video.url ?? undefined}
            muted
            playsInline
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url ?? ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          'No picture yet'
        )}
      </div>
      <div style={{ display: 'grid', gap: 6, padding: 10, alignContent: 'start' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormatChip format={post.format ?? 'reel'} />
          <StatusPill status={post.status} />
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {post.script?.hook ?? post.angle}
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: colors.muted }}>{longDate(post.date)}</span>
      </div>
    </button>
  );
}

function PostCard({ post }: { post: SocialPostDoc }) {
  const { path } = useWorkspace();
  const [caption, setCaption] = useState(post.caption);
  const [targets, setTargets] = useState<SocialPlatform[]>(post.targets ?? []);
  const [feedback, setFeedback] = useState('');
  const [captionOnly, setCaptionOnly] = useState(false);
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
  /**
   * The desk draws its own pictures and cuts its own reels now, but a render
   * can fail and older pieces predate it. Say what is missing out loud: a
   * disabled Approve button is a symptom, not an instruction.
   */
  const briefCount = post.direction?.length ?? 0;
  const slidesAttached = assets.filter((a) => a.kind === 'image').length;
  const missing = (() => {
    const isVideo = (post.format ?? 'reel') === 'reel' || post.format === 'video';
    if (isVideo) return assets.some((a) => a.kind === 'video') ? '' : 'the video';
    if (briefCount > slidesAttached) {
      const left = briefCount - slidesAttached;
      return `${left} of ${briefCount} image${briefCount === 1 ? '' : 's'}`;
    }
    return assets.length ? '' : 'an image';
  })();
  const working = WORKING_STATES.includes(post.status);
  const format = post.format ?? 'reel';
  const renderLabel = format === 'reel' || format === 'video' ? 'Make the video' : 'Make the picture';

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

  /**
   * Approve means post. A piece already approved, or one that partly failed,
   * goes out again through the same call — and the backend skips every
   * network that already has it, so this can never double-post.
   */
  const approve = () =>
    run('publish', async () => {
      const res = await socialApi.review({ postId: post.id, approve: true, caption, targets, publishNow: true });
      // A piece made ahead is approved now and goes out on its own day.
      if (res.status === 'scheduled' && res.dueAtMs) {
        return `Approved. It goes out ${new Date(res.dueAtMs).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`;
      }
      return `Posted to ${res.published ?? 0} network${res.published === 1 ? '' : 's'}${
        res.failed ? `, ${res.failed} failed — see below.` : '.'
      }`;
    });

  const render = () =>
    run('render', async () => {
      const res = await socialApi.render({ postId: post.id });
      return res.made ? 'Made. Check it, then approve.' : 'Nothing was missing.';
    });

  const askForChanges = () =>
    run('changes', async () => {
      if (feedback.trim().length < 3) throw new Error('Say what you want changed.');
      // A script note re-runs everything after the writing too — pictures, video,
      // captions — so whatever the note is about, the new version carries it.
      await socialApi.requestChanges({
        postId: post.id,
        feedback: feedback.trim(),
        scope: [captionOnly ? 'caption' : 'script'],
      });
      setFeedback('');
      // The call returns when the team is finished, so this is after the fact.
      return captionOnly ? 'Caption rewritten.' : 'Fixed — the new version is above.';
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
      const upload = path(`socialUploads/${post.id}-${Date.now()}-${file.name.replace(/[^\w.-]/g, '')}`);
      await uploadBytes(ref(storage, upload), file);
      await socialApi.attachMedia({ postId: post.id, storagePath: upload, kind });
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
            {busy === 'attach' ? 'Uploading…' : 'Upload your own picture or video'}
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
          {missing ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <p style={{ margin: 0, fontSize: 11.5, color: colors.warn, lineHeight: 1.45 }}>
                No {missing} yet. The desk makes it within a few minutes — or press the button, or upload your own.
              </p>
              {post.script && !working ? (
                <Button variant="secondary" onClick={render} disabled={!!busy}>
                  {busy === 'render' ? 'Making it…' : renderLabel}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
            <WorkLine work={post.work} format={format} compact />
          </div>
        </div>

        {/* what they wrote */}
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          {post.plan?.concept ? (
            <div style={{ background: `${colors.primary}0a`, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: colors.primary, marginBottom: 3 }}>
                THE IDEA
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{post.plan.concept}</div>
              {post.plan.why ? (
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{post.plan.why}</div>
              ) : null}
            </div>
          ) : null}

          {post.reference ? (
            <div style={{ background: '#ccff0024', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: colors.primary, marginBottom: 3 }}>
                🎬 MADE LIKE YOUR VIDEO
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{post.reference.ourVersion || post.reference.summary}</div>
              {post.reference.whyItWorks.length ? (
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                  Why the original works: {post.reference.whyItWorks.join(' · ')}
                </div>
              ) : null}
              {post.reference.market ? (
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>In your market: {post.reference.market}</div>
              ) : null}
            </div>
          ) : null}

          {post.script ? (
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.3 }}>{post.script.hook}</div>
              {post.script.viralHook ? (
                <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 3 }}>
                  Why people will share it: {post.script.viralHook}
                </div>
              ) : null}
              <Scorecard quality={post.quality} />
            </div>
          ) : (
            <div style={{ fontSize: 13, color: colors.muted }}>
              {working ? 'The team is working on it…' : 'Nothing written yet.'}
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
            {showDetail ? 'Hide details' : 'Show details — scenes, keywords, numbers, history'}
          </button>

          {showDetail ? <Working post={post} /> : null}
        </div>
      </div>

      {/*
        Said plainly because it is why this piece waits even when the desk posts
        on its own: the backend holds a template-written piece for a person, and
        it cannot follow a change request. Not an error, so not in red.
      */}
      {post.engine === 'local' ? (
        <p style={{ color: colors.muted, fontSize: 12.5, marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>
          Written from templates because no AI was available, so it waits for you to read it and it cannot follow
          change requests.
        </p>
      ) : null}
      {post.error ? (
        <p style={{ color: colors.danger, fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>{post.error}</p>
      ) : null}
      {error ? <p style={{ color: colors.danger, fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>{notice}</p> : null}

      {/* live, while it goes out — Instagram takes a minute or two over a reel */}
      {post.status === 'publishing' || busy === 'publish' ? (
        <p style={{ color: colors.primary, fontSize: 12.5, marginTop: 12, marginBottom: 0, fontWeight: 700 }}>
          {post.work?.distribute?.note ?? 'Posting…'}{' '}
          <span style={{ color: colors.muted, fontWeight: 400 }}>You can leave this page — it carries on.</span>
        </p>
      ) : null}
      {post.status === 'ready' && post.publishQueuedAtMs ? (
        <p style={{ color: colors.muted, fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
          Approved — it goes out within five minutes, or press Post now.
        </p>
      ) : null}

      {/* the four decisions */}
      <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 14, paddingTop: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={approve} disabled={working || !!busy || assets.length === 0}>
            {busy === 'publish' || post.status === 'publishing'
              ? 'Posting…'
              : post.status === 'ready'
                ? 'Post now'
                : post.status === 'partial' || post.status === 'failed'
                  ? 'Post again'
                  : 'Approve & post'}
          </Button>
          {assets.length === 0 && !working ? (
            <span style={{ fontSize: 12, color: colors.muted }}>
              Nothing to post yet — the desk is still making it. Press “{renderLabel}”, or upload your own.
            </span>
          ) : null}
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
            WHAT SHOULD CHANGE? — the team rewrites it and makes the {format === 'reel' || format === 'video' ? 'video' : 'picture'}{' '}
            again
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="e.g. focus on city-to-city travel, and make the first line shorter"
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
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              <input type="checkbox" checked={captionOnly} onChange={(e) => setCaptionOnly(e.target.checked)} />
              Only change the caption (quick — the picture or video stays)
            </label>
            <span style={{ flex: 1 }} />
            <Button variant="secondary" onClick={askForChanges} disabled={working || !!busy}>
              {busy === 'changes' ? 'The team is fixing it…' : 'Fix it'}
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
        No picture or video yet
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
        <Section title="Other first lines the writer offered">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
            {post.script.hookVariants.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {frames.length || legacyBeats.length ? (
        <Section title={post.format === 'carousel' ? 'The slides' : 'The scenes'}>
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

      {post.seo ? (
        <Section title="Search keywords">
          <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            {post.seo.searchIntent ? (
              <div>
                <span style={{ color: colors.muted }}>Answering:</span> <strong>{post.seo.searchIntent}</strong>
              </div>
            ) : null}
            {post.seo.keywords.length ? <div>Keywords: {post.seo.keywords.join(', ')}</div> : null}
            {post.seo.altTexts.length ? (
              <div style={{ color: colors.muted }}>Alt text written for {post.seo.altTexts.length} frame(s).</div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {post.search ? (
        <Section title="YouTube and Google">
          <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            {post.search.youtube ? (
              <>
                <div>
                  <span style={{ color: colors.muted }}>Title:</span> <strong>{post.search.youtube.title}</strong>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', color: colors.muted, marginTop: 4 }}>
                  {post.search.youtube.description}
                </div>
                {post.search.youtube.tags.length ? (
                  <div style={{ marginTop: 4, color: colors.muted }}>
                    Tags: {post.search.youtube.tags.join(', ')}
                  </div>
                ) : null}
              </>
            ) : (
              <div style={{ color: colors.muted }}>Not going to YouTube.</div>
            )}
            {post.search.webAngle ? (
              <div style={{ marginTop: 6 }}>
                <span style={{ color: colors.muted }}>Web angle:</span> {post.search.webAngle}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {post.ads ? (
        <Section title="YouTube ad idea (Facebook and Instagram ads are on the Ads page)">
          <div style={{ fontSize: 12.5, lineHeight: 1.6, display: 'grid', gap: 4 }}>
            <div>
              <strong>{post.ads.campaignType}</strong> — {post.ads.objective}
            </div>
            {post.ads.hookVariants.length ? (
              <div>
                <span style={{ color: colors.muted }}>Five-second hooks to test:</span>
                <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                  {post.ads.hookVariants.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <span style={{ color: colors.muted }}>Targeting:</span>{' '}
              {[post.ads.targeting.locations.join(', '), post.ads.targeting.ages, post.ads.targeting.interests.join(', ')]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {post.ads.budgetNote ? (
              <div>
                <span style={{ color: colors.muted }}>Budget:</span> {post.ads.budgetNote}
              </div>
            ) : null}
            {post.ads.whatToTest ? (
              <div>
                <span style={{ color: colors.muted }}>Test first:</span> {post.ads.whatToTest}
              </div>
            ) : null}
            {post.ads.successLooksLike ? (
              <div>
                <span style={{ color: colors.muted }}>Worked if:</span> {post.ads.successLooksLike}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {post.team?.length ? (
        <Section title="Who was on it">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {post.team.map((member) => (
              <span
                key={member.id}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 999,
                  padding: '3px 10px',
                  fontSize: 11.5,
                }}
              >
                <strong>{member.name}</strong>{' '}
                <span style={{ color: colors.muted }}>{ROLE_META[member.role]?.short ?? member.role}</span>
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      {post.reference ? (
        <Section title="Your reference video, taken apart">
          <div style={{ fontSize: 12.5, lineHeight: 1.6, display: 'grid', gap: 4 }}>
            <div>
              <span style={{ color: colors.muted }}>Video:</span>{' '}
              {/^https?:/.test(post.reference.source) ? (
                <a href={post.reference.source} target="_blank" rel="noreferrer" style={{ color: colors.secondary }}>
                  {post.reference.source}
                </a>
              ) : (
                post.reference.source
              )}
              {post.reference.seconds ? ` · ${post.reference.seconds}s` : ''}
            </div>
            <div>
              <span style={{ color: colors.muted }}>Its hook:</span> {post.reference.hook}
            </div>
            {post.reference.beats.length ? (
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {post.reference.beats.map((b, i) => (
                  <li key={i}>
                    <strong>{b.at}</strong> {b.what}
                    {b.onScreen ? <span style={{ color: colors.muted }}> — “{b.onScreen}”</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {[
              ['Pacing', post.reference.pacing],
              ['Look', post.reference.look],
              ['Sound', post.reference.sound],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: colors.muted }}>{k}:</span> {v}
                </div>
              ))}
            {post.reference.dontCopy.length ? (
              <div>
                <span style={{ color: colors.muted }}>Not reused, because it is theirs:</span>{' '}
                {post.reference.dontCopy.join(' · ')}
              </div>
            ) : null}
            {post.reference.sources.length ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {post.reference.sources.slice(0, 6).map((src) => (
                  <a key={src.url} href={src.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: colors.secondary }}>
                    {src.title.slice(0, 40)}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {post.direction?.length ? (
        <Section title={post.direction.length === 1 ? 'The picture to make' : 'The pictures to make'}>
          <div style={{ display: 'grid', gap: 8 }}>
            {post.direction.map((frame, i) => (
              <Brief
                key={i}
                label={post.direction!.length === 1 ? 'The frame' : `Frame ${i + 1}`}
                overlay={frame.overlay}
                text={frame.prompt}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {post.cut?.prompt ? (
        <Section title="Video plan">
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: colors.muted, whiteSpace: 'pre-wrap' }}>
            {post.cut.prompt}
          </p>
        </Section>
      ) : null}

      <Section title="Numbers it used">
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
        <Section title="What is trending">
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

      {post.research?.sounds?.length && ((post.format ?? 'reel') === 'reel' || post.format === 'video') ? (
        <Section title="Trending sounds this week">
          <p style={{ margin: '0 0 6px', fontSize: 12, color: colors.muted }}>
            No app can add Instagram&apos;s own sounds to a reel. If you post this one by hand, add one of these in
            the Instagram app and turn the reel&apos;s own audio down.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
            {post.research.sounds.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {post.revisions?.length ? (
        <Section title="Changes you asked for">
          <div style={{ display: 'grid', gap: 6 }}>
            {post.revisions.map((r: SocialRevision, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                {r.feedback}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {Object.entries(post.results ?? {}).some(([, r]) => r && !r.ok) ? (
        <Section title="Where posting failed">
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

/**
 * One brief, ready to be used.
 *
 * The copy button is the whole point of the block: this text is written to be
 * pasted somewhere else — into an image tool, or into a message to whoever is
 * making the picture — and a prompt you have to select by hand across four
 * lines of wrapped text is a prompt that gets half-copied.
 */
function Brief({ label, overlay, text }: { label: string; overlay: string; text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 800 }}>{label}</span>
        {overlay ? (
          <span style={{ fontSize: 11.5, color: colors.muted }}>on screen: &ldquo;{overlay}&rdquo;</span>
        ) : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          style={{
            border: `1px solid ${colors.border}`,
            background: 'transparent',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 700,
            color: copied ? colors.success : colors.muted,
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: colors.muted, whiteSpace: 'pre-wrap' }}>{text}</p>
    </div>
  );
}

/**
 * The checks, in one line you can read without opening anything.
 *
 * These are scored in the backend in code — no model call, no cost — so they
 * are on every piece, and the point of showing them here is that "the hook
 * scores 42 and the caption is over the hashtag cap" is a reason to send
 * something back without reading it end to end first.
 *
 * The number is a floor, not a verdict. It catches a hook that opens on a
 * greeting and a script that will not fit the cut; it cannot tell you which of
 * two good hooks will travel. Nothing that only reads text can.
 */
function Scorecard({ quality }: { quality: SocialPostDoc['quality'] }) {
  const [open, setOpen] = useState(false);
  if (!quality) return null;

  const tone =
    quality.verdict === 'FIX' ? '#ff6b6b' : quality.verdict === 'REVIEW' ? '#ffd166' : '#28c76f';

  const word = quality.verdict === 'FIX' ? 'needs work' : quality.verdict === 'REVIEW' ? 'okay' : 'good';

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 9px',
          border: `1px solid ${tone}40`,
          borderRadius: 7,
          background: `${tone}12`,
          color: colors.text,
          font: 'inherit',
          fontSize: 11.5,
          cursor: quality.notes.length ? 'pointer' : 'default',
        }}
      >
        <span style={{ fontWeight: 900, color: tone }}>Quality {Math.round(quality.score)}/100</span>
        <span style={{ color: colors.muted }}>
          {word}
          {quality.notes.length ? ` — ${quality.notes.length} tip${quality.notes.length === 1 ? '' : 's'}` : ''}
        </span>
        {quality.notes.length ? (
          <span style={{ color: colors.muted, fontWeight: 800 }}>{open ? '▴' : '▾'}</span>
        ) : null}
      </button>

      {open && quality.notes.length ? (
        <ul style={{ margin: '7px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: colors.muted }}>
          {quality.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {open && quality.caption.visible ? (
        <div style={{ marginTop: 7 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: colors.muted, marginBottom: 3 }}>
            WHAT THE FEED SHOWS BEFORE &ldquo;… MORE&rdquo;
          </div>
          <div
            style={{
              padding: 8,
              border: `1px dashed ${colors.border}`,
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {quality.caption.visible}
          </div>
        </div>
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
