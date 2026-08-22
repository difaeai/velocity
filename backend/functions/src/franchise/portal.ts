/**
 * The Pro partner's web portal — the link, and the gate behind it.
 * ----------------------------------------------------------------------------
 * An approved **Pro** partner gets a private web address of their own, minted at
 * approval: `/f/{portalId}`. Free partners do not — the portal is the thing Pro
 * buys beyond the higher rate.
 *
 * THE LINK IS NOT A CREDENTIAL. It is unguessable so it does not show up in
 * scans or referrer logs, but every callable below re-checks that the *signed-in
 * caller* owns that portal. A link that authenticated by itself would mean one
 * WhatsApp forward, one shared screen or one browser left open in a cybercafé
 * hands a stranger the ability to file driver records under somebody else's
 * name. The partner signs in with the same phone number they use in the app:
 * Firebase keys phone users by number inside a project, so web OTP lands on the
 * very same uid the mobile app uses, and `partners/{uid}` matches without any
 * account linking.
 *
 * Ownership is re-derived on every call rather than trusted from the URL, so a
 * suspended partner, an expired Pro plan or a rotated link all take effect on
 * the next request instead of whenever the tab is next reloaded.
 * ----------------------------------------------------------------------------
 */
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';

/**
 * Where the portal lives. Overridable so a staging deploy hands out staging
 * links; the default is the production App Hosting origin.
 */
export const PORTAL_ORIGIN =
  process.env.VELOCITY_WEB_ORIGIN ?? 'https://velocity--velocity-fe379.us-east4.hosted.app';

export function portalUrl(portalId: string): string {
  return `${PORTAL_ORIGIN}/f/${portalId}`;
}

/**
 * Unambiguous alphabet: no O/0, no I/l/1. Portal ids get read off a screen and
 * typed by hand often enough that a transcription error must not be possible.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const PORTAL_ID_LEN = 22;

/** ~130 bits. Not a secret, but not enumerable either. */
export async function mintPortalId(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let id = '';
    for (let i = 0; i < PORTAL_ID_LEN; i++) {
      id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    const clash = await db.collection('partners').where('portalId', '==', id).limit(1).get();
    if (clash.empty) return id;
  }
  throw new Error('Could not mint a unique portal id.');
}

export interface PortalOwner {
  uid: string;
  partner: FirebaseFirestore.DocumentSnapshot;
}

/**
 * The single gate in front of every portal action.
 *
 * Order matters: authenticate, then load the partner by *uid*, then compare the
 * portal id. Looking the partner up by portalId instead would let anyone holding
 * the link learn whether it is valid, and would make the caller's identity
 * decorative.
 */
export async function requirePortalOwner(
  req: CallableRequest,
  portalId: string,
): Promise<PortalOwner> {
  const ctx = requireAuth(req);
  const snap = await db.doc(`partners/${ctx.uid}`).get();

  if (!snap.exists) invalid('This account is not a Velocity partner.');
  if (snap.get('tier') !== 'pro') {
    invalid('The fleet portal is part of the Pro plan. Upgrade in the app to use it.');
  }
  if (snap.get('status') !== 'active') {
    invalid('This partner account is suspended. Contact Velocity support.');
  }
  if (!snap.get('portalId') || snap.get('portalId') !== portalId) {
    // Deliberately the same message whether the link is wrong or belongs to
    // somebody else — otherwise this becomes an oracle for valid links.
    invalid('This portal link is not valid for your account.');
  }

  const expires = snap.get('proExpiresAt') as FirebaseFirestore.Timestamp | null | undefined;
  if (expires && expires.toDate().getTime() < Date.now()) {
    invalid('Your Pro plan has expired. Renew in the app to reopen the portal.');
  }

  return { uid: ctx.uid, partner: snap };
}

const portalSchema = z.object({ portalId: z.string().trim().min(8).max(64) });

/**
 * Everything the dashboard renders in one round trip: who the partner is, the
 * promo code they hand out, their fleet counters, and how their submissions are
 * sitting with the admin queue.
 */
export const getFranchisePortal = onCall(async (req) => {
  const parsed = portalSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid portal link.');
  const { uid, partner } = await requirePortalOwner(req, parsed.data.portalId);

  const [pending, approved, rejected, wallet] = await Promise.all([
    db.collection('driver_submissions').where('partnerId', '==', uid).where('status', '==', 'pending').count().get(),
    db.collection('driver_submissions').where('partnerId', '==', uid).where('status', '==', 'approved').count().get(),
    db.collection('driver_submissions').where('partnerId', '==', uid).where('status', '==', 'rejected').count().get(),
    db.doc(`partner_wallets/${uid}`).get(),
  ]);

  return {
    ok: true,
    partner: {
      uid,
      fullName: partner.get('fullName') ?? null,
      city: partner.get('city') ?? null,
      mobile: partner.get('mobile') ?? null,
      tier: partner.get('tier'),
      level: partner.get('level') ?? 'bronze',
      referralCode: partner.get('referralCode') ?? null,
      portalId: partner.get('portalId'),
      proExpiresAt: partner.get('proExpiresAt') ?? null,
      totalDrivers: partner.get('totalDrivers') ?? 0,
      totalPassengers: partner.get('totalPassengers') ?? 0,
      completedRides: partner.get('completedRides') ?? 0,
      lifetimeEarnings: partner.get('lifetimeEarnings') ?? 0,
    },
    wallet: wallet.exists
      ? {
          balance: wallet.get('balance') ?? 0,
          pending: wallet.get('pending') ?? 0,
          withdrawn: wallet.get('withdrawn') ?? 0,
          currency: wallet.get('currency') ?? 'PKR',
        }
      : null,
    submissions: {
      pending: pending.data().count,
      approved: approved.data().count,
      rejected: rejected.data().count,
    },
  };
});

const rotateSchema = z.object({
  uid: z.string().min(1).max(128),
  reason: z.string().trim().max(300).optional(),
});

/**
 * Admin-only: issue the partner a fresh link and kill the old one.
 *
 * The reason this exists at all: a portal id that leaks cannot be un-leaked, and
 * without rotation the only remedy would be suspending the partner — punishing
 * them for someone else forwarding a URL.
 */
export const adminRotatePartnerPortal = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = rotateSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the partner uid.');
  const { uid, reason } = parsed.data;

  const ref = db.doc(`partners/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('No partner found for this user.');
  if (snap.get('tier') !== 'pro') invalid('Only Pro partners have a portal.');

  const portalId = await mintPortalId();
  const now = FieldValue.serverTimestamp();

  await ref.set({ portalId, portalRotatedAt: now, updatedAt: now }, { merge: true });
  await db.collection('auditLogs').add({
    type: 'partner.portal.rotated',
    actor: admin.uid,
    targetUid: uid,
    reason: reason ?? null,
    createdAt: now,
  });

  logger.info('Partner portal rotated', { actor: admin.uid, uid });
  return { ok: true, portalId };
});
