/**
 * Velocity Ambassador Program — apply, approve, and the ambassador's own board.
 * ----------------------------------------------------------------------------
 * The third way into "Earn with Velocity" and the only one nobody buys (owner,
 * 2026-11-18): a campus ambassador applies, an admin approves them, and they
 * then work two targets for a salary. See ./config.ts for the money.
 *
 * WHAT WE ASK FOR, AND WHAT WE DO NOT
 * -----------------------------------
 * A CV *or* a CNIC photo. One document, their choice. The name and the phone
 * number come off the account they are already signed in with — the same
 * profile the app built when they signed up — because asking a student to
 * retype their own name under a heading that already greets them by it is the
 * kind of form that does not get finished.
 *
 * The bank account is NOT asked for here. It is added after approval
 * (`setAmbassadorPayout`), because an account number collected from somebody
 * who is then rejected is a bank detail we are holding for no reason.
 *
 * COUNTING IS NOT DONE HERE
 * -------------------------
 * `usersOnboarded` is incremented by the referral claim (partners/referrals.ts)
 * and `partnersSold` by the partner approval (partners/applications.ts), each
 * inside the transaction that makes the thing true. A counter that is written
 * anywhere other than the moment the event happens will drift, and these two
 * decide whether a person is paid a salary.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAdmin, requireAuth } from '../lib/guards';
import { notifyUser } from '../lib/fcm';
import { rateLimit } from '../lib/ratelimit';
// The same bucket check the advertising applications use: a document must live
// in our own storage, never at a URL the client made up.
import { isOwnStorageUrl } from '../businessAds/applications';
import { getAmbassadorSettings, progress } from './config';

export type AmbassadorStatus = 'pending' | 'approved' | 'rejected' | 'resubmit' | 'suspended';

/**
 * A five-digit code no partner AND no ambassador already holds.
 *
 * It shares the numbering with the partner program on purpose: one box in the
 * profile takes one code, and a recruit must never have to know which kind of
 * person gave it to them. That is exactly why both collections are checked —
 * a code that resolved to two owners would pay the wrong one.
 */
async function mintAmbassadorCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = String(Math.floor(10000 + Math.random() * 90000));
    const [partnerClash, ambassadorClash] = await Promise.all([
      db.collection('partners').where('referralCode', '==', code).limit(1).get(),
      db.collection('ambassadors').where('referralCode', '==', code).limit(1).get(),
    ]);
    if (partnerClash.empty && ambassadorClash.empty) return code;
  }
  throw new Error('Could not mint a unique ambassador code.');
}

const applySchema = z
  .object({
    /** Their CV. Either this or `cnicUrl` — one document, their choice. */
    cvUrl: z.string().url().max(2048).optional(),
    cnicUrl: z.string().url().max(2048).optional(),
    /** Optional: a line about themselves. Never required. */
    about: z.string().trim().max(600).optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Ambassador Program terms.' }),
    }),
  })
  .refine((d) => !!d.cvUrl || !!d.cnicUrl, {
    message: 'Attach your CV or a photo of your CNIC.',
    path: ['cvUrl'],
  });

