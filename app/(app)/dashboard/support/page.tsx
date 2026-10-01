'use client';

/**
 * Velocity Rapid Response — the human half of the desk.
 *
 * The queue is ordered the way a support team should work it: anything a person
 * is waiting on first, urgent before normal, oldest first within that. Tickets
 * the AI is still handling are visible but out of the way — they are not the
 * desk's problem until the assistant hands one over, and a queue that mixes the
 * two trains people to ignore it.
 *
 * ── WHAT THE DESK CAN SEE THAT THE CUSTOMER CANNOT ──────────────────────────
 *
 * The escalation panel shows why the ticket arrived and the account snapshot
 * the AI was looking at when it gave up — what they owe, what credit they hold,
 * where today's target stands, whether they are blocked. Without it the first
 * thing a human does is ask questions the customer has already answered, which
 * is exactly the experience the AI was supposed to remove.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card } from '@/components/ui';

type Status = 'ai_handling' | 'waiting_human' | 'human_handling' | 'resolved';
type Priority = 'normal' | 'high' | 'urgent';

interface Ticket {
  id: string;
  userId: string;
  userName: string | null;
  role: string;
  category: string;
  categoryLabel: string;
  subject: string;
  status: Status;
  priority: Priority;
  handler: 'ai' | 'human';
  assignedTo: string | null;
  assignedName: string | null;
  lastMessage: string;
  lastSender: string;
  lastAt: { seconds: number } | null;
  escalationReason: string | null;
  unreadForDesk: number;
  aiReplies: number;
  satisfaction: 'good' | 'bad' | null;
  tripId: string | null;
  stale: boolean;
  aiContext: Record<string, unknown> | null;
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai' | 'agent' | 'system';
  senderName: string;
  createdAt: { seconds: number } | null;
}

/** Waiting first, then urgency, then oldest. See the file header. */
const STATUS_RANK: Record<Status, number> = {
  waiting_human: 0,
  human_handling: 1,
  ai_handling: 2,
  resolved: 3,
};
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };

const STATUS_LABEL: Record<Status, string> = {
  ai_handling: 'Assistant',
  waiting_human: 'Waiting for us',
  human_handling: 'With us',
  resolved: 'Resolved',
};

function statusColor(s: Status): string {
  if (s === 'waiting_human') return colors.danger;
  if (s === 'human_handling') return colors.success;
  if (s === 'resolved') return colors.muted;
  return colors.primary;
}

