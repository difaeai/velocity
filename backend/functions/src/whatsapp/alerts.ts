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
import { cityFor } from '../locations/registry';
import {
  isAccountHalt,
  sendTemplate,
  toWhatsAppNumber,
  whatsAppConfig,
  type SendResult,
  type WhatsAppConfig,
} from './client';
import {
  afterSend,
  blockFanout,
  DEFAULT_ALERT_SETTINGS,
  planFanout,
  pktDayKey,
  readAlertSettings,
  type CandidateDriver,
  type DriverAlertState,
  type FanoutBlock,
  type WhatsAppAlertSettings,
} from './policy';

const SETTINGS_DOC = 'config/whatsappAlerts';
const HEALTH_DOC = 'config/whatsappHealth';
/** Per-PKT-day usage counters — the budget, and the evidence for the admin desk. */
const USAGE_COLLECTION = 'whatsappUsage';
/**
 * Drivers an admin recruited face to face, keyed by their normalised number,
 * waiting for the account they do not have yet (see `desk.ts`).
 *
 * They are told about demand but never about a live ride: a ride alert is an
 * auction they cannot enter without an approved account, and a message somebody
 * cannot act on is the kind that earns a Block.
 */
export const PROSPECTS_COLLECTION = 'driverProspects';

/**
 * How far an admin's area broadcast reaches (owner, 2026-11-20: "chahe woh door
 * hi kyun na hon, par hon woh Islamabad Rawalpindi ke under 20 km").
 *
 * Its own number rather than `settings.radiusKm`, which stays at 5 km: a ride
 * alert and a broadcast are asking different questions. A driver 20 km away is
 * not worth waking for one 250-rupee fare, but "there is work in H-9 this
 * afternoon" is exactly the message somebody across the twin cities will act
 * on. Clamped by the settings' own ceiling of 25 km.
 */
const AREA_BROADCAST_RADIUS_KM = 20;

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