export const applyAmbassador = onCall(async (req) => {
  const { uid } = requireAuth(req);
  // Cheap to file, expensive to read. Three an hour is far more than a real
  // applicant needs and far less than a script.
  await rateLimit(uid, 'ambassadorApply', 3, 3600);

  const parsed = applySchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid application.');
  const data = parsed.data;

  for (const url of [data.cvUrl, data.cnicUrl]) {
    if (url && !isOwnStorageUrl(url)) {
      invalid('Upload your document to Velocity Rides rather than linking to it.');
    }
  }

  // An approved ambassador re-applying would mint a second code and orphan the
  // recruits counted against the first.
  const existing = await db.doc(`ambassadors/${uid}`).get();
  if (existing.exists && existing.get('status') === 'approved') {
    invalid('You are already a Velocity Ambassador.');
  }

  const appRef = db.doc(`ambassadorApplications/${uid}`);
  const prior = await appRef.get();
  if (prior.get('status') === 'pending') {
    invalid('Your ambassador application is already waiting for approval.');
  }

  // The name and number come off the account, not off a form (owner).
  const me = (await db.doc(`users/${uid}`).get()).data() ?? {};
  const fullName =
    (typeof me.name === 'string' && me.name.trim()) ||
    (typeof me.displayName === 'string' && me.displayName.trim() && me.displayName !== 'New User'
      ? (me.displayName as string).trim()
      : '') ||
    '';
  if (!fullName) {
    invalid('Add your name to your Velocity Rides profile first, then apply.');
  }

  await appRef.set({
    uid,
    status: 'pending' as AmbassadorStatus,
    fullName,
    mobile: (me.phoneNumber as string | undefined) ?? null,
    cvUrl: data.cvUrl ?? null,
    cnicUrl: data.cnicUrl ?? null,
    about: data.about ?? null,
    acceptedTerms: true,
    // A resubmission is a fresh queue entry, so the old verdict goes.
    rejectionReason: null,
    reviewedAt: null,
    reviewedBy: null,
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info('Ambassador application submitted', { uid });
  return { ok: true, status: 'pending' as AmbassadorStatus };
});

const reviewSchema = z.object({
  uid: docId,
  decision: z.enum(['approve', 'reject', 'resubmit']),
  reason: z.string().trim().max(500).optional(),
});

export const adminReviewAmbassador = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid review.');
  const { uid, decision, reason } = parsed.data;

  if (decision !== 'approve' && !reason) {
    invalid('Give the applicant a reason so they know what to fix.');
  }

  const appRef = db.doc(`ambassadorApplications/${uid}`);
  const snap = await appRef.get();
  if (!snap.exists) invalid('No ambassador application found for this user.');
  if (snap.get('status') === 'approved') invalid('This application is already approved.');

  const status: AmbassadorStatus =
    decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'resubmit';

  // An ambassador approved once keeps the code they already handed out. Minting
  // a second one would strand every poster and every recruit on the first.
  const already = await db.doc(`ambassadors/${uid}`).get();
  const existingCode = already.get('referralCode') as string | undefined;
  // Minting queries for collisions, so it happens before the transaction —
  // Firestore forbids reading after writing.
  const code =
    decision === 'approve' ? (existingCode ?? (await mintAmbassadorCode())) : null;
  const settings = await getAmbassadorSettings();

  await db.runTransaction(async (tx) => {
    const now = FieldValue.serverTimestamp();

    tx.update(appRef, {
      status,
      rejectionReason: decision === 'approve' ? null : reason,
      reviewedAt: now,
      reviewedBy: admin.uid,
      updatedAt: now,
    });

    if (decision === 'approve' && code) {
      tx.set(
        db.doc(`ambassadors/${uid}`),
        {
          uid,
          status: 'approved' as AmbassadorStatus,
          referralCode: code,
          fullName: snap.get('fullName') ?? 'Velocity Ambassador',
          mobile: snap.get('mobile') ?? null,
          cvUrl: snap.get('cvUrl') ?? null,
          cnicUrl: snap.get('cnicUrl') ?? null,
          // The targets this ambassador signed up against, snapshotted. A later
          // change to the program must not move the goalposts under somebody
          // who is already halfway to them.
          userTarget: already.get('userTarget') ?? settings.userTarget,
          partnerTarget: already.get('partnerTarget') ?? settings.partnerTarget,
          salaryPkr: already.get('salaryPkr') ?? settings.salaryPkr,
          // Counters survive a re-approval: they are the work already done.
          usersOnboarded: already.get('usersOnboarded') ?? 0,
          partnersSold: already.get('partnersSold') ?? 0,
          payoutAccount: already.get('payoutAccount') ?? null,
          approvedAt: now,
          approvedBy: admin.uid,
          // `?? now` is not belt and braces: the referral claim creates this
          // same document with `merge` to bump a counter, so it can exist with
          // no `createdAt` on it — and an undefined in a write makes Firestore
          // throw, which would fail the approval itself.
          createdAt: (already.exists ? already.get('createdAt') : null) ?? now,
          updatedAt: now,
        },
        { merge: true },
      );
    }

    tx.set(db.collection('auditLogs').doc(), {
      type: `ambassador.application.${status}`,
      actor: admin.uid,
      targetUid: uid,
      code: code ?? null,
      reason: reason ?? null,
      createdAt: now,
    });
  });

  const copy: Record<AmbassadorStatus, { title: string; body: string }> = {
    approved: {
      title: 'You are a Velocity Ambassador 🎉',
      body: `Your code is ${code}. Open Earn with Velocity to see your targets and add the account you want to be paid into.`,
    },
    rejected: {
      title: 'Ambassador application not approved',
      body: reason ?? 'Your ambassador application could not be approved.',
    },
    resubmit: {
      title: 'Ambassador application — more detail needed',
      body: reason ?? 'Please check your document and apply again.',
    },
    pending: { title: '', body: '' },
    suspended: { title: '', body: '' },
  };
  if (copy[status].title) {
    await notifyUser(uid, copy[status].title, copy[status].body, 'system', {
      screen: 'ambassador',
    });
  }

  logger.info('Ambassador application reviewed', { uid, status, by: admin.uid });
  return { ok: true, status, code };
});

/**
 * The account an approved ambassador is paid into.
 *
 * Only after approval, and only their own — this is a bank detail, so it is
 * never collected from somebody who may be rejected and never written by
 * anyone but its owner.
 */
