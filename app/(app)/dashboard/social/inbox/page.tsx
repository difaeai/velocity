'use client';

/**
 * Manage social → Comments.
 *
 * The second half of the social manager's job. Every couple of hours whoever
 * holds that job reads the comments under everything the desk has published,
 * works out what each one is, and writes the reply — but the reply sits here
 * until someone sends it, unless auto-reply has been switched on deliberately.
 *
 * Two categories never auto-send, whatever the setting says: anything read as a
 * safety issue (marked "for a human"), and spam (closed without a reply). An
 * automated "sorry to hear that!" under a comment about a driver is worse than
 * silence, which is the whole reason this screen exists rather than a bot.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { socialApi, type SocialCommentDoc, type SocialSettings } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { PLATFORM_META, PlatformBadge, StatusPill } from '@/components/social/shared';

const INTENT_LABEL: Record<string, string> = {
  praise: 'Likes it',
  question: 'Asking something',
  complaint: 'Complaint',
  safety: 'Safety',
  spam: 'Spam',
  other: 'Other',
};

const OPEN = ['new', 'drafted', 'escalated'];

export default function InboxPage() {
  const [comments, setComments] = useState<SocialCommentDoc[]>([]);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [tab, setTab] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'socialComments'), orderBy('createdAtMs', 'desc'), limit(100)),
        (snap) => setComments(snap.docs.map((d) => ({ ...(d.data() as SocialCommentDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [],
  );

  useEffect(() => {
    socialApi
      .getSettings({})
      .then((r) => setSettings(r.settings))
      .catch(() => undefined);
  }, []);

  const shown = useMemo(
    () => (tab === 'open' ? comments.filter((c) => OPEN.includes(c.status)) : comments),
    [comments, tab],
  );

  async function sync() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await socialApi.syncComments({});
      setNotice(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the comments.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Comments</h1>
          <p style={{ color: colors.muted, margin: 0 }}>
            What people said back, and what your social manager would say to them.
          </p>
        </div>
        <Button onClick={sync} disabled={busy}>
          {busy ? 'Reading…' : 'Check now'}
        </Button>
      </header>

      {settings && !settings.engagementEnabled ? (
        <Card style={{ marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: colors.warn }}>
            The comment inbox is switched off, so nothing is pulled automatically. Turn it on under Automation — or use
            <strong> Check now</strong> to read them once. Replies need somebody hired as a social media manager.
          </p>
        </Card>
      ) : null}

      {error ? <p style={{ color: colors.danger, marginBottom: 12 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, marginBottom: 12 }}>{notice}</p> : null}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['open', 'all'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              border: `1px solid ${t === tab ? colors.primary : colors.border}`,
              background: t === tab ? `${colors.primary}12` : 'transparent',
              color: t === tab ? colors.primary : colors.muted,
              fontWeight: 800,
              fontSize: 12.5,
              padding: '5px 14px',
              borderRadius: 999,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t === 'open' ? 'Needs an answer' : 'Everything'}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>
            {tab === 'open' ? 'Nothing waiting for an answer.' : 'No comments have come in yet.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {shown.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentCard({ comment }: { comment: SocialCommentDoc }) {
  const [text, setText] = useState(comment.draftReply ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Adjusted during render rather than in an effect: a live snapshot must not
  // wipe what someone is typing, but a fresh draft from Awaaz should replace it.
  const [lastDraft, setLastDraft] = useState(comment.draftReply ?? '');
  if ((comment.draftReply ?? '') !== lastDraft) {
    setLastDraft(comment.draftReply ?? '');
    setText(comment.draftReply ?? '');
  }

  const answered = comment.status === 'replied';

  async function send() {
    setBusy('send');
    setError(null);
    try {
      await socialApi.replyComment({ platform: comment.platform, commentId: comment.commentId, text });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The network refused the reply.');
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    setBusy('close');
    setError(null);
    try {
      await socialApi.setCommentStatus({
        platform: comment.platform,
        commentId: comment.commentId,
        status: 'ignored',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not close it.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <PlatformBadge platform={comment.platform} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <strong style={{ fontSize: 13.5 }}>{comment.authorName}</strong>
            <span style={{ fontSize: 11.5, color: colors.muted }}>
              {PLATFORM_META[comment.platform].label} ·{' '}
              {new Date(comment.createdAtMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
            {comment.intent ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: comment.intent === 'safety' ? colors.danger : colors.muted,
                }}
              >
                {INTENT_LABEL[comment.intent] ?? comment.intent}
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            <StatusPill status={comment.status} />
          </div>

          <p style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.5 }}>{comment.text}</p>

          {comment.status === 'escalated' ? (
            <p style={{ margin: '0 0 8px', fontSize: 12.5, color: colors.danger }}>
              Read as a safety issue. Nothing is sent here automatically — answer it yourself, and get the trip
              details.
            </p>
          ) : null}

          {answered ? (
            <div style={{ background: colors.bg, borderRadius: 9, padding: '8px 10px', fontSize: 13 }}>
              <span style={{ color: colors.muted, fontSize: 11, fontWeight: 800 }}>REPLIED</span>
              <div style={{ lineHeight: 1.5 }}>{comment.sentReply}</div>
            </div>
          ) : (
            <>
              {comment.draftedBy ? (
                <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 4 }}>
                  DRAFTED BY {comment.draftedBy.toUpperCase()}
                </div>
              ) : null}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Write a reply…"
                style={{
                  width: '100%',
                  padding: 9,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 9,
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <Button onClick={send} disabled={!text.trim() || !!busy}>
                  {busy === 'send' ? 'Sending…' : 'Send reply'}
                </Button>
                <Button variant="ghost" onClick={close} disabled={!!busy}>
                  Close without replying
                </Button>
                {comment.permalink ? (
                  <a
                    href={comment.permalink}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12.5, color: colors.secondary, marginLeft: 'auto' }}
                  >
                    Open on {PLATFORM_META[comment.platform].label}
                  </a>
                ) : null}
              </div>
            </>
          )}

          {comment.error ? (
            <p style={{ color: colors.danger, fontSize: 12.5, margin: '8px 0 0' }}>{comment.error}</p>
          ) : null}
          {error ? <p style={{ color: colors.danger, fontSize: 12.5, margin: '8px 0 0' }}>{error}</p> : null}
        </div>
      </div>
    </Card>
  );
}
