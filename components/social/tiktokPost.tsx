'use client';

/**
 * "Post to TikTok" on a piece.
 *
 * TikTok's Content Sharing Guidelines decide what is on this screen, and its audit
 * checks it: the creator's name, fresh account details each time it opens, a title
 * the person can edit, a privacy choice with no default, interaction switches that
 * start off, the commercial-content switch and its labels, the music declaration,
 * and nothing sent until the person presses the button. Do not pre-fill a privacy
 * or pre-tick a switch to save a tap: that is what fails the audit.
 */

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { useWorkspace } from '@/lib/workspace';
import { videoConnectApi, type SocialPostDoc, type TikTokCreatorInfo } from '@/lib/api';
import { Button } from '@/components/ui';

const PRIVACY: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};
const NOT_PRIVATE = 'Branded content visibility cannot be set to private.';
const MUSIC = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
const BRANDED = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

export interface TikTokVideo {
  url: string | null;
  durationSec?: number | null;
}

export function TikTokPost({ post, video }: { post: SocialPostDoc; video: TikTokVideo }) {
  const { path } = useWorkspace();
  const [connected, setConnected] = useState(false);
  const [creator, setCreator] = useState<TikTokCreatorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, path('socialAccounts/tiktok')),
        (snap) => setConnected(snap.get('status') === 'connected'),
        () => setConnected(false),
      ),
    [path],
  );

  const result = post.results?.tiktok;
  if (!connected && !result) return null;
  if (result?.ok) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: colors.success, fontWeight: 700 }}>
        Sent to TikTok. It may take a few minutes to process and show on the profile.
      </p>
    );
  }

  async function open() {
    setLoading(true);
    setError(null);
    try {
      setCreator(await videoConnectApi.creator());
    } catch (e) {
      // TikTok says when this creator cannot post right now. Nothing may be offered until it says otherwise.
      setError(e instanceof Error ? e.message : 'TikTok would not answer. Try again later.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {creator ? (
        <TikTokForm postId={post.id} caption={post.captions?.tiktok ?? post.caption} video={video} creator={creator} onClose={() => setCreator(null)} />
      ) : (
        <Button variant="secondary" onClick={open} disabled={loading}>
          {loading ? 'Asking TikTok…' : 'Post to TikTok'}
        </Button>
      )}
      {result && !result.ok && !creator ? <p style={{ margin: '6px 0 0', fontSize: 12.5, color: colors.danger }}>{result.error}</p> : null}
      {error ? <p style={{ margin: '6px 0 0', fontSize: 12.5, color: colors.danger }}>{error}</p> : null}
    </div>
  );
}

function Tick({
  label,
  hint,
  checked,
  disabled,
  title,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <label title={title} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <strong>{label}</strong>
        {hint ? <span style={{ display: 'block', color: colors.muted, fontSize: 12 }}>{hint}</span> : null}
      </span>
    </label>
  );
}

