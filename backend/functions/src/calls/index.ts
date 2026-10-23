/**
 * Free in-app voice calls between a rider and their driver.
 *
 * The audio never touches our servers: the two phones talk WebRTC to each other
 * (Opus over UDP), so a call costs neither side any airtime and costs Velocity
 * nothing per minute. This file does the three things a phone cannot do alone:
 *
 *   who may call whom   only the driver and the riders of one LIVE ride, so the
 *                       call button can never become a way to reach a stranger,
 *                       or a driver after the ride is over;
 *   ringing             a push to the other phone, because a Firestore listener
 *                       cannot wake an app that is closed. On Android it is a
 *                       data push the app turns into a full-screen, looping
 *                       ring (lib/fcm.ts → sendCallToUser);
 *   the way through     free STUN always, plus Cloudflare TURN relay credentials
 *                       when the key is configured. Two phones behind carrier NAT
 *                       often cannot reach each other directly, and TURN is what
 *                       carries those calls (free up to 1,000 GB a month — tens
 *                       of thousands of hours of voice).
 *
 * Everything after that — offer, answer, hang-up — is the two phones writing the
 * call document, under rules that let each side touch only its own half.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendCallToUser } from '../lib/fcm';

/** A driver on the way, waiting at the pickup, or driving. */
const LIVE_TRIP = new Set(['matched', 'arriving', 'arrived', 'in_progress']);
/** A driver-hosted shared ride, from its first seat to its last drop-off. */
const LIVE_POOL_RIDE = new Set(['open', 'collecting', 'full', 'boarding', 'in_progress']);

/** How long relay credentials live. Longer than any ride call, short enough to be useless later. */
const TURN_TTL_SEC = 2 * 60 * 60;

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

const STUN_ONLY: IceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

/** Who is on one ride, as far as calling is concerned. */
export interface RideParties {
  driverId: string | null;
  /** The booker, pool members, or a shared ride's seated riders. */
  riders: string[];
  live: boolean;
}

/**
 * Who `callerId` reaches on this ride, or null when they may not call.
 *
 * A rider only ever reaches the driver. The driver names the rider — and on a
 * one-rider ride may leave it out. Riders never reach each other: co-riders are
 * strangers sharing a car, and the gender rules that seated them say nothing
 * about handing them a line to each other's phones.
 */
export function calleeFor(parties: RideParties, callerId: string, wanted?: string): string | null {
  if (!parties.live || !parties.driverId) return null;
  if (callerId === parties.driverId) {
    const target = wanted ?? (parties.riders.length === 1 ? parties.riders[0] : undefined);
    return target && target !== callerId && parties.riders.includes(target) ? target : null;
  }
  return parties.riders.includes(callerId) ? parties.driverId : null;
}

async function partiesOf(kind: 'trip' | 'poolRide', rideId: string): Promise<RideParties | null> {
  if (kind === 'trip') {
    const snap = await db.doc(`trips/${rideId}`).get();
    if (!snap.exists) return null;
    const members = (snap.get('poolMembers') as string[] | undefined) ?? [];
    return {
      driverId: (snap.get('driverId') as string | null | undefined) ?? null,
      riders: [...new Set([snap.get('passengerId') as string, ...members].filter(Boolean))],
      live: LIVE_TRIP.has(snap.get('status') as string),
    };
  }
  const ref = db.doc(`poolRides/${rideId}`);
  const [ride, seats] = await Promise.all([ref.get(), ref.collection('passengers').get()]);
  if (!ride.exists) return null;
  return {
    driverId: (ride.get('driverId') as string | null | undefined) ?? null,
    riders: seats.docs.filter((d) => d.get('status') !== 'dropped_off').map((d) => d.id),
    live: LIVE_POOL_RIDE.has(ride.get('status') as string),
  };
}

/**
 * STUN, plus TURN relay credentials for this one call when Cloudflare is set up.
 *
 * The port-53 URL is dropped: the phones wait for ICE gathering to finish before
 * sending their half, and Cloudflare's own docs say that URL tends to time out.
 * Any failure falls back to STUN — most calls connect without a relay anyway.
 */
export async function iceServers(): Promise<IceServer[]> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return STUN_ONLY;
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SEC }),
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { iceServers?: { urls: string | string[]; username?: string; credential?: string }[] };
    const servers = (json.iceServers ?? [])
      .map((s) => ({
        ...s,
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
      }))
      .filter((s) => s.urls.length > 0);
    return servers.length > 0 ? servers : STUN_ONLY;
  } catch (e) {
    logger.warn('calls: no TURN credentials, STUN only', { error: (e as Error).message });
    return STUN_ONLY;
  }
}

function firstName(name: unknown, fallback: string): string {
  return typeof name === 'string' && name.trim() ? name.trim().split(/\s+/)[0] : fallback;
}

const startSchema = z.object({
  rideKind: z.enum(['trip', 'poolRide']),
  rideId: docId,
  calleeId: docId.optional(),
});

/** Ring the other side of a live ride. Returns the call the two phones then share. */
export const startCall = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = startSchema.safeParse(req.data);
  if (!parsed.success) invalid('Which ride is this call about?');
  const { rideKind, rideId, calleeId } = parsed.data;

  await rateLimit(ctx.uid, 'startCall', 20, 600);

  const parties = await partiesOf(rideKind, rideId);
  const callee = parties ? calleeFor(parties, ctx.uid, calleeId) : null;
  if (!parties || !callee) {
    throw new HttpsError('permission-denied', 'You can only call the people on your current ride.');
  }

  const [me, them, servers] = await Promise.all([
    db.doc(`users/${ctx.uid}`).get(),
    db.doc(`users/${callee}`).get(),
    iceServers(),
  ]);
  const callerIsDriver = ctx.uid === parties.driverId;
  const callerName = firstName(me.get('displayName'), callerIsDriver ? 'Your driver' : 'Your passenger');

  const ref = db.collection('calls').doc();
  await ref.set({
    id: ref.id,
    callerId: ctx.uid,
    calleeId: callee,
    driverId: parties.driverId,
    callerName,
    calleeName: firstName(them.get('displayName'), callerIsDriver ? 'Passenger' : 'Driver'),
    rideKind,
    rideId,
    status: 'ringing',
    iceServers: servers,
    offer: null,
    answer: null,
    createdAt: FieldValue.serverTimestamp(),
  });

  await sendCallToUser(
    callee,
    `📞 ${callerName} is calling`,
    `${callerIsDriver ? 'Your driver' : 'Your passenger'} · free call on Velocity Rides`,
    { screen: 'call', callId: ref.id },
  );

  logger.info('Call started', { callId: ref.id, rideKind, relay: servers !== STUN_ONLY });
  return { callId: ref.id };
});
