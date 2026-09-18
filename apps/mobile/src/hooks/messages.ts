/**
 * Every conversation the rider has, in one shape.
 *
 * Velocity grew three unrelated messaging systems: Travel Partner DMs and
 * commute groups (travelMate*), in-ride chat with the driver (trips/{id}/chat),
 * and Queries with the businesses that advertise to you (businessAdQueries).
 * They share nothing — different collections, different write paths, different
 * read rules — and until now they had no shared surface either, so a reply from
 * a shop and a reply from a driver arrived in two unrelated corners of the app.
 *
 * This is the one place that knows about all three. It deliberately does NOT
 * merge them into a single list: a message from the shop you asked about a
 * discount is not the same kind of thing as a message from the driver currently
 * outside your gate, and pretending otherwise is how people miss the one that
 * mattered. The sections stay separate, and a conversation only ever appears in
 * the one it belongs to — the section is decided here, by which system the
 * conversation actually lives in, never by anything the sender wrote.
 *
 * Unread is computed differently per section on purpose, because the three
 * systems genuinely know different things:
 *
 *   - Brands  - the server keeps a real per-side counter (askerUnread), so it
 *               is authoritative and survives a reinstall.
 *   - Partner - the thread records who spoke last; "read" is the local cursor
 *               from lib/chatSeen.
 *   - Drivers - the same local cursor, against the chat summary the send
 *               callable writes onto the trip.
 */
import { useMemo } from 'react';

import type { BusinessAdQueryThread } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Trip, TripStatus } from '../domain/types';
import { useChatSeen } from '../lib/chatSeen';
import { useMyBusinessAdQuestions } from './businessAds';
import { usePassengerTrips, usePoolMemberTrips } from './passenger';
import {
  useTravelMateGroups,
  useTravelMateThreads,
  type TravelGroup,
  type TravelThread,
} from './travelMateCommunity';

export type MessageSection = 'partner' | 'drivers' | 'brands';

export const MESSAGE_SECTIONS: MessageSection[] = ['partner', 'drivers', 'brands'];

/** What each section is, in the words the rider would use. */
export const SECTION_META: Record<
  MessageSection,
  { title: string; short: string; emoji: string; blurb: string; accent: string }
> = {
  partner: {
    title: 'Messages · Travel Partner',
    short: 'Travel Partner',
    emoji: '🤝',
    blurb: 'People you matched with, and your commute groups.',
    accent: '#ccff00',
  },
  drivers: {
    title: 'Messages from Drivers',
    short: 'Drivers',
    emoji: '🚗',
    blurb: 'In-ride chat with the driver of each of your rides.',
    accent: '#3b82f6',
  },
  brands: {
    title: 'Messages from Brands',
    short: 'Brands',
    emoji: '🏷️',
    blurb: 'Businesses answering what you asked about their offers.',
    accent: '#f59e0b',
  },
};

/** Where a row goes when it is tapped. */
export type MessageTarget =
  /** A push-navigated screen that already exists. */
  | { kind: 'route'; href: string }
  /**
   * Ride chat has no screen of its own — it is a modal over the trip. Opening
   * it from the inbox reuses the same ChatModal rather than routing through a
   * trip screen the rider did not ask to see, which for a finished ride would
   * be the wrong destination entirely.
   */
  | { kind: 'tripChat'; tripId: string; driverName: string };

export interface MessageRow {
  id: string;
  section: MessageSection;
  title: string;
  /** The last thing said, or an invitation to say the first thing. */
  preview: string;
  /** What the conversation is about — the ride, the offer, the group. */
  context: string | null;
  photoURL: string | null;
  /** Avatar fallback when there is no photo. */
  emoji: string;
  atSeconds: number | null;
  unread: boolean;
  /** A real number worth showing instead of a dot (message requests). */
  count: number | null;
  target: MessageTarget;
}

export interface MessagesInbox {
  rows: Record<MessageSection, MessageRow[]>;
  unread: Record<MessageSection, number>;
  total: number;
  loading: boolean;
}

const EMPTY_ROWS: Record<MessageSection, MessageRow[]> = { partner: [], drivers: [], brands: [] };

/** Newest first, with rows nobody has spoken on falling to the end. */
function byRecency(a: MessageRow, b: MessageRow): number {
  return (b.atSeconds ?? 0) - (a.atSeconds ?? 0);
}

const LIVE_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
  'requested', 'matched', 'arriving', 'arrived', 'in_progress',
]);

