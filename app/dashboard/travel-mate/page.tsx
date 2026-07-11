'use client';

/**
 * Admin — Travel Mate management.
 * Tabs: Subscriptions | Plans | Community | Moderation | Settings.
 *
 * Plans:         Create / toggle-active / soft-delete subscription plans.
 * Subscriptions: Queue of pending + active + rejected + expired requests.
 *                Approve (debits wallet, grants daily likes) or Reject.
 * Community:     Full CRUD over the community feed — edit/delete posts,
 *                delete comments, create/edit/delete city communities.
 * Settings:      Edit config/travelMateSettings in place.
 */
import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Plan {
  id: string;
  name: string;
  billingPeriod: 'weekly' | 'yearly';
  pricePKR: number;
  dailyLikeAllowance: number;
  active: boolean;
  createdAt?: { seconds: number };
}

interface Sub {
  id: string;
  uid: string;
  planId: string;
  planSnapshot?: {
    name?: string;
    billingPeriod?: string;
    pricePKR?: number;
    dailyLikeAllowance?: number;
  };
  status: 'pending' | 'active' | 'rejected' | 'expired';
  paymentMethod: string;
  paymentProofURL?: string | null;
  requestedAt?: { seconds: number };
  reviewedAt?: { seconds: number };
  endAt?: Timestamp;
}

interface ModerationReport {
  id: string;
  reporterId: string;
  reportedUid: string;
  matchId: string | null;
  reason: string;
  status: 'open' | 'resolved';
  createdAt?: { seconds: number };
}

interface TmSettings {
  freeMonthlySwipes: number;
  maxGroupSize: number;
  discoveryRadiusKm: number;
  enforceMutualGender: boolean;
}

interface FeedPost {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  mediaType: 'image' | 'video' | null;
  mediaURL: string | null;
  communityId: string | null;
  communityName: string | null;
  communityCity: string | null;
  likeCount: number;
  commentCount: number;
  editedByAdmin?: boolean;
  createdAt?: { seconds: number };
}

interface FeedComment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt?: { seconds: number };
}

interface FeedCommunity {
  id: string;
  name: string;
  city: string;
  description?: string;
  creatorName?: string;
  memberCount: number;
  createdAt?: { seconds: number };
}