const payoutSchema = z.object({
  accountTitle: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().min(5).max(40),
  bankName: z.string().trim().min(2).max(80),
});

export const setAmbassadorPayout = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = payoutSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Check your account details.');

  const ref = db.doc(`ambassadors/${uid}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('status') !== 'approved') {
    invalid('Your ambassador application has not been approved yet.');
  }

  await ref.set(
    {
      payoutAccount: {
        accountTitle: parsed.data.accountTitle,
        accountNumber: parsed.data.accountNumber,
        bankName: parsed.data.bankName,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('Ambassador payout account set', { uid });
  return { ok: true };
});

/**
 * The ambassador's own board: where they stand and what they are owed.
 *
 * Returns `stage: 'none'` rather than throwing for somebody who has never
 * applied — the screen that calls this is the one that offers the application,
 * so "you are not an ambassador" is its normal first answer, not an error.
 */
export const getMyAmbassador = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const [appSnap, ambSnap, settings] = await Promise.all([
    db.doc(`ambassadorApplications/${uid}`).get(),
    db.doc(`ambassadors/${uid}`).get(),
    getAmbassadorSettings(),
  ]);

  const appStatus = appSnap.get('status') as AmbassadorStatus | undefined;
  const ambStatus = ambSnap.get('status') as AmbassadorStatus | undefined;

  if (!appSnap.exists && !ambSnap.exists) {
    return { ok: true, stage: 'none' as const, settings };
  }

  if (ambStatus === 'approved' || ambStatus === 'suspended') {
    // The targets this ambassador was approved against, not today's — see the
    // snapshot note in the approval above.
    const theirs = {
      ...settings,
      userTarget: (ambSnap.get('userTarget') as number | undefined) ?? settings.userTarget,
      partnerTarget: (ambSnap.get('partnerTarget') as number | undefined) ?? settings.partnerTarget,
      salaryPkr: (ambSnap.get('salaryPkr') as number | undefined) ?? settings.salaryPkr,
    };
    return {
      ok: true,
      stage: ambStatus === 'suspended' ? ('suspended' as const) : ('active' as const),
      settings: theirs,
      referralCode: (ambSnap.get('referralCode') as string) ?? null,
      fullName: (ambSnap.get('fullName') as string) ?? null,
      payoutAccount: (ambSnap.get('payoutAccount') as Record<string, unknown> | null) ?? null,
      progress: progress(
        {
          usersOnboarded: ambSnap.get('usersOnboarded') as number | undefined,
          partnersSold: ambSnap.get('partnersSold') as number | undefined,
        },
        theirs,
      ),
    };
  }

  return {
    ok: true,
    stage: (appStatus ?? 'none') as 'pending' | 'rejected' | 'resubmit' | 'none',
    settings,
    rejectionReason: (appSnap.get('rejectionReason') as string | null) ?? null,
  };
});

/** Admin: every ambassador, with how far each one is from their targets. */
export const adminListAmbassadors = onCall(async (req) => {
  requireAdmin(req);
  const settings = await getAmbassadorSettings();
  const snap = await db.collection('ambassadors').limit(500).get();
  return {
    ok: true,
    settings,
    ambassadors: snap.docs.map((d) => {
      const theirs = {
        ...settings,
        userTarget: (d.get('userTarget') as number | undefined) ?? settings.userTarget,
        partnerTarget: (d.get('partnerTarget') as number | undefined) ?? settings.partnerTarget,
        salaryPkr: (d.get('salaryPkr') as number | undefined) ?? settings.salaryPkr,
      };
      return {
        uid: d.id,
        fullName: (d.get('fullName') as string) ?? '',
        mobile: (d.get('mobile') as string | null) ?? null,
        referralCode: (d.get('referralCode') as string) ?? '',
        status: (d.get('status') as AmbassadorStatus) ?? 'approved',
        payoutAccount: (d.get('payoutAccount') as Record<string, unknown> | null) ?? null,
        progress: progress(
          {
            usersOnboarded: d.get('usersOnboarded') as number | undefined,
            partnersSold: d.get('partnersSold') as number | undefined,
          },
          theirs,
        ),
      };
    }),
  };
});

/** Nobody is asked to recruit more than this, so nobody needs a longer list. */
const FLEET_LIMIT = 500;

/** The ambassador's own record, or a refusal. Used by both fleet calls. */
async function requireApprovedAmbassador(uid: string) {
  const snap = await db.doc(`ambassadors/${uid}`).get();
  if (!snap.exists || snap.get('status') !== 'approved') {
    invalid('Only an approved Velocity Ambassador has a fleet.');
  }
  return snap;
}

/**
 * Everyone this ambassador brought in, and what each of them has actually done.
 *
 * Three numbers matter to an ambassador, and until now the board showed two of
 * them. "Installed the app" and "bought Earn with Velocity" are counters kept
 * by the events themselves, because they decide whether a salary is owed. The
 * third — how many of those people actually ride — decides nothing and is
 * therefore counted here, by reading the recruits, rather than by adding a
 * write to the ride flow that every booking in the country would pay for.
 *
 * What comes back is a name and what they have done. Not a phone number: an
 * ambassador needs to tell their recruits apart and send one a nudge, and
 * neither of those needs somebody else's number.
 */
export const getMyAmbassadorFleet = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await requireApprovedAmbassador(uid);

  const edges = await db
    .collection('ambassador_referrals')
    .where('ambassadorId', '==', uid)
    .limit(FLEET_LIMIT)
    .get();

  if (edges.empty) return { ok: true, activeRiders: 0, fleet: [] as unknown[] };

  // One batched read rather than one call per recruit.
  const people = await db.getAll(...edges.docs.map((e) => db.doc(`users/${e.id}`)));
  const byUid = new Map(people.map((p) => [p.id, p]));

  const fleet = edges.docs.map((e) => {
    const person = byUid.get(e.id);
    const trips = Math.max(0, Math.floor((person?.get('totalTrips') as number | undefined) ?? 0));
    const boundAt = e.get('boundAt') as { toMillis?: () => number } | undefined;
    return {
      uid: e.id,
      // A recruit who has not set a name yet is still a recruit.
      name: ((person?.get('name') as string | undefined) ?? '').trim() || 'Velocity user',
      joinedAtMs: typeof boundAt?.toMillis === 'function' ? boundAt.toMillis() : null,
      boughtPartnerPlan: e.get('boughtPartnerPlan') === true,
      trips,
      /** "Active" means they have actually taken a ride, not merely signed up. */
      active: trips > 0,
    };
  });

  return { ok: true, activeRiders: fleet.filter((f) => f.active).length, fleet };
});

/**
 * "Book a ride" — an ambassador nudging the people they brought in.
 *
 * Either one of them or all of them, which is the whole feature: a nudge to
 * everybody is how a campus ambassador fills a morning, and a nudge to one
 * person is how they chase the friend who installed the app and stopped.
 *
 * Three things make this safe to expose to a few hundred students:
 *
 *  - **The words are ours.** No free text field. An ambassador with a message
 *    box and a hundred recipients is a spam channel with our name on the
 *    notification, and nobody asked for one.
 *  - **Only their own recruits.** A uid that is not on this ambassador's
 *    edge is refused, so the callable cannot be used to push to any account
 *    somebody can guess.
 *  - **Rationed.** Everyone, once a day; one person, a few times a day. The
 *    recruit who is nudged every hour uninstalls the app, and that costs the
 *    ambassador the very target this is meant to help them hit.
 */
export const notifyMyFleet = onCall({ timeoutSeconds: 120 }, async (req) => {
  const { uid } = requireAuth(req);
  const me = await requireApprovedAmbassador(uid);

  const parsed = z.object({ to: docId.optional() }).safeParse(req.data ?? {});
  if (!parsed.success) invalid('Invalid request.');
  const { to } = parsed.data;

  await rateLimit(uid, to ? 'ambassadorNudgeOne' : 'ambassadorNudgeAll', to ? 20 : 1, 86_400);

  let targets: string[];
  if (to) {
    const edge = await db.doc(`ambassador_referrals/${to}`).get();
    if (!edge.exists || edge.get('ambassadorId') !== uid) {
      invalid('That person is not in your fleet.');
    }
    targets = [to];
  } else {
    const edges = await db
      .collection('ambassador_referrals')
      .where('ambassadorId', '==', uid)
      .limit(FLEET_LIMIT)
      .get();
    targets = edges.docs.map((e) => e.id);
  }
  if (!targets.length) invalid('Nobody has used your code yet.');

  const who = ((me.get('fullName') as string | undefined) ?? '').trim() || 'Your Velocity Ambassador';
  const title = 'Book your ride with Velocity';
  const body = `${who} is inviting you to book a ride. Open Velocity Rides and go.`;

  // In chunks: a hundred sequential pushes is a two-minute function, and a
  // hundred at once is a thundering herd on FCM.
  let sent = 0;
  for (let i = 0; i < targets.length; i += 20) {
    const chunk = targets.slice(i, i + 20);
    const results = await Promise.allSettled(
      chunk.map((target) => notifyUser(target, title, body, 'system', { screen: 'home' })),
    );
    sent += results.filter((r) => r.status === 'fulfilled').length;
  }

  logger.info('Ambassador nudged their fleet', { uid, asked: targets.length, sent });
  return { ok: true, sent, asked: targets.length };
});