/**
 * Where this rider was going on that ride.
 *
 * On a pool, the trip's own dropoff is the person who booked it — everybody else
 * gets out somewhere else, and labelling their conversation with a stranger's
 * destination is worse than labelling it with nothing.
 */
function myDropoff(trip: Trip, uid: string): string | undefined {
  if (trip.passengerId !== uid) {
    const roster = trip.poolRoster?.find((r) => r.uid === uid)?.dropoffAddress;
    const rider = trip.poolRiders?.find((r) => r.uid === uid)?.dropoff?.address;
    return (roster ?? rider ?? trip.dropoff?.address) || undefined;
  }
  return trip.dropoff?.address || undefined;
}

/** What the ride was, for the line under the driver's name. */
function tripContext(trip: Trip, uid: string): string {
  const where = myDropoff(trip, uid)?.split(',')[0]?.trim();
  if (LIVE_STATUSES.has(trip.status)) return where ? `Ride in progress · ${where}` : 'Ride in progress';
  if (trip.status === 'cancelled') return where ? `Cancelled ride · ${where}` : 'Cancelled ride';
  return where ? `Ride to ${where}` : 'Past ride';
}

type SeenAt = (kind: 'trip' | 'mate' | 'group', id: string) => number;

function threadRow(thread: TravelThread, uid: string, seenAt: SeenAt, ready: boolean): MessageRow {
  const otherId = thread.users.find((u) => u !== uid) ?? '';
  const other = thread.userInfo?.[otherId];
  const at = thread.lastMessageAt?.seconds ?? thread.matchedAt?.seconds ?? null;
  // Their message, arrived after the last time this thread was opened. A thread
  // whose last message is the rider's own is never unread; one that predates
  // `lastMessageFrom` reads as unread until it is opened once, which is the safe
  // direction and corrects itself on that first open.
  const fromThem = thread.lastMessageFrom ? thread.lastMessageFrom !== uid : true;
  const unread =
    ready &&
    !!thread.lastMessageAt &&
    fromThem &&
    thread.lastMessageAt.seconds * 1000 > seenAt('mate', thread.id);

  return {
    id: `mate:${thread.id}`,
    section: 'partner',
    title: other?.displayName ?? 'Travel Partner',
    preview: thread.lastMessage ?? 'You matched — say hello',
    context: thread.lastMessage ? null : 'New match',
    photoURL: other?.photoURL ?? null,
    emoji: '👤',
    atSeconds: at,
    unread,
    count: null,
    target: { kind: 'route', href: `/passenger/travel-mate/chat/${thread.id}` },
  };
}

function groupRow(group: TravelGroup, uid: string, seenAt: SeenAt, ready: boolean): MessageRow {
  const at = group.lastMessageAt?.seconds ?? null;
  const fromThem = group.lastMessageFrom ? group.lastMessageFrom !== uid : true;
  const unread =
    ready &&
    !!group.lastMessageAt &&
    fromThem &&
    group.lastMessageAt.seconds * 1000 > seenAt('group', group.id);

  const size = group.members?.length ?? 0;
  return {
    id: `group:${group.id}`,
    section: 'partner',
    title: group.name?.trim() || 'Commute group',
    preview: group.lastMessage ?? 'No messages yet — start the group off',
    context: group.destinationName
      ? `Group · ${size} members · ${group.destinationName}`
      : `Group · ${size} members`,
    photoURL: null,
    emoji: '👥',
    atSeconds: at,
    unread,
    count: null,
    target: { kind: 'route', href: `/passenger/travel-mate/group-chat/${group.id}` },
  };
}

function driverRow(trip: Trip, uid: string, seenAt: SeenAt, ready: boolean): MessageRow {
  const name = trip.driverInfo?.displayName ?? 'Your driver';
  const at = trip.chatLastMessageAt?.seconds ?? null;
  const fromThem = !!trip.chatLastSenderId && trip.chatLastSenderId !== uid;
  const unread =
    ready &&
    !!trip.chatLastMessageAt &&
    fromThem &&
    trip.chatLastMessageAt.seconds * 1000 > seenAt('trip', trip.id);

  return {
    id: `trip:${trip.id}`,
    section: 'drivers',
    title: name,
    preview: trip.chatLastMessage ?? 'Tap to message your driver',
    context: tripContext(trip, uid),
    photoURL: trip.driverInfo?.photoURL ?? null,
    emoji: '🚕',
    // A live ride with nothing said on it yet still belongs near the top: it is
    // the conversation most likely to be wanted next.
    atSeconds: at ?? (LIVE_STATUSES.has(trip.status) ? trip.createdAt?.seconds ?? null : null),
    unread,
    count: null,
    target: { kind: 'tripChat', tripId: trip.id, driverName: name },
  };
}

