/**
 * "There is a fare two streets away — open the app."
 *
 * A driver who is offline gets no push notification, because there is nothing
 * to push to: the app is closed and, on a budget Android phone in Pakistan, has
 * very likely been killed by the system. So the request sits in the feed nobody
 * is looking at, and the passenger watches a spinner while an approved driver
 * sits at home not knowing.
 *
 * WhatsApp is the one channel that reaches that person. Every adult in the
 * country has it, it survives a killed app, and it is where they already are.
 *
 * WHAT THIS FILE IS RESPONSIBLE FOR
 * --------------------------------
 * The rules live in `policy.ts` and the wire lives in `client.ts`. This is the
 * part that touches Firestore: reading the settings, finding the offline
 * drivers, spending the daily budget, recording what was sent, and — the part
 * that actually protects the business number — reacting to what Meta says back.
 *
 * THE CIRCUIT BREAKER
 * -------------------
 * `config/whatsappHealth` carries one boolean that can stop every send on the
 * platform. It is flipped automatically the moment Meta returns a code that
 * means the ACCOUNT is in trouble (spam rate limit, policy block, template
 * disabled) and, once flipped, nothing sends again until a human clears it.
 *
 * That asymmetry is deliberate. The cost of being stopped for a day is some
 * drivers not hearing about some rides. The cost of not stopping is the number
 * — and with it the channel — going away. Those are not comparable, so the
 * breaker is allowed to be trigger-happy and is never allowed to reset itself.
 */
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { sendTemplate, toWhatsAppNumber, whatsAppConfig } from './client';
import {
  afterSend,
  blockFanout,
  DEFAULT_ALERT_SETTINGS,
  planFanout,
  pktDayKey,
  readAlertSettings,
  type CandidateDriver,
  type DriverAlertState,
  type WhatsAppAlertSettings,
} from './policy';

const SETTINGS_DOC = 'config/whatsappAlerts';
const HEALTH_DOC = 'config/whatsappHealth';
/** Per-PKT-day usage counters — the budget, and the evidence for the admin desk. */
const USAGE_COLLECTION = 'whatsappUsage';

/** Public site origin. The template's URL button is built from this. */
const WEB_ORIGIN = process.env.VELOCITY_WEB_ORIGIN ?? 'https://velocityrides.app';

/** Human labels for the ride types, so the message reads like a person wrote it. */
const RIDE_LABELS: Record<string, string> = {
  bike: 'Moto',
  auto: 'Rickshaw',
  mini: 'Mini',
  ac: 'AC car',
  comfort: 'Premium',
  xl: 'XL',
};

export interface WhatsAppHealth {
  circuitOpen: boolean;
  reason?: string;
  code?: number | null;
  openedAt?: Timestamp;
}

async function readSettings(): Promise<WhatsAppAlertSettings> {
  try {
    const snap = await db.doc(SETTINGS_DOC).get();
    return readAlertSettings(snap.exists ? snap.data() : null);
  } catch (err) {
    // A settings read that fails must not become an accidental send at default
    // volume — but the defaults are `enabled: false`, so falling back to them
    // fails closed anyway.
    logger.warn('WhatsApp: settings read failed', { err });
    return DEFAULT_ALERT_SETTINGS;
  }
}

async function readHealth(): Promise<WhatsAppHealth> {
  try {
    const snap = await db.doc(HEALTH_DOC).get();
    return { circuitOpen: snap.get('circuitOpen') === true };
  } catch {
    // Unknown health is treated as open. Sending blind is the one thing worth
    // less than not sending at all.
    return { circuitOpen: true };
  }
}

/**
 * Stops every WhatsApp send on the platform, and says why.
 *
 * Never clears itself: re-arming is a decision a person makes after looking at
 * the WhatsApp Manager quality panel, not something a later successful send is
 * allowed to imply.
 */
