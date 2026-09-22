/**
 * Velocity — Travel Partner — chat management (callable, v2)
 * ----------------------------------------------------------------------------
 * Everything a member needs to get out of a conversation, and everything an
 * admin needs to judge what happened in it.
 *
 *   leaveTravelMateChat        — walk out of a 1:1 chat. Closes it for both and
 *                                hides it from the leaver's inbox.
 *   leaveTravelMateGroupChat   — walk out of a group. Drops membership (and
 *                                with it read access), posts a system line.
 *   reportTravelMateChat       — report the person you are talking to, from a
 *                                1:1, a group, or a profile. Captures a server-
 *                                side transcript so the admin desk can judge the
 *                                report after the chat is gone.
 *   adminResolveTravelMateReport — close a report with an outcome, and carry it
 *                                out: warn, suspend the Travel Partner profile,
 *                                or ban the account.
 *
 * SCOPE — this file is Travel Partner only. The rider↔driver trip chat is
 * deliberately NOT covered: a booked ride is a contract with a person who is on
 * their way to you, and "leave chat" there would strand both sides mid-trip.
 * Trip-chat safety runs through SOS and the disputes desk instead.
 *
 * Identity wall: only travelMate* collections, plus `users/{uid}.banned` and
 * `auditLogs` on the admin path (both already the ban/audit surface elsewhere).
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';

import { performTravelMateBlock } from './community';

const REGION = 'asia-south1';

/** How much of the conversation is frozen into a report. */
const TRANSCRIPT_LIMIT = 30;

/**
 * Why someone is being reported.
 *
 * A fixed list rather than free text alone: the desk needs to sort a queue, and
 * "harassment" typed forty different ways cannot be sorted. The free-text
 * `reason` still travels alongside it.
 */