function brandRow(thread: BusinessAdQueryThread): MessageRow {
  return {
    id: `brand:${thread.queryId}`,
    section: 'brands',
    title: thread.businessName || 'Business',
    preview: thread.lastMessage || 'You asked about this offer',
    context: thread.adTitle ? `Offer · ${thread.adTitle}` : null,
    photoURL: thread.adImageUrl,
    emoji: '🏪',
    atSeconds: thread.lastMessageAtMs ? Math.floor(thread.lastMessageAtMs / 1000) : null,
    // A server-side counter — the only section that can be sure across devices.
    unread: thread.askerUnread > 0,
    count: null,
    target: { kind: 'route', href: `/passenger/offer-query/${thread.queryId}` },
  };
}

/**
 * The whole inbox: three sections, their rows, and how many of each are unread.
 *
 * Mounted by the Messages screen and by the home drawer's badge, so it has to
 * stay cheap: four live queries, every one of them already run elsewhere in the
 * app, and no per-conversation reads.
 */
export function useMessagesInbox(): MessagesInbox {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { seenAt, ready } = useChatSeen();

  const { chats, requests } = useTravelMateThreads();
  const groups = useTravelMateGroups();
  const { trips, loading: tripsLoading } = usePassengerTrips(user?.uid);
  // Rides this user joined rather than booked. They share the car with the
  // driver, so they share the conversation — sendTripMessage has always pushed
  // to them.
  const poolTrips = usePoolMemberTrips(user?.uid);
  const { threads: brandThreads, loading: brandsLoading } = useMyBusinessAdQuestions();

  return useMemo(() => {
    if (!uid) {
      return { rows: EMPTY_ROWS, unread: { partner: 0, drivers: 0, brands: 0 }, total: 0, loading: false };
    }

    // -- Travel Partner --
    const partner: MessageRow[] = [
      ...chats.map((t) => threadRow(t, uid, seenAt, ready)),
      ...groups.map((g) => groupRow(g, uid, seenAt, ready)),
    ].sort(byRecency);

    // A request is not a conversation yet — it is a decision — so it sits above
    // the sorted list rather than inside it, exactly as it does in Chats.
    if (requests.length > 0) {
      const first = requests[0];
      const newest = requests.reduce((s, t) => Math.max(s, t.lastMessageAt?.seconds ?? 0), 0);
      partner.unshift({
        id: 'partner:requests',
        section: 'partner',
        title: 'Message requests',
        preview:
          requests.length === 1
            ? `${first?.userInfo?.[first?.requestFrom ?? '']?.displayName ?? 'Someone'} wants to chat`
            : `${requests.length} people want to chat`,
        context: 'Accept or delete',
        photoURL: null,
        emoji: '✉️',
        atSeconds: newest || null,
        unread: true,
        count: requests.length,
        target: { kind: 'route', href: '/passenger/travel-mate/message-requests' },
      });
    }

    // -- Drivers --
    // Only rides that have a driver to talk to, and only the ones actually
    // talked on — plus any ride still running, because "message my driver" is
    // the single most useful thing this section can offer.
    // A pool the rider booked is in both lists — `poolMembers` includes the
    // host — so the merge is by trip id, first one wins.
    const byId = new Map<string, Trip>();
    for (const t of [...trips, ...poolTrips]) if (!byId.has(t.id)) byId.set(t.id, t);

    const drivers = [...byId.values()]
      .filter((t) => !!t.driverId && (!!t.chatLastMessageAt || LIVE_STATUSES.has(t.status)))
      .map((t) => driverRow(t, uid, seenAt, ready))
      .sort(byRecency);

    // -- Brands --
    const brands = brandThreads.map(brandRow).sort(byRecency);

    const rows = { partner, drivers, brands };
    const unread = {
      partner: partner.filter((r) => r.unread).length,
      drivers: drivers.filter((r) => r.unread).length,
      brands: brands.filter((r) => r.unread).length,
    };

    return {
      rows,
      unread,
      total: unread.partner + unread.drivers + unread.brands,
      loading: tripsLoading || brandsLoading,
    };
    // `seenAt` changes identity whenever a conversation is marked read, which is
    // what clears a row here the moment it is opened.
  }, [uid, chats, groups, requests, trips, poolTrips, brandThreads, seenAt, ready, tripsLoading, brandsLoading]);
}

/** Just the number behind the drawer's Messages badge. */
export function useMessagesUnreadTotal(): number {
  return useMessagesInbox().total;
}