export function TikTokForm({
  postId,
  caption,
  video,
  creator,
  onClose,
}: {
  postId: string;
  caption: string;
  video: TikTokVideo;
  creator: TikTokCreatorInfo;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(caption.slice(0, 2200));
  const [privacy, setPrivacy] = useState('');
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [commercial, setCommercial] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [brandedContent, setBrandedContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brand = commercial && yourBrand;
  const branded = commercial && brandedContent;
  const tooLong = Boolean(creator.max_video_post_duration_sec && video.durationSec && video.durationSec > creator.max_video_post_duration_sec);
  const undecided = commercial && !yourBrand && !brandedContent;
  const ready = Boolean(privacy) && title.trim().length > 0 && !undecided && !tooLong && !busy;
  const who = creator.creator_nickname || creator.creator_username || 'your TikTok account';

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await videoConnectApi.postToTikTok({ postId, title: title.trim(), privacy, allowComment, allowDuet, allowStitch, yourBrand: brand, brandedContent: branded });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'TikTok did not take it.');
    } finally {
      setBusy(false);
    }
  }

  const section = { fontSize: 11, fontWeight: 800, color: colors.muted, margin: '0 0 6px' };

  return (
    <div style={{ display: 'grid', gap: 14, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {creator.creator_avatar_url ? (
          // A TikTok-hosted picture that expires in two hours: nothing to optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creator.creator_avatar_url} alt="" width={36} height={36} style={{ borderRadius: '50%' }} />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>POSTING TO TIKTOK AS</div>
          <strong style={{ fontSize: 14.5 }}>{who}</strong>
          {creator.creator_username ? <span style={{ color: colors.muted, fontSize: 13 }}> @{creator.creator_username}</span> : null}
        </div>
        <button type="button" onClick={onClose} disabled={busy} style={{ background: 'none', border: 'none', color: colors.muted, fontWeight: 700, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>

      {video.url ? (
        <video src={video.url} controls playsInline preload="metadata" style={{ width: 150, borderRadius: 10, background: '#000' }}>
          <track kind="captions" />
        </video>
      ) : null}
      {tooLong ? <p style={{ margin: 0, color: colors.danger, fontSize: 13 }}>This account can post videos up to {creator.max_video_post_duration_sec} seconds, and this one is longer.</p> : null}

      <div>
        <p style={section}>TITLE</p>
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={2200}
          rows={3}
          aria-label="Title"
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 10, font: 'inherit', fontSize: 13.5, resize: 'vertical' }}
        />
      </div>

      <div>
        <p style={section}>WHO CAN VIEW THIS VIDEO</p>
        <select
          value={privacy}
          onChange={(e) => setPrivacy(e.target.value)}
          aria-label="Who can view this video"
          style={{ height: 38, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '0 10px', font: 'inherit', fontSize: 13.5 }}
        >
          <option value="" disabled>
            Choose one
          </option>
          {(creator.privacy_level_options ?? []).map((o) => (
            <option key={o} value={o} disabled={o === 'SELF_ONLY' && branded} title={o === 'SELF_ONLY' && branded ? NOT_PRIVATE : undefined}>
              {PRIVACY[o] ?? o}
            </option>
          ))}
        </select>
        {branded ? <p style={{ margin: '6px 0 0', fontSize: 12, color: colors.muted }}>{NOT_PRIVATE}</p> : null}
      </div>

      <div>
        <p style={section}>ALLOW PEOPLE TO</p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Tick label="Comment" checked={allowComment} disabled={creator.comment_disabled} title={creator.comment_disabled ? 'Off in your TikTok settings' : undefined} onChange={setAllowComment} />
          <Tick label="Duet" checked={allowDuet} disabled={creator.duet_disabled} title={creator.duet_disabled ? 'Off in your TikTok settings' : undefined} onChange={setAllowDuet} />
          <Tick label="Stitch" checked={allowStitch} disabled={creator.stitch_disabled} title={creator.stitch_disabled ? 'Off in your TikTok settings' : undefined} onChange={setAllowStitch} />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <Tick label="Disclose commercial content" hint="Turn this on if this video promotes yourself, a brand, a product or a service." checked={commercial} onChange={setCommercial} />
        {commercial ? (
          <div style={{ display: 'grid', gap: 8, paddingLeft: 22 }}>
            <Tick label="Your brand" hint="You are promoting yourself or your own business." checked={yourBrand} onChange={setYourBrand} />
            <Tick
              label="Branded content"
              hint="You are promoting another brand or a third party."
              checked={brandedContent}
              disabled={privacy === 'SELF_ONLY'}
              title={privacy === 'SELF_ONLY' ? NOT_PRIVATE : undefined}
              onChange={setBrandedContent}
            />
            {undecided ? <p style={{ margin: 0, fontSize: 12, color: colors.warn }}>Choose at least one: what does this video promote?</p> : null}
            {branded ? (
              <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Your video will be labeled as &quot;Paid partnership&quot;.</p>
            ) : brand ? (
              <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Your video will be labeled as &quot;Promotional content&quot;.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <p style={{ margin: 0, fontSize: 12.5, color: colors.muted, lineHeight: 1.5 }}>
        By posting, you agree to TikTok&apos;s{' '}
        {branded ? (
          <>
            <a href={BRANDED} target="_blank" rel="noreferrer">
              Branded Content Policy
            </a>{' '}
            and{' '}
          </>
        ) : null}
        <a href={MUSIC} target="_blank" rel="noreferrer">
          Music Usage Confirmation
        </a>
        . After you post, it may take a few minutes to process and show on your profile.
      </p>

      <div>
        <Button onClick={send} disabled={!ready}>
          {busy ? 'Sending to TikTok…' : 'Post to TikTok'}
        </Button>
      </div>
      {error ? <p style={{ margin: 0, fontSize: 13, color: colors.danger }}>{error}</p> : null}
    </div>
  );
}