export async function readSettings(): Promise<WhatsAppAlertSettings> {
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

export async function readHealth(): Promise<WhatsAppHealth> {
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
  /** A shared car: how many riders are booked and where it goes, so the alert says so. */
  shared?: { riders: number; to?: string };
  /**
   * Riders leaving at a set time, told ahead of it with the demand template:
   * "{people} will travel from {from} at {time} today. Total fare: PKR {fare}".
   * Sent whoever is online — it is for planning, not for a ride waiting now.
   * `link` is the end of the "See ride" URL: velocityrides.app/link/driver/{link}.
   */
  demand?: { people: number; from: string; time: string; link: 'demand' | 'shared-pools' };
}

export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** "5:00 PM", Pakistan time — how the demand template says when riders leave. */
export function pktClock(ms: number): string {
  const d = new Date(ms + PKT_OFFSET_MS);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The demand template: `driver_ride_schedule`, Utility, English, approved by
 * Meta on 6 Nov 2026 — not a secret, so it lives here. The env names override
 * it only if Meta's copy is ever renamed; a name Meta does not know is a `halt`,
 * which would stop ride alerts too. Its "See ride" URL button is first unless
 * WHATSAPP_DEMAND_TEMPLATE_BUTTON_INDEX says otherwise.
 */
function demandConfig(cfg: WhatsAppConfig | null): WhatsAppConfig | null {
  if (!cfg) return null;
  const index = (process.env.WHATSAPP_DEMAND_TEMPLATE_BUTTON_INDEX ?? '').trim();
  return {
    ...cfg,
    templateName: (process.env.WHATSAPP_DEMAND_TEMPLATE_NAME ?? '').trim() || 'driver_ride_schedule',
    templateLang: (process.env.WHATSAPP_DEMAND_TEMPLATE_LANG ?? '').trim() || 'en',
    // Meta's editor can put the quick reply first; then this is 1.
    urlButtonIndex: /^\d$/.test(index) ? index : '0',
  };
}

/**
 * The area template, for the broadcast an admin types on WhatsApp: one
 * variable, the area, and a static button into the app.
 *
 * `urlButtonIndex: null` on purpose — a static button takes no parameter, and
 * sending one against it is `(#100) Invalid parameter`. Keeping this template
 * parameter-light is what makes it safe for a one-off human command: there is
 * one thing to get wrong, not five.
 */
function areaConfig(cfg: WhatsAppConfig | null): WhatsAppConfig | null {
  if (!cfg) return null;
  return {
    ...cfg,
    templateName: (process.env.WHATSAPP_AREA_TEMPLATE_NAME ?? '').trim() || 'driver_area_demand',
    templateLang: (process.env.WHATSAPP_AREA_TEMPLATE_LANG ?? '').trim() || cfg.templateLang,
    urlButtonIndex: null,
  };
}

/** "Mini", or for a shared car "shared Mini, 3 riders to PIMS" — the template's ride slot. */
export function rideLabelFor(rideType: string, shared?: OfflineAlertInput['shared']): string {
  const car = RIDE_LABELS[rideType] ?? rideType;
  if (!shared) return car;
  const to = shared.to ? ` to ${shortArea(shared.to)}` : '';
  return `shared ${car}, ${shared.riders} rider${shared.riders === 1 ? '' : 's'}${to}`;
}

/**
 * The whole fan-out for one ride request. Best-effort and never throws — the
 * passenger's booking has already succeeded by the time this runs, and nothing
 * here is allowed to threaten it.
 */
export async function alertOfflineDriversOnWhatsApp(input: OfflineAlertInput): Promise<void> {
  const now = Date.now();
  const cfg = input.demand ? demandConfig(whatsAppConfig()) : whatsAppConfig();
  const [settings, health] = await Promise.all([readSettings(), readHealth()]);

  const usageSnap = await db.doc(`${USAGE_COLLECTION}/${pktDayKey(now)}`).get().catch(() => null);
  const sentToday = (usageSnap?.get('reserved') as number | undefined) ?? 0;

  const blocked = blockFanout(
    settings,
    {
      onlineNearby: input.demand ? 0 : input.onlineNearby,
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

  // Demand told ahead of time is the one message a recruited driver can act on
  // — "there is work here, get on the app" — so the numbers an admin collected
  // in person join the fan-out for it. A live ride request does not: see
  // PROSPECTS_COLLECTION.
  const candidates = [
    ...(await findOfflineCandidates(input.pickup, settings)),
    ...(input.demand ? await findProspectCandidates(input.pickup) : []),
  ];
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

  const rideLabel = rideLabelFor(input.rideType, input.shared);
  const area = shortArea(input.pickup.address);

  const { sent } = await fanOut(plan.picked, settings, now, input.tripId, true, (driver) => {
    const firstName = (driver.name ?? 'there').trim().split(/\s+/)[0] || 'there';
    return input.demand
      ? sendTemplate(cfg, driver.phone as string, [
        firstName,
        `${input.demand.people} passenger${input.demand.people === 1 ? '' : 's'}`,
        input.demand.from,
        input.demand.time,
        String(Math.round(input.fare)),
      ], input.demand.link)
      : sendTemplate(
        cfg,
        driver.phone as string,
        [firstName, rideLabel, String(Math.round(input.fare)), area],
        input.tripId,
      );
  });

  logger.info('WhatsApp: offline alerts done', {
    tripId: input.tripId,
    sent,
    planned: plan.picked.length,
    onlineNearby: input.onlineNearby,
  });
}

/**
 * Sends one planned fan-out and acts on everything Meta says back.
 *
 * Shared by the ride/demand fan-out above and the admin's area broadcast
 * (`alertAreaDemand`) because the *reading* of a failure is the part that
 * protects the number, and it must be identical whoever started the send:
 * undeliverable means stop trying this number for ever, a per-user refusal
 * means burn their allowance rather than retry in an hour, and both are
 * accounted against the same caps and counters.
 *
 * Sequential on purpose. A dozen messages is not worth parallelising, and
 * serialising means a `halt` from Meta stops the very next send rather than
 * arriving after eleven others are already in flight.
 *
 * `haltStopsPlatform` is false for a send with its own one-off template, where
 * a template fault is the admin's setup rather than the account's standing —
 * see `isAccountHalt`.
 */
async function fanOut(
  picked: NamedCandidate[],
  settings: WhatsAppAlertSettings,
  nowMs: number,
  label: string,
  haltStopsPlatform: boolean,
  send: (c: NamedCandidate) => Promise<SendResult>,
): Promise<{ sent: number; failure: { code: number | null; detail: string } | null }> {
  let sent = 0;
  let failure: { code: number | null; detail: string } | null = null;

  for (const driver of picked) {
    const res = await send(driver);

    if (res.ok) {
      sent += 1;
      countUsage('sent', nowMs);
      await recordAlertSent(driver.statePath, driver.alerts, nowMs, label, res.messageId);
      continue;
    }

    countUsage('failed', nowMs);
    failure = { code: res.code, detail: res.detail };
    if (res.action === 'halt') {
      if (haltStopsPlatform || isAccountHalt(res.code)) await tripCircuitBreaker(res.detail, res.code);
      else logger.error('WhatsApp: this send is broken, alerts left running', { label, code: res.code });
      break;
    }
    if (res.action === 'back-off') {
      // Not this driver's fault and not a reason to stop the feature — just a
      // reason to stop pushing right now.
      logger.info('WhatsApp: backing off', { label, code: res.code });
      break;
    }
    if (res.action === 'drop-recipient') {
      await blockDriverNumber(driver.statePath, `send error ${res.code}`);
      countUsage('dropped', nowMs);
      continue;
    }
    if (res.action === 'skip-recipient') {
      // Meta declined for this person specifically. Burn their allowance for
      // the day rather than trying again in an hour and being declined again.
      await exhaustDriverForToday(driver.statePath, driver.alerts, nowMs, settings);
    }
  }

  return { sent, failure };
}

export interface AreaAlertOutcome {
  /** Why nobody was messaged, when that is the answer. */
  blocked: FanoutBlock | null;
  /** Opted-in drivers and recruits found near the area. */
  found: number;
  /** How many the caps allowed. */
  planned: number;
  sent: number;
  /** Recruits with no account yet, among `found`. */
  recruits: number;
  /** What Meta said about the last failed send, for the admin's reply. */
  failure: { code: number | null; detail: string } | null;
}

/**
 * "Tell the drivers near F-7 that there is work there" — the broadcast an admin
 * types on WhatsApp (`desk.ts`).
 *
 * Deliberately NOT a new channel: it goes through the same consent, the same
 * per-driver caps and quiet hours, the same daily budget and the same circuit
 * breaker as every automatic alert. The only thing an admin gets to decide is
 * *when* and *where* — never who, and never how often one driver may be woken.
 *
 * What it does lift is the per-trip recipient cap, because "everybody in F-7"
 * is the whole point of typing it; the day's global budget then becomes the
 * ceiling, which is the one that protects the number.
 */
export async function alertAreaDemand(area: {
  name: string;
  lat: number;
  lng: number;
}): Promise<AreaAlertOutcome> {
  const now = Date.now();
  const cfg = areaConfig(whatsAppConfig());
  const [settings, health] = await Promise.all([readSettings(), readHealth()]);

  const usageSnap = await db.doc(`${USAGE_COLLECTION}/${pktDayKey(now)}`).get().catch(() => null);
  const empty = { found: 0, planned: 0, sent: 0, recruits: 0, failure: null };

  const blocked = blockFanout(
    settings,
    {
      // Neither gate applies to a broadcast somebody typed: they exist to
      // decide whether an AUTOMATIC alert is worth sending at all, and an admin
      // asking for this one has already made that call.
      onlineNearby: 0,
      fare: Number.MAX_SAFE_INTEGER,
      sentToday: (usageSnap?.get('reserved') as number | undefined) ?? 0,
      circuitOpen: health.circuitOpen,
      configured: cfg !== null,
    },
    now,
  );
  if (blocked || !cfg) return { blocked: blocked ?? 'not-configured', ...empty };

  // The broadcast reaches further than a ride alert does, and nothing else
  // about the rules changes.
  const wide = { ...settings, radiusKm: Math.max(settings.radiusKm, AREA_BROADCAST_RADIUS_KM) };
  const drivers = await findOfflineCandidates(area, wide);
  const recruits = await findProspectCandidates(area);
  const candidates = [...drivers, ...recruits];
  if (candidates.length === 0) return { blocked: null, ...empty };

  // Plan BEFORE reserving, unlike the ride fan-out, and reserve exactly what
  // the plan will send. With the per-recipient cap lifted, reserving for
  // everyone nearby would spend the day's budget on the drivers the per-driver
  // caps then skip — one command in a busy sector would silence the rest of
  // the day. The reservation is still transactional and the plan is trimmed to
  // what it granted, so a concurrent fan-out cannot be overspent either.
  const remaining = Math.max(
    0,
    settings.dailyGlobalCap - ((usageSnap?.get('reserved') as number | undefined) ?? 0),
  );
  const plan = planFanout(candidates, { ...wide, maxRecipientsPerTrip: remaining }, now, remaining);
  const granted = await reserveGlobalBudget(plan.picked.length, settings.dailyGlobalCap, now);
  if (granted === 0) return { blocked: 'global-cap', ...empty, found: candidates.length };

  const { sent, failure } = await fanOut(
    plan.picked.slice(0, granted),
    settings,
    now,
    `area:${area.name}`,
    false,
    (driver) => sendTemplate(cfg, driver.phone as string, [area.name]),
  );

  logger.info('WhatsApp: area demand broadcast', {
    area: area.name,
    sent,
    planned: Math.min(plan.picked.length, granted),
    skipped: plan.skipped.slice(0, 10),
  });
  return {
    blocked: null,
    found: candidates.length,
    planned: Math.min(plan.picked.length, granted),
    sent,
    recruits: recruits.length,
    failure,
  };
}

/**
 * A candidate plus the fields only the message and the bookkeeping need.
 *
 * `statePath` is the document that carries this recipient's consent and
 * counters — a driver's own record, or the recruit doc of somebody who has no
 * account yet. Everything that records a send, blocks a number or burns an
 * allowance writes there, which is what lets one fan-out serve both.
 */
type NamedCandidate = CandidateDriver & { name?: string; statePath: string };

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
    // The driver app's foreground heartbeat. Its absence is meaningful and is
    // handled by `appLooksClosed` — it means an install that has never sent
    // one, not an app we are entitled to assume is open.
    const appActive = doc.get('appActiveAt') as Timestamp | undefined;
    out.push({
      uid: doc.id,
      statePath: doc.ref.path,
      name: doc.get('fullName') as string | undefined,
      // The number captured at opt-in is the one consent was given for. Falling
      // back to the profile phone covers a driver whose opt-in predates the
      // field; a later profile edit re-normalises on their next toggle.
      phone: toWhatsAppNumber(alerts.number ?? (doc.get('phone') as string | undefined)),
      distanceKm,
      lastSeenAt: lastSeen ? lastSeen.toMillis() : null,
      appActiveAt: appActive ? appActive.toMillis() : null,
      alerts: {
        ...alerts,
        // Stored as a Timestamp, compared as epoch ms.
        lastSentAt: toMillis(alerts.lastSentAt),
      },
    });
  }
  return out;
}

/**
 * Recruited drivers with no account yet, for demand inside one of our cities.
 *
 * They have no position of their own: a recruit has never driven for us, so
 * there is no last location to measure a radius against. The honest reading of
 * "near" for them is therefore the city, which is also the scope the owner
 * recruits in — Islamabad and Rawalpindi are one labour market, and a driver
 * living in Bahria will happily take a G-10 fare.
 *
 * shortcut: every alert in our cities counts as near a recruit. When recruiting
 * spreads to a second city, store the area at add time and measure from it.
 */
async function findProspectCandidates(pickup: { lat: number; lng: number }): Promise<NamedCandidate[]> {
  // Demand out in the country reaches nobody we recruited by hand.
  if (!cityFor(pickup)) return [];

  const snap = await db
    .collection(PROSPECTS_COLLECTION)
    .where('whatsappAlerts.optIn', '==', true)
    .limit(500)
    .get();

  return snap.docs.map((doc) => {
    const alerts = (doc.get('whatsappAlerts') as DriverAlertState | undefined) ?? {};
    return {
      uid: doc.id,
      statePath: doc.ref.path,
      name: doc.get('name') as string | undefined,
      phone: toWhatsAppNumber(alerts.number ?? doc.id),
      distanceKm: 0,
      // Nothing to be stale about and no app to be open: a recruit is reachable
      // on WhatsApp and nowhere else, which is the entire reason they are here.
      lastSeenAt: null,
      appActiveAt: null,
      alerts: { ...alerts, lastSentAt: toMillis(alerts.lastSentAt) },
    };
  });
}

/** Firestore hands back a Timestamp; the policy layer speaks epoch ms. */
function toMillis(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number') return v;
  return null;
}

async function recordAlertSent(
  statePath: string,
  state: DriverAlertState,
  nowMs: number,
  tripId: string,
  messageId: string | null,
): Promise<void> {
  const next = afterSend(state, nowMs);
  await db
    .doc(statePath)
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
    .catch((err) => logger.warn('WhatsApp: could not record send', { statePath, err }));
}

/** Spends the rest of a driver's daily allowance without sending anything. */
async function exhaustDriverForToday(
  statePath: string,
  state: DriverAlertState,
  nowMs: number,
  settings: WhatsAppAlertSettings,
): Promise<void> {
  await db
    .doc(statePath)
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
export async function blockDriverNumber(statePath: string, reason: string): Promise<void> {
  logger.info('WhatsApp: driver number blocked', { statePath, reason });
  await db
    .doc(statePath)
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
export async function statePathForNumber(phone: string): Promise<string | null> {
  const normalised = toWhatsAppNumber(phone);
  if (!normalised) return null;
  const snap = await db
    .collection('drivers')
    .where('whatsappAlerts.number', '==', normalised)
    .limit(1)
    .get();
  if (!snap.empty) return snap.docs[0] ? snap.docs[0].ref.path : null;
  // Not a driver yet. A recruit's record is keyed by the number itself, so
  // their STOP is honoured on a number that has no account behind it — which is
  // the only kind of consent a recruit has given us.
  const prospect = await db.doc(`${PROSPECTS_COLLECTION}/${normalised}`).get();
  return prospect.exists ? prospect.ref.path : null;
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
  const statePath = await statePathForNumber(phone);
  if (!statePath) return false;

  await db.doc(statePath).set(
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
  logger.info('WhatsApp: driver opted out', { statePath, reason });
  return true;
}

/**
 * A driver messaging us "START" from their own handset. That is consent, given
 * on the channel itself and in their own words — the strongest form of it we
 * ever get — so it clears a previous block.
 */
export async function optInDriverByPhone(phone: string): Promise<boolean> {
  const statePath = await statePathForNumber(phone);
  if (!statePath) return false;
  await db.doc(statePath).set(
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
  logger.info('WhatsApp: driver opted back in', { statePath });
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
