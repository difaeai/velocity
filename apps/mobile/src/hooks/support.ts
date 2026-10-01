/**
 * Live subscriptions for the Velocity Rapid Response System.
 *
 * Reads are direct Firestore streams and writes all go through callables (see
 * src/api/client.ts). That split is the whole design: a thread has to update
 * the instant the AI or an agent answers, and nothing a client could write into
 * a support thread would be trustworthy — a forged "Velocity Rides: approved,
 * your refund is on the way" is a screenshot somebody will wave at us later.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { db } from '../firebase';
import { CHAT_WINDOW, oldestFirst } from '../lib/chatWindow';
import type { SupportCategory, SupportStatus } from '../api/client';

export interface SupportTicket {
  id: string;
  category: SupportCategory;
  categoryLabel: string;
  subject: string;
  status: SupportStatus;
  handler: 'ai' | 'human';
  priority: 'normal' | 'high' | 'urgent';
  lastMessage: string;
  lastSender: 'user' | 'ai' | 'agent' | 'system';
  lastAt: { seconds: number } | null;
  unreadForUser: number;
  assignedName: string | null;
  satisfaction: 'good' | 'bad' | null;
  tripId: string | null;
  createdAt: { seconds: number } | null;
}

export interface SupportMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai' | 'agent' | 'system';
  senderName: string;
  createdAt: { seconds: number } | null;
}

function toTicket(id: string, get: (f: string) => unknown): SupportTicket {
  return {
    id,
    category: (get('category') as SupportCategory | undefined) ?? 'other',
    categoryLabel: (get('categoryLabel') as string | undefined) ?? 'Support',
    subject: (get('subject') as string | undefined) ?? 'Support request',
    status: (get('status') as SupportStatus | undefined) ?? 'ai_handling',
    handler: (get('handler') as 'ai' | 'human' | undefined) ?? 'ai',
    priority: (get('priority') as SupportTicket['priority'] | undefined) ?? 'normal',
    lastMessage: (get('lastMessage') as string | undefined) ?? '',
    lastSender: (get('lastSender') as SupportTicket['lastSender'] | undefined) ?? 'user',
    lastAt: (get('lastAt') as { seconds: number } | null | undefined) ?? null,
    unreadForUser: (get('unreadForUser') as number | undefined) ?? 0,
    assignedName: (get('assignedName') as string | null | undefined) ?? null,
    satisfaction: (get('satisfaction') as 'good' | 'bad' | null | undefined) ?? null,
    tripId: (get('tripId') as string | null | undefined) ?? null,
    createdAt: (get('createdAt') as { seconds: number } | null | undefined) ?? null,
  };
}

/** Every complaint this person has filed, newest first. */
export function useSupportTickets(uid: string | undefined): {
  tickets: SupportTicket[];
  loading: boolean;
} {
  // Stored with the uid they belong to and read back only on a match, so
  // signing out cannot leave the previous account's complaints on screen and
  // the effect body never has to clear state.
  const [loaded, setLoaded] = useState<{ uid: string; tickets: SupportTicket[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'supportTickets'),
      where('userId', '==', uid),
      orderBy('lastAt', 'desc'),
      limit(40),
    );
    return onSnapshot(
      q,
      (snap) => setLoaded({ uid, tickets: snap.docs.map((d) => toTicket(d.id, (f) => d.get(f))) }),
      () => setFailed(true),
    );
  }, [uid]);

  const tickets = loaded && loaded.uid === uid ? loaded.tickets : EMPTY_TICKETS;
  return { tickets, loading: !!uid && !failed && loaded?.uid !== uid };
}

/** Stable empty array — a fresh `[]` would re-render every consumer. */
const EMPTY_TICKETS: SupportTicket[] = [];

/** Unread replies across every open ticket, for a menu badge. */
export function useSupportUnread(uid: string | undefined): number {
  const { tickets } = useSupportTickets(uid);
  return tickets.reduce((sum, t) => sum + (t.unreadForUser || 0), 0);
}

/** One ticket and its conversation. */
export function useSupportThread(ticketId: string | undefined): {
  ticket: SupportTicket | null;
  messages: SupportMessage[];
  loading: boolean;
} {
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticketId) return;
    return onSnapshot(
      doc(db, 'supportTickets', ticketId),
      (s) => setTicket(s.exists() ? toTicket(s.id, (f) => s.get(f)) : null),
      () => undefined,
    );
  }, [ticketId]);

  useEffect(() => {
    if (!ticketId) return;
    // Most recent window, flipped back into reading order — lib/chatWindow.ts.
    const q = query(
      collection(db, 'supportTickets', ticketId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(CHAT_WINDOW),
    );
    return onSnapshot(
      q,
      (snap) => {
        setMessages(
          oldestFirst(
            snap.docs.map((d) => ({
              id: d.id,
              text: (d.get('text') as string | undefined) ?? '',
              sender: (d.get('sender') as SupportMessage['sender'] | undefined) ?? 'user',
              senderName: (d.get('senderName') as string | undefined) ?? '',
              createdAt: (d.get('createdAt') as { seconds: number } | null | undefined) ?? null,
            })),
          ),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [ticketId]);

  return { ticket, messages, loading };
}