export const REPORT_CATEGORIES = [
  'harassment',
  'threats',
  'sexual',
  'spam',
  'scam',
  'fake_profile',
  'underage',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

type ReportScope = 'match' | 'group' | 'profile';

interface TranscriptLine {
  id: string;
  senderId: string;
  senderName: string;
  type: string;
  text: string;
  at: FirebaseFirestore.Timestamp | null;
}

/** Best-effort push. A failed notification must never fail the action. */
async function pushTo(uid: string, title: string, body: string, data: Record<string, string>) {
  await sendToUser(uid, title, body, data).catch((e) => {
    console.error('pushTo failed', uid, e);
  });
}

function displayName(info: Record<string, { displayName?: string }> | undefined, uid: string): string {
  return info?.[uid]?.displayName ?? 'Member';
}

/**
 * Freeze the tail of a conversation into the report.
 *
 * Reporting closes the thread, blocking hides it, and a member who leaves a
 * group loses read access — so by the time an admin opens the queue the
 * evidence may be unreachable to everyone but the Admin SDK. Copying it onto
 * the report at filing time is what makes the queue actionable at all, and it
 * is a copy of messages the reporter could already read.
 */
async function captureTranscript(
  roomPath: string,
  nameOf: (uid: string) => string,
): Promise<TranscriptLine[]> {
  const snap = await db
    .collection(`${roomPath}/messages`)
    .orderBy('createdAt', 'desc')
    .limit(TRANSCRIPT_LIMIT)
    .get()
    .catch(() => null);
  if (!snap) return [];

  return snap.docs
    .map((d) => {
      const m = d.data();
      const type = (m.type as string) ?? 'text';
      // Attachments are summarised, never copied: a report is a record of what
      // was said, and pulling media URLs into a doc a different user can read
      // would widen access to that media.
      const text =
        type === 'text' || type === 'system'
          ? ((m.text as string) ?? '')
          : `[${type}]${m.text ? ` ${m.text as string}` : ''}`;
      return {
        id: d.id,
        senderId: (m.senderId as string) ?? '',
        senderName: (m.senderName as string) ?? nameOf((m.senderId as string) ?? ''),
        type,
        text: text.slice(0, 500),
        at: (m.createdAt as FirebaseFirestore.Timestamp) ?? null,
      };
    })
    .reverse(); // oldest first — a transcript reads forwards
}

// ---------------------------------------------------------------------------
// leaveTravelMateChat — 1:1
// ---------------------------------------------------------------------------
// Leaving a two-person conversation ends it. There is no version of this where
// one side walks out and the other keeps talking, so the thread closes for both
// and the leaver stops seeing it at all. The other side keeps the history and a
// banner saying what happened — silently vanishing reads as a bug, and a person
// who has been left is owed the plain fact rather than a mystery.
const LeaveChatInput = z.object({ matchId: z.string().min(1).max(256) });

export const leaveTravelMateChat = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = LeaveChatInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const matchRef = db.doc(`travelMateMatches/${parsed.data.matchId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Conversation not found.');
    const match = snap.data()!;
    if (!(match.users as string[]).includes(uid)) {
      throw new HttpsError('permission-denied', 'Not your conversation.');
    }

    const update: Record<string, unknown> = {
      leftBy: FieldValue.arrayUnion(uid),
      leftAt: FieldValue.serverTimestamp(),
      hiddenFor: FieldValue.arrayUnion(uid),
    };
    // An already-closed thread (unmatched, declined, reported) just disappears
    // from this user's list — it is closed, and re-closing it would rewrite
    // someone else's record of who ended it.
    if ((match.status ?? 'active') === 'active') update.status = 'left';
    tx.update(matchRef, update);
  });

  return { left: true };
});

// ---------------------------------------------------------------------------
// leaveTravelMateGroupChat
// ---------------------------------------------------------------------------
// Membership IS access here: the Firestore rules gate group reads on
// `members`, so removing the uid is what actually ends the conversation for
// them. The group survives without them.
const LeaveGroupInput = z.object({ groupId: z.string().min(1).max(128) });

export const leaveTravelMateGroupChat = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = LeaveGroupInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { groupId } = parsed.data;

  const groupRef = db.doc(`travelMateGroups/${groupId}`);
  const sysRef = groupRef.collection('messages').doc();

  const leaverName = await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Group not found.');
    const group = snap.data()!;
    const members: string[] = group.members ?? [];
    if (!members.includes(uid)) throw new HttpsError('permission-denied', 'Not your group.');

    const name = displayName(group.memberInfo, uid);
    const remaining = members.filter((m) => m !== uid);

    const update: Record<string, unknown> = {
      members: FieldValue.arrayRemove(uid),
      [`memberInfo.${uid}`]: FieldValue.delete(),
      leftMembers: FieldValue.arrayUnion(uid),
    };
    // The creator leaving must not leave the group ownerless — the next member
    // by join order inherits it. An empty group is closed rather than left as
    // an orphan somebody could still be invited into.
    if (remaining.length === 0) {
      update.status = 'closed';
      update.closedAt = FieldValue.serverTimestamp();
    } else if (group.createdBy === uid) {
      update.createdBy = remaining[0];
    }
    tx.update(groupRef, update);

    if (remaining.length > 0) {
      const line = `${name} left the group`;
      tx.set(sysRef, {
        senderId: uid,
        senderName: name,
        type: 'system',
        text: line,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(groupRef, {
        lastMessage: line,
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageFrom: uid,
      });
    }
    return name;
  });

  return { left: true, name: leaverName };
});

// ---------------------------------------------------------------------------
// reportTravelMateChat
// ---------------------------------------------------------------------------
const ReportChatInput = z.object({
  scope: z.enum(['match', 'group', 'profile']),
  /** matchId for a 1:1, groupId for a group, absent for a bare profile report. */
  roomId: z.string().min(1).max(256).nullish(),
  reportedUid: z.string().min(1).max(128),
  category: z.enum(REPORT_CATEGORIES).nullish(),
  reason: z.string().trim().max(1000).nullish(),
  /** "Block them too" — the checkbox on the report sheet. */
  alsoBlock: z.boolean().nullish(),
});

/**
 * File a report, with whatever context the scope gives us.
 *
 * Shared with the legacy `reportTravelMateUser` (see social.ts) so every report
 * in the queue has the same shape no matter which screen raised it — the admin
 * desk reads one collection and must not have to special-case where a row came
 * from.
 */
export async function fileTravelMateReport(params: {
  reporterId: string;
  reportedUid: string;
  scope: ReportScope;
  roomId?: string | null;
  category?: ReportCategory | null;
  reason?: string | null;
  alsoBlock?: boolean;
}): Promise<{ reportId: string; blocked: boolean }> {
  const { reporterId, reportedUid, scope } = params;
  if (reportedUid === reporterId) {
    throw new HttpsError('invalid-argument', 'You cannot report yourself.');
  }

  // A report is a cheap accusation and an expensive thing to triage. Twenty a
  // day is far above any honest use and well below a usable harassment tool.
  await rateLimit(reporterId, 'travelMateReport', 20, 86_400);

  const [reporterSnap, reportedSnap] = await Promise.all([
    db.doc(`travelMateProfiles/${reporterId}`).get(),
    db.doc(`travelMateProfiles/${reportedUid}`).get(),
  ]);

  let transcript: TranscriptLine[] = [];
  let roomName: string | null = null;
  let closeMatchId: string | null = null;
  const roomId = params.roomId ?? null;

  if (scope === 'match') {
    if (!roomId) throw new HttpsError('invalid-argument', 'Which conversation?');
    const matchSnap = await db.doc(`travelMateMatches/${roomId}`).get();
    if (!matchSnap.exists) throw new HttpsError('not-found', 'Conversation not found.');
    const match = matchSnap.data()!;
    const users: string[] = match.users ?? [];
    // SECURITY: a non-participant must not be able to attach someone else's
    // conversation to a report — that would both leak the transcript and let
    // them close a thread they are not in.
    if (!users.includes(reporterId)) {
      throw new HttpsError('permission-denied', 'Not your conversation.');
    }
    if (!users.includes(reportedUid)) {
      throw new HttpsError('invalid-argument', 'That person is not in this conversation.');
    }
    transcript = await captureTranscript(`travelMateMatches/${roomId}`, (u) =>
      displayName(match.userInfo, u),
    );
    closeMatchId = roomId;
  } else if (scope === 'group') {
    if (!roomId) throw new HttpsError('invalid-argument', 'Which group?');
    const groupSnap = await db.doc(`travelMateGroups/${roomId}`).get();
    if (!groupSnap.exists) throw new HttpsError('not-found', 'Group not found.');
    const group = groupSnap.data()!;
    const members: string[] = group.members ?? [];
    if (!members.includes(reporterId)) {
      throw new HttpsError('permission-denied', 'Not your group.');
    }
    if (!members.includes(reportedUid)) {
      throw new HttpsError('invalid-argument', 'That person is not in this group.');
    }
    roomName = (group.name as string) ?? null;
    transcript = await captureTranscript(`travelMateGroups/${roomId}`, (u) =>
      displayName(group.memberInfo, u),
    );
  }

  const reportRef = db.collection('travelMateReports').doc();
  await reportRef.set({
    reporterId,
    reporterName: (reporterSnap.data()?.displayName as string) ?? 'Member',
    reportedUid,
    reportedName: (reportedSnap.data()?.displayName as string) ?? 'Member',
    scope,
    roomId,
    roomName,
    // `matchId` predates scopes and the dashboard's older rows carry it. Kept
    // populated for 1:1 reports so one field means the same thing in every row.
    matchId: scope === 'match' ? roomId : null,
    groupId: scope === 'group' ? roomId : null,
    category: params.category ?? 'other',
    reason: (params.reason ?? '').trim() || 'No details given.',
    transcript,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
  });

  // Reporting a 1:1 closes it. Nobody files a report and then wants to carry on
  // the conversation, and leaving it open means the reported person gets to
  // keep talking while the queue is triaged.
  if (closeMatchId) {
    await db.doc(`travelMateMatches/${closeMatchId}`).update({
      status: 'unmatched',
      unmatchedBy: reporterId,
      unmatchedAt: FieldValue.serverTimestamp(),
      hiddenFor: FieldValue.arrayUnion(reporterId),
    });
  }

  let blocked = false;
  if (params.alsoBlock) {
    await performTravelMateBlock(reporterId, reportedUid);
    blocked = true;
    await reportRef.update({ alsoBlocked: true });
  }

  return { reportId: reportRef.id, blocked };
}

export const reportTravelMateChat = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const parsed = ReportChatInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid report.');

  const { reportId, blocked } = await fileTravelMateReport({
    reporterId: req.auth.uid,
    reportedUid: parsed.data.reportedUid,
    scope: parsed.data.scope,
    roomId: parsed.data.roomId,
    category: parsed.data.category,
    reason: parsed.data.reason,
    alsoBlock: parsed.data.alsoBlock ?? false,
  });

  return { reportId, status: 'open', blocked };
});

// ---------------------------------------------------------------------------
// adminResolveTravelMateReport
// ---------------------------------------------------------------------------
// The queue was write-only before this: reports arrived, nothing could close
// them, and every row stayed 'open' forever — so the count on the tab measured
// how long the product had existed rather than how much work was waiting.
const ResolveInput = z.object({
  reportId: z.string().min(1).max(128),
  outcome: z.enum(['dismissed', 'warned', 'suspended', 'banned']),
  note: z.string().trim().max(1000).nullish(),
});

export const adminResolveTravelMateReport = onCall({ region: REGION }, async (req: CallableRequest) => {
  const { uid: adminUid } = requireAdmin(req);
  const parsed = ResolveInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid resolution.');
  const { reportId, outcome, note } = parsed.data;

  const reportRef = db.doc(`travelMateReports/${reportId}`);
  const snap = await reportRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Report not found.');
  const report = snap.data()!;
  const targetUid = report.reportedUid as string;

  if (outcome === 'warned') {
    await db.doc(`travelMateProfiles/${targetUid}`).set(
      {
        warnings: FieldValue.increment(1),
        lastWarningAt: FieldValue.serverTimestamp(),
        lastWarningNote: note ?? null,
      },
      { merge: true },
    );
    await pushTo(
      targetUid,
      'A warning about your account ⚠️',
      note?.trim() ||
        'Someone reported your behaviour on Travel Partner. Please review the community rules — further reports may suspend your account.',
      { type: 'travelMate.warning' },
    );
  }

  if (outcome === 'suspended' || outcome === 'banned') {
    // Suspending the Travel Partner profile is what removes them from the feed,
    // discovery and chat. Banning is the account-wide switch on top of it and
    // is the same flag `banPassenger` writes, so one unban path clears both.
    await db.doc(`travelMateProfiles/${targetUid}`).set(
      { active: false, suspendedAt: FieldValue.serverTimestamp(), suspendedReason: note ?? null },
      { merge: true },
    );
  }
  if (outcome === 'banned') {
    await db.doc(`users/${targetUid}`).set(
      { banned: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }

  await reportRef.update({
    status: outcome === 'dismissed' ? 'dismissed' : 'resolved',
    outcome,
    adminNote: note ?? null,
    resolvedBy: adminUid,
    resolvedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('auditLogs').add({
    action: `travelMate.report.${outcome}`,
    type: `travelMate.report.${outcome}`,
    reportId,
    targetUid,
    reporterId: report.reporterId ?? null,
    note: note ?? null,
    by: adminUid,
    actor: adminUid,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, outcome };
});