type Tab = 'plans' | 'subscriptions' | 'settings' | 'moderation' | 'community';
type SubFilter = 'pending' | 'active' | 'rejected' | 'expired';

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TravelMatePage() {
  const [tab, setTab] = useState<Tab>('subscriptions');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [settings, setSettings] = useState<TmSettings>({
    freeMonthlySwipes: 4,
    maxGroupSize: 4,
    discoveryRadiusKm: 3,
    enforceMutualGender: true,
  });
  const [subFilter, setSubFilter] = useState<SubFilter>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ModerationReport[]>([]);

  // ── Plans real-time ────────────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMatePlans'), orderBy('createdAt', 'desc')),
      snap => setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Plan)),
    );
  }, []);

  // ── Subscriptions real-time ────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMateSubscriptions'), orderBy('requestedAt', 'desc')),
      snap => setSubs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Sub)),
    );
  }, []);

  // ── Settings real-time ────────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'travelMateSettings'), snap => {
      if (snap.exists()) setSettings(snap.data() as TmSettings);
    });
  }, []);

  // ── Reports real-time ─────────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMateReports'), where('status', '==', 'open'), orderBy('createdAt', 'desc')),
      snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ModerationReport)),
    );
  }, []);

  async function call<T>(fn: () => Promise<T>, id: string): Promise<T | null> {
    setError(null);
    setBusy(id);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const filteredSubs = subs.filter(s => s.status === subFilter);

  return (
    <div style={{ maxWidth: 1060, padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: colors.text, marginBottom: 20 }}>
        Travel Mate
      </h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {(['subscriptions', 'plans', 'community', 'moderation', 'settings'] as Tab[]).map(t => (
          <Button key={t} variant={tab === t ? 'primary' : 'ghost'} onClick={() => setTab(t)}>
            {t === 'subscriptions' ? '🧾 Subscriptions'
              : t === 'plans' ? '📋 Plans'
              : t === 'community' ? '🌍 Community'
              : t === 'moderation' ? `🚩 Moderation${reports.length ? ` (${reports.length})` : ''}`
              : '⚙️ Settings'}
          </Button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: `${colors.danger}22`, color: colors.danger, marginBottom: 14, fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {tab === 'plans'         && <PlansTab plans={plans} busy={busy} call={call} />}
      {tab === 'subscriptions' && (
        <SubsTab
          subs={filteredSubs}
          filter={subFilter}
          setFilter={setSubFilter}
          busy={busy}
          call={call}
        />
      )}
      {tab === 'settings' && <SettingsTab settings={settings} />}
      {tab === 'moderation' && <ModerationTab reports={reports} busy={busy} call={call} />}
      {tab === 'community' && <CommunityTab busy={busy} call={call} />}
    </div>
  );
}

// ── Community tab — full CRUD over the feed ───────────────────────────────────

function CommunityTab({
  busy,
  call,
}: {
  busy: string | null;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [communities, setCommunities] = useState<FeedCommunity[]>([]);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [editPost, setEditPost] = useState<FeedPost | null>(null);
  const [communityModal, setCommunityModal] = useState<{ community: FeedCommunity | null } | null>(null);

  // Latest posts (live)
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMatePosts'), orderBy('createdAt', 'desc'), limit(100)),
      snap => setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() }) as FeedPost)),
    );
  }, []);

  // Communities (live)
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMateCommunities'), orderBy('city', 'asc'), orderBy('memberCount', 'desc')),
      snap => setCommunities(snap.docs.map(d => ({ id: d.id, ...d.data() }) as FeedCommunity)),
    );
  }, []);

  // Comments of the expanded post (live)
  useEffect(() => {
    if (!expandedPost) { setComments([]); return; }
    return onSnapshot(
      query(collection(db, 'travelMatePosts', expandedPost, 'comments'), orderBy('createdAt', 'asc')),
      snap => setComments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as FeedComment)),
    );
  }, [expandedPost]);

  async function deletePost(p: FeedPost) {
    if (!confirm(`Delete this post by ${p.authorName}? This removes it (and its likes/comments) for everyone.`)) return;
    await call(() => adminApi.deleteTravelMatePost({ postId: p.id }), p.id);
  }

  async function deleteComment(postId: string, c: FeedComment) {
    if (!confirm(`Delete this comment by ${c.authorName}?`)) return;
    await call(() => adminApi.deleteTravelMateComment({ postId, commentId: c.id }), c.id);
  }

  async function deleteCommunity(c: FeedCommunity) {
    if (!confirm(`Delete "${c.name}" (${c.city})? Its posts stay in the general feed without the group tag.`)) return;
    await call(() => adminApi.adminDeleteTravelMateCommunity({ communityId: c.id }), c.id);
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Communities CRUD */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, color: colors.text }}>City communities ({communities.length})</h2>
          <Button variant="primary" onClick={() => setCommunityModal({ community: null })}>+ New community</Button>
        </div>
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>
                  <th style={th}>Name</th>
                  <th style={th}>City</th>
                  <th style={th}>Members</th>
                  <th style={th}>Created by</th>
                  <th style={th}>Created</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {communities.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: colors.muted }}>No communities yet.</td></tr>
                )}
                {communities.map(c => (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={td}><strong>{c.name}</strong>{c.description ? <div style={{ color: colors.muted, fontSize: 11 }}>{c.description}</div> : null}</td>
                    <td style={td}>📍 {c.city}</td>
                    <td style={td}>{c.memberCount}</td>
                    <td style={td}>{c.creatorName ?? '—'}</td>
                    <td style={td}>{c.createdAt ? fmtDate(c.createdAt.seconds) : '—'}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button variant="ghost" disabled={busy === c.id} onClick={() => setCommunityModal({ community: c })}>Edit</Button>
                        <Button variant="danger" disabled={busy === c.id} onClick={() => deleteCommunity(c)}>{busy === c.id ? '…' : 'Delete'}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Posts CRUD */}
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 900, color: colors.text, marginBottom: 10 }}>
          Latest posts ({posts.length})
        </h2>
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>
                  <th style={th}>Author</th>
                  <th style={th}>Post</th>
                  <th style={th}>Group</th>
                  <th style={th}>Engagement</th>
                  <th style={th}>Posted</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: colors.muted }}>No posts yet.</td></tr>
                )}
                {posts.map(p => (
                  <React.Fragment key={p.id}>
                    <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={td}><strong>{p.authorName}</strong><div style={{ color: colors.muted, fontSize: 10 }}><code>{p.authorId.slice(0, 10)}…</code></div></td>
                      <td style={{ ...td, maxWidth: 320 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {p.text || <em style={{ color: colors.muted }}>(no text)</em>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, fontSize: 11, marginTop: 2 }}>
                          {p.mediaType === 'image' && p.mediaURL && <a href={p.mediaURL} target="_blank" rel="noopener noreferrer" style={{ color: colors.primary }}>📷 image</a>}
                          {p.mediaType === 'video' && p.mediaURL && <a href={p.mediaURL} target="_blank" rel="noopener noreferrer" style={{ color: colors.primary }}>🎬 video</a>}
                          {p.editedByAdmin && <span style={{ color: '#f59e0b' }}>edited by admin</span>}
                        </div>
                      </td>
                      <td style={td}>{p.communityName ? `${p.communityName} · ${p.communityCity}` : '—'}</td>
                      <td style={td}>❤️ {p.likeCount} · 💬 {p.commentCount}</td>
                      <td style={td}>{p.createdAt ? fmtDate(p.createdAt.seconds) : '—'}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button variant="ghost" disabled={busy === p.id} onClick={() => setEditPost(p)}>Edit</Button>
                          <Button variant="secondary" disabled={busy === p.id} onClick={() => setExpandedPost(expandedPost === p.id ? null : p.id)}>
                            {expandedPost === p.id ? 'Hide' : 'Comments'}
                          </Button>
                          <Button variant="danger" disabled={busy === p.id} onClick={() => deletePost(p)}>{busy === p.id ? '…' : 'Delete'}</Button>
                        </div>
                      </td>
                    </tr>
                    {expandedPost === p.id && (
                      <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td colSpan={6} style={{ ...td, backgroundColor: `${colors.primary}08` }}>
                          {comments.length === 0 ? (
                            <span style={{ color: colors.muted }}>No comments on this post.</span>
                          ) : (
                            <div style={{ display: 'grid', gap: 8 }}>
                              {comments.map(c => (
                                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <strong style={{ minWidth: 120 }}>{c.authorName}</strong>
                                  <span style={{ flex: 1 }}>{c.text}</span>
                                  <span style={{ color: colors.muted, fontSize: 11 }}>{c.createdAt ? fmtDate(c.createdAt.seconds) : ''}</span>
                                  <Button variant="danger" disabled={busy === c.id} onClick={() => deleteComment(p.id, c)}>Delete</Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {editPost && <PostEditModal post={editPost} onClose={() => setEditPost(null)} call={call} />}
      {communityModal && (
        <CommunityModal
          community={communityModal.community}
          onClose={() => setCommunityModal(null)}
          call={call}
        />
      )}
    </div>
  );
}

function PostEditModal({
  post,
  onClose,
  call,
}: {
  post: FeedPost;
  onClose: () => void;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [text, setText] = useState(post.text);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await call(() => adminApi.adminUpdateTravelMatePost({ postId: post.id, text: text.trim() }), post.id);
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <Card style={{ width: 480, maxWidth: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text }}>Edit post — {post.authorName}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: colors.muted }}>✕</button>
        </div>
        <Field label="Post text (moderation edit — marked as edited by admin)">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={5}
            maxLength={2000}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="primary" disabled={loading} onClick={submit}>{loading ? '…' : 'Save'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

function CommunityModal({
  community,
  onClose,
  call,
}: {
  community: FeedCommunity | null;
  onClose: () => void;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [name, setName] = useState(community?.name ?? '');
  const [city, setCity] = useState(community?.city ?? '');
  const [description, setDescription] = useState(community?.description ?? '');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (name.trim().length < 3 || city.trim().length < 2) {
      alert('A community needs a name (3+ chars) and a city.');
      return;
    }
    setLoading(true);
    try {
      await call(
        () => adminApi.adminUpsertTravelMateCommunity({
          communityId: community?.id,
          name: name.trim(),
          city: city.trim(),
          description: description.trim() || undefined,
        }),
        community?.id ?? 'create-community',
      );
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <Card style={{ width: 420, maxWidth: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text }}>
            {community ? 'Edit community' : 'New community'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: colors.muted }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lahore Travellers" style={inputStyle} maxLength={48} />
          </Field>
          <Field label="City (required — shown to every member)">
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Lahore" style={inputStyle} maxLength={48} />
          </Field>
          <Field label="Description (optional)">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={300} style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="primary" disabled={loading} onClick={submit}>{loading ? '…' : community ? 'Save' : 'Create'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

// ── Plans tab ─────────────────────────────────────────────────────────────────

function PlansTab({
  plans,
  busy,
  call,
}: {
  plans: Plan[];
  busy: string | null;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);

  async function toggleActive(p: Plan) {
    await call(() => adminApi.adminUpdateTravelMatePlan({ planId: p.id, active: !p.active }), p.id);
  }

  async function deletePlan(p: Plan) {
    if (!confirm(`Soft-delete "${p.name}"? Existing subscribers keep their access until expiry.`)) return;
    await call(() => adminApi.adminDeleteTravelMatePlan({ planId: p.id }), p.id);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ New plan</Button>
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>
                <th style={th}>Name</th>
                <th style={th}>Period</th>
                <th style={th}>Price (PKR)</th>
                <th style={th}>Daily likes</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: colors.muted }}>No plans yet. Create the first one.</td></tr>
              )}
              {plans.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={td}><strong>{p.name}</strong></td>
                  <td style={td}>{p.billingPeriod}</td>
                  <td style={td}>PKR {p.pricePKR?.toLocaleString()}</td>
                  <td style={td}>{p.dailyLikeAllowance}/day</td>
                  <td style={td}>
                    <StatusBadge status={p.active ? 'active' : 'inactive'} />
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="ghost" disabled={busy === p.id} onClick={() => setEditPlan(p)}>Edit</Button>
                      <Button variant={p.active ? 'secondary' : 'primary'} disabled={busy === p.id} onClick={() => toggleActive(p)}>
                        {busy === p.id ? '…' : p.active ? 'Disable' : 'Enable'}
                      </Button>
                      <Button variant="danger" disabled={busy === p.id} onClick={() => deletePlan(p)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(showCreate || editPlan) && (
        <PlanModal
          plan={editPlan}
          onClose={() => { setShowCreate(false); setEditPlan(null); }}
          call={call}
        />
      )}
    </div>
  );
}

function PlanModal({
  plan,
  onClose,
  call,
}: {
  plan: Plan | null;
  onClose: () => void;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [name, setName] = useState(plan?.name ?? '');
  const [period, setPeriod] = useState<'weekly' | 'yearly'>(plan?.billingPeriod ?? 'weekly');
  const [price, setPrice] = useState(String(plan?.pricePKR ?? ''));
  const [likes, setLikes] = useState(String(plan?.dailyLikeAllowance ?? ''));
  const [loading, setLoading] = useState(false);

  async function submit() {
    const pricePKR = parseInt(price, 10);
    const dailyLikeAllowance = parseInt(likes, 10);
    if (!name.trim() || isNaN(pricePKR) || isNaN(dailyLikeAllowance)) {
      alert('Fill all fields with valid values.');
      return;
    }
    setLoading(true);
    try {
      if (plan) {
        await call(() => adminApi.adminUpdateTravelMatePlan({ planId: plan.id, name: name.trim(), billingPeriod: period, pricePKR, dailyLikeAllowance }), plan.id);
      } else {
        await call(() => adminApi.adminCreateTravelMatePlan({ name: name.trim(), billingPeriod: period, pricePKR, dailyLikeAllowance }), 'create');
      }
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <Card style={{ width: 400, maxWidth: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text }}>{plan ? 'Edit plan' : 'New plan'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: colors.muted }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Plan name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Weekly Pro" style={inputStyle} />
          </Field>
          <Field label="Billing period">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['weekly', 'yearly'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)} style={{ ...pillStyle, ...(period === p ? pillActiveStyle : {}) }}>{p}</button>
              ))}
            </div>
          </Field>
          <Field label="Price (PKR)">
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="299" style={inputStyle} />
          </Field>
          <Field label="Daily like allowance">
            <input type="number" value={likes} onChange={e => setLikes(e.target.value)} placeholder="20" style={inputStyle} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="primary" disabled={loading} onClick={submit}>{loading ? '…' : plan ? 'Save' : 'Create'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

// ── Subscriptions tab ─────────────────────────────────────────────────────────

function SubsTab({
  subs,
  filter,
  setFilter,
  busy,
  call,
}: {
  subs: Sub[];
  filter: SubFilter;
  setFilter: (f: SubFilter) => void;
  busy: string | null;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [rejectModal, setRejectModal] = useState<Sub | null>(null);

  async function approve(s: Sub) {
    if (!confirm(`Approve subscription for ${s.uid.slice(0, 8)}…? This will debit their wallet and grant daily likes.`)) return;
    await call(() => adminApi.approveTravelMateSubscription({ subscriptionId: s.id }), s.id);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['pending', 'active', 'rejected', 'expired'] as SubFilter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...pillStyle, ...(filter === f ? pillActiveStyle : {}) }}>
            {f}
          </button>
        ))}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>
                <th style={th}>User UID</th>
                <th style={th}>Plan</th>
                <th style={th}>Payment</th>
                <th style={th}>Requested</th>
                <th style={th}>Expires</th>
                <th style={th}>Status</th>
                {filter === 'pending' && <th style={th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 && (
                <tr><td colSpan={filter === 'pending' ? 7 : 6} style={{ padding: 24, textAlign: 'center', color: colors.muted }}>No {filter} subscriptions.</td></tr>
              )}
              {subs.map(s => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={td}><code style={{ fontSize: 11 }}>{s.uid.slice(0, 14)}…</code></td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{s.planSnapshot?.name ?? '—'}</div>
                    <div style={{ color: colors.muted, fontSize: 11 }}>PKR {s.planSnapshot?.pricePKR} · {s.planSnapshot?.dailyLikeAllowance}/day</div>
                  </td>
                  <td style={td}>
                    <div>{s.paymentMethod}</div>
                    {s.paymentProofURL && (
                      <a href={s.paymentProofURL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: colors.primary }}>View proof</a>
                    )}
                  </td>
                  <td style={td}>{s.requestedAt ? fmtDate(s.requestedAt.seconds) : '—'}</td>
                  <td style={td}>{s.endAt ? fmtDate(s.endAt.seconds) : '—'}</td>
                  <td style={td}><StatusBadge status={s.status} /></td>
                  {filter === 'pending' && (
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button variant="primary" disabled={busy === s.id} onClick={() => approve(s)}>
                          {busy === s.id ? '…' : 'Approve'}
                        </Button>
                        <Button variant="danger" disabled={busy === s.id} onClick={() => setRejectModal(s)}>
                          Reject
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {rejectModal && (
        <RejectModal
          sub={rejectModal}
          onClose={() => setRejectModal(null)}
          call={call}
        />
      )}
    </div>
  );
}

function RejectModal({
  sub,
  onClose,
  call,
}: {
  sub: Sub;
  onClose: () => void;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    await call(
      () => adminApi.rejectTravelMateSubscription({ subscriptionId: sub.id, reason: reason.trim() || undefined }),
      sub.id,
    );
    setLoading(false);
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <Card style={{ width: 400, maxWidth: '90%' }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text, marginBottom: 12 }}>Reject subscription</h2>
        <p style={{ fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          User: <code>{sub.uid.slice(0, 14)}…</code> · Plan: {sub.planSnapshot?.name}
        </p>
        <Field label="Rejection reason (optional — shown to user)">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Payment proof unclear. Please re-upload."
            style={{ ...inputStyle, height: 72, resize: 'vertical' }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="danger" disabled={loading} onClick={submit}>{loading ? '…' : 'Reject'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ settings }: { settings: TmSettings }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(settings); }, [settings]);

  async function save() {
    setSaving(true);
    try {
      await setDoc(doc(db, 'config', 'travelMateSettings'), {
        ...form,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  function num(field: keyof TmSettings) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [field]: parseFloat(e.target.value) || 0 }));
  }

  return (
    <Card style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, color: colors.text, marginBottom: 16 }}>Global Travel Mate settings</h2>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Free monthly likes (per user)">
          <input type="number" value={form.freeMonthlySwipes} onChange={num('freeMonthlySwipes')} style={inputStyle} />
        </Field>
        <Field label="Discovery radius (km)">
          <input type="number" step="0.5" value={form.discoveryRadiusKm} onChange={num('discoveryRadiusKm')} style={inputStyle} />
        </Field>
        <Field label="Max group size">
          <input type="number" value={form.maxGroupSize} onChange={num('maxGroupSize')} style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>Enforce mutual gender preference</div>
            <div style={{ fontSize: 11, color: colors.muted }}>Both users must accept each other's gender to appear in each other's feed</div>
          </div>
          <input
            type="checkbox"
            checked={form.enforceMutualGender}
            onChange={e => setForm(prev => ({ ...prev, enforceMutualGender: e.target.checked }))}
            style={{ width: 18, height: 18, accentColor: colors.primary }}
          />
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <Button variant="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save settings'}
        </Button>
      </div>
    </Card>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: colors.muted }}>{label}</label>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'active'   ? colors.primary :
    status === 'pending'  ? '#f59e0b' :
    status === 'rejected' ? colors.danger :
    status === 'inactive' ? colors.danger :
    colors.muted;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, backgroundColor: `${color}22`, color }}>
      {status}
    </span>
  );
}

function fmtDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 700, fontSize: 12 };
const td: React.CSSProperties = { padding: '12px 12px', verticalAlign: 'middle' };

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.surface,
  color: colors.text,
  fontSize: 14,
  boxSizing: 'border-box',
};

const pillStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 99,
  border: `1.5px solid ${colors.border}`,
  backgroundColor: 'transparent',
  color: colors.muted,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'capitalize',
};

const pillActiveStyle: React.CSSProperties = {
  borderColor: colors.primary,
  backgroundColor: `${colors.primary}18`,
  color: colors.primary,
};

// ── Moderation tab ────────────────────────────────────────────────────────────

function ModerationTab({
  reports,
  busy,
  call,
}: {
  reports: ModerationReport[];
  busy: string | null;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendTarget, setSuspendTarget] = useState<string | null>(null);

  async function suspend(uid: string, reason: string) {
    await call(() => adminApi.adminSuspendTravelMateProfile({ targetUid: uid, reason }), `suspend-${uid}`);
    setSuspendTarget(null);
    setSuspendReason('');
  }

  if (reports.length === 0) {
    return (
      <Card>
        <p style={{ color: colors.muted, fontSize: 14, margin: 0, textAlign: 'center' }}>
          No open reports — queue is clear ✅
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {reports.map(r => (
        <Card key={r.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.danger, background: `${colors.danger}18`, padding: '3px 8px', borderRadius: 6 }}>🚩 Open</span>
                {r.createdAt && (
                  <span style={{ fontSize: 11, color: colors.muted }}>
                    {new Date(r.createdAt.seconds * 1000).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 13, color: colors.muted }}>
                  Reporter: <code style={{ color: colors.text, fontSize: 11 }}>{r.reporterId}</code>
                </div>
                <div style={{ fontSize: 13, color: colors.muted }}>
                  Reported: <code style={{ color: colors.text, fontSize: 11 }}>{r.reportedUid}</code>
                </div>
                {r.matchId && (
                  <div style={{ fontSize: 13, color: colors.muted }}>
                    Match: <code style={{ color: colors.text, fontSize: 11 }}>{r.matchId}</code>
                  </div>
                )}
                <div style={{ fontSize: 13, color: colors.text, marginTop: 4, padding: '8px 10px', borderRadius: 8, background: colors.bg }}>
                  "{r.reason}"
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suspendTarget === r.reportedUid ? (
                <div style={{ display: 'grid', gap: 8, minWidth: 220 }}>
                  <input
                    value={suspendReason}
                    onChange={e => setSuspendReason(e.target.value)}
                    placeholder="Suspension reason (optional)"
                    style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="ghost" onClick={() => setSuspendTarget(null)}>Cancel</Button>
                    <Button
                      variant="danger"
                      disabled={busy === `suspend-${r.reportedUid}`}
                      onClick={() => suspend(r.reportedUid, suspendReason)}
                    >
                      {busy === `suspend-${r.reportedUid}` ? 'Suspending…' : 'Confirm suspend'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setSuspendTarget(r.reportedUid)}>
                  Suspend profile
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