export async function tripCircuitBreaker(reason: string, code: number | null): Promise<void> {
  logger.error('WhatsApp: CIRCUIT BREAKER TRIPPED — all alerts stopped', { reason, code });
  await db.doc(HEALTH_DOC).set(
    {
      circuitOpen: true,
      reason,
      code: code ?? null,
      openedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Reserves up to `want` sends out of today's platform-wide budget and returns
 * how many were actually granted.
 *
 * Transactional because the alternative — read the count, send, then increment
 * — lets a rush-hour burst of simultaneous requests each see the same low count
 * and collectively spend several times the cap. The budget is the blast radius;
 * it has to hold under exactly the conditions that make it matter.
 */
async function reserveGlobalBudget(want: number, cap: number, nowMs: number): Promise<number> {
  if (want <= 0) return 0;
  const ref = db.doc(`${USAGE_COLLECTION}/${pktDayKey(nowMs)}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = (snap.get('reserved') as number | undefined) ?? 0;
    const granted = Math.max(0, Math.min(want, cap - used));
    if (granted > 0) {
      tx.set(
        ref,
        {
          day: pktDayKey(nowMs),
          reserved: used + granted,
          // Kept so an admin can see the shape of a day at a glance: reserved is
          // intent, sent is what Meta accepted, and a gap between them is the
          // first sign something is wrong upstream.
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    return granted;
  });
}

/** Bumps one of the day's counters. Best-effort; never blocks a send. */
function countUsage(field: 'sent' | 'failed' | 'dropped' | 'optOuts', nowMs = Date.now()): void {
  db.doc(`${USAGE_COLLECTION}/${pktDayKey(nowMs)}`)
    .set({ day: pktDayKey(nowMs), [field]: FieldValue.increment(1) }, { merge: true })
    .catch(() => {});
}

export interface OfflineAlertInput {
  tripId: string;
  pickup: { lat: number; lng: number; address?: string };
  rideType: string;
  fare: number;
  /** Approved drivers already online within the search radius. */
  onlineNearby: number;
}

/**
 * The whole fan-out for one ride request. Best-effort and never throws — the
 * passenger's booking has already succeeded by the time this runs, and nothing
 * here is allowed to threaten it.
 */
export async function alertOfflineDriversOnWhatsApp(input: OfflineAlertInput): Promise<void> {
  const now = Date.now();
  const cfg = whatsAppConfig();
  const [settings, health] = await Promise.all([readSettings(), readHealth()]);

  const usageSnap = await db.doc(`${USAGE_COLLECTION}/${pktDayKey(now)}`).get().catch(() => null);
  const sentToday = (usageSnap?.get('reserved') as number | undefined) ?? 0;

  const blocked = blockFanout(
    settings,
    {
      onlineNearby: input.onlineNearby,
      fare: input.fare,
      sentToday,
      circuitOpen: health.circuitOpen,
      configured: cfg !== null,
    },
    now,
  );
  if (blocked || !cfg) {
    // `disabled` and `not-configured` are the steady state before launch, so
    // they are debug-level; everything else is a real event worth seeing.
    const log = blocked === 'disabled' || blocked === 'not-configured' ? logger.debug : logger.info;
    log('WhatsApp: no alerts for this trip', { tripId: input.tripId, reason: blocked });
    return;
  }

  const candidates = await findOfflineCandidates(input.pickup, settings);
  if (candidates.length === 0) {
    logger.info('WhatsApp: no eligible offline drivers', { tripId: input.tripId });
    return;
  }

  // Reserve first, plan second. The reservation is what makes the daily cap
  // real; planning against an unreserved budget would let two concurrent
  // requests each believe the whole remainder was theirs.
  const wanted = Math.min(candidates.length, settings.maxRecipientsPerTrip);
  const granted = await reserveGlobalBudget(wanted, settings.dailyGlobalCap, now);
  if (granted === 0) {
    logger.info('WhatsApp: daily budget spent', { tripId: input.tripId, cap: settings.dailyGlobalCap });
    return;
  }

  const plan = planFanout(candidates, settings, now, granted);
  if (plan.picked.length === 0) {
    logger.info('WhatsApp: nobody eligible after policy', {
      tripId: input.tripId,
      skipped: plan.skipped.slice(0, 10),
    });
    return;
  }

  const rideLabel = RIDE_LABELS[input.rideType] ?? input.rideType;
  const area = shortArea(input.pickup.address);
  let sent = 0;

  // Sequential on purpose. A dozen messages is not worth parallelising, and
  // serialising means a `halt` from Meta stops the very next send rather than
  // arriving after eleven others are already in flight.
  for (const driver of plan.picked) {
    const firstName = (driver.name ?? 'there').trim().split(/\s+/)[0] || 'there';
    const res = await sendTemplate(
      cfg,
      driver.phone as string,
      [firstName, rideLabel, String(Math.round(input.fare)), area],
      input.tripId,
    );

    if (res.ok) {
      sent += 1;
      countUsage('sent', now);
      await recordAlertSent(driver.uid, driver.alerts, now, input.tripId, res.messageId);
      continue;
    }

    countUsage('failed', now);
    if (res.action === 'halt') {
      await tripCircuitBreaker(res.detail, res.code);
      break;
    }
    if (res.action === 'back-off') {
      // Not this driver's fault and not a reason to stop the feature — just a
      // reason to stop pushing right now.
      logger.info('WhatsApp: backing off for this trip', { tripId: input.tripId, code: res.code });
      break;
    }
    if (res.action === 'drop-recipient') {
      await blockDriverNumber(driver.uid, `send error ${res.code}`);
      countUsage('dropped', now);
      continue;
    }
    if (res.action === 'skip-recipient') {
      // Meta declined for this person specifically. Burn their allowance for
      // the day rather than trying again in an hour and being declined again.
      await exhaustDriverForToday(driver.uid, driver.alerts, now, settings);
    }
  }

  logger.info('WhatsApp: offline alerts done', {
    tripId: input.tripId,
    sent,
    planned: plan.picked.length,
    onlineNearby: input.onlineNearby,
  });
}

/** A candidate plus the fields only the message itself needs. */
type NamedCandidate = CandidateDriver & { name?: string };

/**
 * Approved, offline, opted-in drivers within the radius.
 *
 * The `optIn` equality filter is doing real work: it keeps the read to the
 * handful of drivers who have actually asked for these messages instead of
 * every driver on the platform, which matters both for cost and for the
 * certainty that nobody outside that set can ever be picked.
 */
async function findOfflineCandidates(
  pickup: { lat: number; lng: number },
  settings: WhatsAppAlertSettings,
): Promise<NamedCandidate[]> {
  const snap = await db
    .collection('drivers')
    .where('whatsappAlerts.optIn', '==', true)
    .where('online', '==', false)
    .where('verificationStatus', '==', 'approved')
    .get();

  const out: NamedCandidate[] = [];
  for (const doc of snap.docs) {
    const loc = doc.get('lastLocation') as { lat?: number; lng?: number } | undefined;
    // An offline driver's last known position is stale by definition — it is
    // where they were when they went offline. That is still the best available
    // guess at where they live and work, which is what the radius is really
    // asking about. A driver with no position at all cannot be placed, and
    // guessing would mean messaging Karachi about a ride in Islamabad.
    if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') continue;
    const distanceKm = haversineKm(pickup.lat, pickup.lng, loc.lat, loc.lng);
    if (distanceKm > settings.radiusKm) continue;

    const alerts = (doc.get('whatsappAlerts') as DriverAlertState | undefined) ?? {};

    const lastSeen = doc.get('lastSeenAt') as Timestamp | undefined;
    out.push({
      uid: doc.id,
      name: doc.get('fullName') as string | undefined,
      // The number captured at opt-in is the one consent was given for. Falling
      // back to the profile phone covers a driver whose opt-in predates the
      // field; a later profile edit re-normalises on their next toggle.
      phone: toWhatsAppNumber(alerts.number ?? (doc.get('phone') as string | undefined)),
      distanceKm,
      lastSeenAt: lastSeen ? lastSeen.toMillis() : null,
      alerts: {
        ...alerts,
        // Stored as a Timestamp, compared as epoch ms.
        lastSentAt: toMillis(alerts.lastSentAt),
      },
    });
  }
  return out;
}

/** Firestore hands back a Timestamp; the policy layer speaks epoch ms. */
function toMillis(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number') return v;
  return null;
}

async function recordAlertSent(
  uid: string,
  state: DriverAlertState,
  nowMs: number,
  tripId: string,
  messageId: string | null,
): Promise<void> {
  const next = afterSend(state, nowMs);
  await db
    .doc(`drivers/${uid}`)
    .set(
      {
        whatsappAlerts: {
          ...next,
          lastSentAt: Timestamp.fromMillis(nowMs),
          lastTripId: tripId,
          lastMessageId: messageId,
        },
      },
      { merge: true },
    )
    .catch((err) => logger.warn('WhatsApp: could not record send', { uid, err }));
}

/** Spends the rest of a driver's daily allowance without sending anything. */
async function exhaustDriverForToday(
  uid: string,
  state: DriverAlertState,
  nowMs: number,
  settings: WhatsAppAlertSettings,
): Promise<void> {
  await db
    .doc(`drivers/${uid}`)
    .set(
      {
        whatsappAlerts: {
          ...state,
          lastSentAt: Timestamp.fromMillis(nowMs),
          sentDay: pktDayKey(nowMs),
          sentToday: settings.maxPerDriverPerDay,
        },
      },
      { merge: true },
    )
    .catch(() => {});
}

/**
 * Marks a number as permanently unmessageable.
 *
 * Set when Meta says the number cannot receive our messages, and when a driver
 * replies STOP. Both are final until the driver themselves turns alerts back on
 * from the app, which is the only path that re-establishes consent.
 */
export async function blockDriverNumber(uid: string, reason: string): Promise<void> {
  logger.info('WhatsApp: driver number blocked', { uid, reason });
  await db
    .doc(`drivers/${uid}`)
    .set(
      {
        whatsappAlerts: {
          blocked: true,
          blockedReason: reason,
          blockedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    )
    .catch(() => {});
}

/**
 * Finds the driver a WhatsApp number belongs to.
 *
 * Matches on `whatsappAlerts.number` — the normalised number recorded at the
 * moment the driver switched alerts on. That is the number consent was given
 * for, so it is the number an inbound STOP has to be resolved against; the free
 * text `phone` field on the profile can hold any of a dozen shapes and is not
 * queryable.
 */
async function findDriverByWhatsAppNumber(phone: string): Promise<string | null> {
  const normalised = toWhatsAppNumber(phone);
  if (!normalised) return null;
  const snap = await db
    .collection('drivers')
    .where('whatsappAlerts.number', '==', normalised)
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0]?.id ?? null);
}

/**
 * Records a driver's own STOP. Consent is withdrawn, not merely paused.
 *
 * `blocked` as well as `optIn: false`, because those two mean different things
 * to the rest of the system and both are true here: they no longer consent, AND
 * this number must not be attempted again. Only the driver's own toggle in the
 * app clears it — an opt-out that some later code path could quietly undo is
 * not an opt-out.
 */
export async function optOutDriverByPhone(phone: string, reason: string): Promise<boolean> {
  const uid = await findDriverByWhatsAppNumber(phone);
  if (!uid) return false;

  await db.doc(`drivers/${uid}`).set(
    {
      whatsappAlerts: {
        optIn: false,
        blocked: true,
        blockedReason: reason,
        blockedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
  countUsage('optOuts');
  logger.info('WhatsApp: driver opted out', { uid, reason });
  return true;
}

/**
 * A driver messaging us "START" from their own handset. That is consent, given
 * on the channel itself and in their own words — the strongest form of it we
 * ever get — so it clears a previous block.
 */
export async function optInDriverByPhone(phone: string): Promise<boolean> {
  const uid = await findDriverByWhatsAppNumber(phone);
  if (!uid) return false;
  await db.doc(`drivers/${uid}`).set(
    {
      whatsappAlerts: {
        optIn: true,
        blocked: false,
        blockedReason: FieldValue.delete(),
        optInAt: FieldValue.serverTimestamp(),
        optInSource: 'whatsapp-reply',
      },
    },
    { merge: true },
  );
  logger.info('WhatsApp: driver opted back in', { uid });
  return true;
}

/**
 * The pickup address, cut down to something that fits in a template variable.
 *
 * WhatsApp rejects a template parameter containing a newline or a run of
 * spaces (error 132007), which a geocoded address very often has — so this is
 * a correctness requirement, not cosmetics.
 */
export function shortArea(address: string | undefined): string {
  const cleaned = (address ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'your area';
  // Geocoded addresses read "F-10 Markaz, Islamabad, Islamabad Capital…" — the
  // first component is the part a driver navigates by.
  const first = cleaned.split(',')[0]?.trim() || cleaned;
  return first.length > 40 ? `${first.slice(0, 39)}…` : first;
}

/** Kilometres between two points. Same formula as the trip broadcast uses. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** The URL a template's button points at, for the setup docs and admin desk. */
export function driverDeepLink(tripId: string): string {
  return `${WEB_ORIGIN}/link/driver/request-detail/${tripId}`;
}