function ago(seconds: number | undefined): string {
  if (!seconds) return '';
  const d = Math.floor(Date.now() / 1000 - seconds);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export default function SupportDesk() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'supportTickets'), orderBy('lastAt', 'desc'), limit(150)),
        (snap) =>
          setTickets(
            snap.docs.map((d) => {
              const v = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                userId: (v.userId as string) ?? '',
                userName: (v.userName as string | null) ?? null,
                role: (v.role as string) ?? 'passenger',
                category: (v.category as string) ?? 'other',
                categoryLabel: (v.categoryLabel as string) ?? 'Support',
                subject: (v.subject as string) ?? 'Support request',
                status: (v.status as Status) ?? 'ai_handling',
                priority: (v.priority as Priority) ?? 'normal',
                handler: (v.handler as 'ai' | 'human') ?? 'ai',
                assignedTo: (v.assignedTo as string | null) ?? null,
                assignedName: (v.assignedName as string | null) ?? null,
                lastMessage: (v.lastMessage as string) ?? '',
                lastSender: (v.lastSender as string) ?? 'user',
                lastAt: (v.lastAt as { seconds: number } | null) ?? null,
                escalationReason: (v.escalationReason as string | null) ?? null,
                unreadForDesk: (v.unreadForDesk as number) ?? 0,
                aiReplies: (v.aiReplies as number) ?? 0,
                satisfaction: (v.satisfaction as 'good' | 'bad' | null) ?? null,
                tripId: (v.tripId as string | null) ?? null,
                stale: v.stale === true,
                aiContext: (v.aiContext as Record<string, unknown> | null) ?? null,
              };
            }),
          ),
        (e) => setError(e.message),
      ),
    [],
  );

  const queue = useMemo(() => {
    const rows = tickets.filter((t) => showResolved || t.status !== 'resolved');
    return rows.sort((a, b) => {
      if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) {
        return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      }
      if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      }
      // Oldest first inside a band: the person who has waited longest is next.
      return (a.lastAt?.seconds ?? 0) - (b.lastAt?.seconds ?? 0);
    });
  }, [tickets, showResolved]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;
  const waiting = tickets.filter((t) => t.status === 'waiting_human').length;
  const urgent = tickets.filter((t) => t.status !== 'resolved' && t.priority === 'urgent').length;
  const withAi = tickets.filter((t) => t.status === 'ai_handling').length;
  const resolvedByAi = tickets.filter((t) => t.status === 'resolved' && t.aiReplies > 0).length;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>⚡ Velocity Rapid Response</h1>
      <p style={{ color: colors.muted, marginBottom: 18 }}>
        The assistant answers first. Everything it hands over lands here — oldest and most
        urgent at the top.
      </p>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}

      <div style={statsRow}>
        <Stat label="Waiting for a person" value={String(waiting)} tone={waiting > 0 ? 'danger' : undefined} />
        <Stat label="Urgent open" value={String(urgent)} tone={urgent > 0 ? 'danger' : undefined} />
        <Stat label="Assistant handling" value={String(withAi)} />
        <Stat label="Closed by the assistant" value={String(resolvedByAi)} />
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── The queue ── */}
        <div style={{ flex: '1 1 380px', minWidth: 320, display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12, color: colors.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved
          </label>

          {queue.length === 0 ? (
            <Card>
              <div style={{ color: colors.muted, fontSize: 14 }}>
                Nothing in the queue. Every complaint has been answered.
              </div>
            </Card>
          ) : (
            queue.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                style={{
                  ...queueRow,
                  borderColor: t.id === selectedId ? colors.primary : colors.border,
                  borderWidth: t.id === selectedId ? 2 : 1,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <Badge label={STATUS_LABEL[t.status]} color={statusColor(t.status)} />
                  {t.priority !== 'normal' && (
                    <Badge
                      label={t.priority === 'urgent' ? 'URGENT' : 'High'}
                      color={t.priority === 'urgent' ? colors.danger : colors.warn}
                    />
                  )}
                  {t.stale && <Badge label="Overdue" color={colors.danger} />}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: colors.muted }}>
                    {ago(t.lastAt?.seconds)}
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 14, color: colors.text }}>{t.subject}</div>
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  {t.userName ?? t.userId.slice(0, 8)} · {t.role} · {t.categoryLabel}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: colors.muted,
                    marginTop: 6,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.lastSender === 'user' ? '👤 ' : t.lastSender === 'ai' ? '⚡ ' : '🧑‍💼 '}
                  {t.lastMessage}
                </div>
              </button>
            ))
          )}
        </div>

        {/* ── The thread ── */}
        <div style={{ flex: '1 1 460px', minWidth: 340 }}>
          {selected ? (
            <Thread ticket={selected} />
          ) : (
            <Card>
              <div style={{ color: colors.muted, fontSize: 14 }}>
                Pick a ticket to read the conversation and reply.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Thread({ ticket }: { ticket: Ticket }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, 'supportTickets', ticket.id, 'messages'),
          orderBy('createdAt', 'asc'),
          limit(200),
        ),
        (snap) =>
          setMessages(
            snap.docs.map((d) => ({
              id: d.id,
              text: (d.get('text') as string) ?? '',
              sender: (d.get('sender') as Message['sender']) ?? 'user',
              senderName: (d.get('senderName') as string) ?? '',
              createdAt: (d.get('createdAt') as { seconds: number } | null) ?? null,
            })),
          ),
      ),
    [ticket.id],
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send(resolve: boolean) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await adminApi.replySupportTicket({ ticketId: ticket.id, text: trimmed, resolve });
      setText('');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: Status) {
    setBusy(true);
    try {
      await adminApi.setSupportTicketStatus({ ticketId: ticket.id, status });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  const ctx = ticket.aiContext;

  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: colors.text }}>{ticket.subject}</div>
          <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
            {ticket.categoryLabel} · {ticket.userName ?? ticket.userId} · {ticket.role}
            {ticket.tripId ? ` · trip ${ticket.tripId}` : ''}
          </div>
        </div>
        <Badge label={STATUS_LABEL[ticket.status]} color={statusColor(ticket.status)} />
      </div>

      {/* Why it arrived, and what the assistant was looking at when it did. */}
      {ticket.escalationReason && ticket.status !== 'resolved' && (
        <div style={escalationBox}>
          <div style={{ fontSize: 12, fontWeight: 800, color: colors.text }}>
            Handed over: {ticket.escalationReason}
          </div>
          {ctx ? (
            <div style={{ fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 1.7 }}>
              {ctx.banned === true && <div>⛔ This account is BANNED.</div>}
              {typeof ctx.outstanding === 'number' && ctx.outstanding > 0 && (
                <div>Unpaid cancellation fees: PKR {(ctx.outstanding as number).toLocaleString()}</div>
              )}
              {typeof ctx.commissionDue === 'number' && ctx.commissionDue > 0 && (
                <div>Commission they owe now: PKR {(ctx.commissionDue as number).toLocaleString()}</div>
              )}
              {typeof ctx.commissionCredit === 'number' && (ctx.commissionCredit as number) > 0 && (
                <div>
                  Commission credit held: PKR {(ctx.commissionCredit as number).toLocaleString()}
                </div>
              )}
              {ctx.activeTripId ? <div>On a ride right now: {String(ctx.activeTripId)}</div> : null}
              {ctx.dailyTarget && typeof ctx.dailyTarget === 'object' ? (
                <div>
                  Today&apos;s target:{' '}
                  {(ctx.dailyTarget as { rides?: number }).rides ?? 0} /{' '}
                  {(ctx.dailyTarget as { target?: number }).target ?? 0} rides
                  {(ctx.dailyTarget as { granted?: boolean }).granted ? ' — bonus already paid' : ''}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {ticket.satisfaction && (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            fontWeight: 700,
            color: ticket.satisfaction === 'good' ? colors.success : colors.danger,
          }}
        >
          {ticket.satisfaction === 'good'
            ? '👍 The customer said this was sorted'
            : '👎 The customer said this did NOT help'}
        </div>
      )}

      {/* ── Conversation ── */}
      <div style={threadBox}>
        {messages.map((m) => {
          const mine = m.sender === 'agent';
          const system = m.sender === 'system';
          if (system) {
            return (
              <div key={m.id} style={{ fontSize: 11.5, color: colors.muted, textAlign: 'center', fontStyle: 'italic' }}>
                {m.text}
              </div>
            );
          }
          return (
            <div
              key={m.id}
              style={{
                alignSelf: m.sender === 'user' ? 'flex-start' : 'flex-end',
                maxWidth: '85%',
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 800, color: colors.muted, marginBottom: 3 }}>
                {m.sender === 'user' ? '👤 ' : m.sender === 'ai' ? '⚡ ' : '🧑‍💼 '}
                {m.senderName} · {ago(m.createdAt?.seconds)}
              </div>
              <div
                style={{
                  background: mine ? colors.primary : m.sender === 'ai' ? '#f1f5f0' : '#fff',
                  color: mine ? '#ffffff' : colors.text,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: '9px 12px',
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.text}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {/* ── Reply ── */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reply as Velocity Rides…"
        rows={4}
        style={textareaStyle}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Button onClick={() => send(false)} disabled={busy || !text.trim()}>
          {busy ? 'Sending…' : 'Send reply'}
        </Button>
        <Button onClick={() => send(true)} disabled={busy || !text.trim()}>
          Send &amp; resolve
        </Button>
        {ticket.status !== 'human_handling' && ticket.status !== 'resolved' && (
          <Button onClick={() => setStatus('human_handling')} disabled={busy}>
            Claim
          </Button>
        )}
        {ticket.status !== 'resolved' && (
          <Button onClick={() => setStatus('resolved')} disabled={busy}>
            Mark resolved
          </Button>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div style={statBox}>
      <div
        style={{
          fontSize: 24,
          fontWeight: 900,
          color: tone === 'danger' ? colors.danger : colors.text,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
    </div>
  );
}

const statsRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10,
  marginBottom: 20,
};
const statBox: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  padding: 14,
};
const queueRow: React.CSSProperties = {
  textAlign: 'left',
  background: '#fff',
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  padding: 12,
  cursor: 'pointer',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
const escalationBox: React.CSSProperties = {
  marginTop: 12,
  background: '#fff7ed',
  border: '1px solid #fdba74',
  borderRadius: 10,
  padding: 11,
};
const threadBox: React.CSSProperties = {
  marginTop: 14,
  maxHeight: 420,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  background: colors.bg,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
};
const textareaStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: '#fff',
  color: colors.text,
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  resize: 'vertical',
};
