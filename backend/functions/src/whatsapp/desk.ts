/**
 * The admin desk ON WhatsApp: the business number answering its owner.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Cloud API number (+92 316 5004012) can never have the WhatsApp app on it
 * — a number registered for the Cloud API cannot also be registered in the
 * consumer or Business app, which is Meta's rule and not something we can ask
 * them to waive. So the number has no inbox a person can open, and until now
 * everything it did was automatic.
 *
 * But the work that actually builds supply is not automatic. Somebody meets a
 * driver at a petrol pump, takes his number, and wants two things to happen
 * before the conversation ends: the driver gets a proper message about Velocity
 * on his own WhatsApp, and his number starts hearing where the demand is. That
 * person is standing in the street with a phone, not at a desk with a browser.
 *
 * So the number itself becomes the interface. An admin messages it in their own
 * words — Roman Urdu, English, or both in one line — and it does the thing and
 * says what it did:
 *
 *   "03441563032 ko drivers mein add karo"   → recruit + invite that number
 *   "F-7 mein sab drivers ko demand bhejo"   → alert the drivers around F-7
 *   "status"                                  → what the channel is doing
 *   "alerts on" / "alerts off"                → the master switch
 *
 * WHAT IT IS NOT ALLOWED TO DO
 * ----------------------------
 * Everything this file does goes through the same consent, caps, quiet hours,
 * daily budget and circuit breaker as an automatic alert (`alerts.ts`). Being
 * an admin buys *when* and *where*, never who or how often — and it can never
 * un-say somebody's STOP. A number that opted out is refused here, loudly,
 * because an admin re-adding it by hand is exactly how a business number gets
 * reported.
 *
 * It also cannot re-arm the circuit breaker. That stays a decision somebody
 * makes after looking at the quality panel in WhatsApp Manager, which is not
 * something you can do from a street corner.
 *
 * WHO COUNTS AS AN ADMIN
 * ----------------------
 * `WHATSAPP_DESK_ADMINS`, a comma-separated list of numbers, in the backend's
 * environment. Deliberately not a Firestore document: this list is an
 * authentication boundary — whoever is on it can message every opted-in driver
 * — and a value only a deploy can change is worth the inconvenience. Empty
 * means the desk is off, which is how it ships.
 */
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { lookupOwnPlace, cityFor } from '../locations/registry';
import { fetchGeocode } from '../lib/places';
import {
  alertAreaDemand,
  PROSPECTS_COLLECTION,
  readHealth,
  readSettings,
  statePathForNumber,
} from './alerts';
import {
  postMessage,
  sendTemplate,
  toWhatsAppNumber,
  whatsAppConfig,
  type WhatsAppConfig,
} from './client';
import { APP_LINKS } from './leads';
import { pktDayKey } from './policy';

const SETTINGS_DOC = 'config/whatsappAlerts';

/** Don't answer the same recruit's chatter with the same wall of text all day. */
const RECRUIT_REPLY_GAP_MS = 6 * 60 * 60 * 1000;

export type DeskCommand =
  | { kind: 'add'; phone: string }
  | { kind: 'remove'; phone: string }
  | { kind: 'area'; area: string }
  | { kind: 'alerts'; on: boolean }
  | { kind: 'status' }
  | { kind: 'help' };

/* ─────────────────────────── reading the request ─────────────────────────── */

/**
 * Filler an instruction is wrapped in, in the three languages this gets typed
 * in. Removing them leaves the thing being talked about — a place name, if
 * there is one.
 *
 * Note what is NOT here: `area` and `sector`. "Blue Area" is a place, and a
 * list that eats the word would turn it into "Blue". A leading one is stripped
 * separately, which is the only position it is ever filler in.
 */
const FILLER = new Set([
  'a', 'ab', 'abhi', 'all', 'alert', 'alerts', 'and', 'aur', 'bata', 'batao', 'bhai',
  'bhej', 'bhejdo', 'bhejna', 'bhejo', 'bhaijo', 'bol', 'bolo', 'broadcast', 'de',
  'dedo', 'demand', 'do', 'drive', 'driver', 'drivers', 'eski', 'esko', 'for', 'h',
  'hai', 'hain', 'he', 'hey', 'hi', 'in', 'is', 'iska', 'iski', 'isko', 'jao', 'k',
  'ka', 'kar', 'kardo', 'karo', 'ke', 'ki', 'ko', 'kr', 'krdo', 'kro', 'log', 'logo',
  'logon', 'mai', 'main', 'me', 'mein', 'men', 'message', 'msg', 'notify', 'par',
  'passengers', 'pe', 'per', 'ping', 'please', 'plz', 'riders', 'sab', 'sabhi',
  'sare', 'sary', 'saray', 'se', 'send', 'that', 'the', 'there', 'tamam', 'to',
  'udhar', 'us', 'velocity', 'wahan', 'wahaan', 'ye', 'yeh',
]);

/** Words that turn a number into "take this one off the list". */
const REMOVE = new Set([
  'remove', 'delete', 'hatao', 'hatado', 'nikalo', 'nikaldo', 'block', 'stop', 'band',
  'bandh', 'rok', 'roko', 'off',
]);

/** Words that mean "tell me how it is going". */
const STATUS = new Set(['status', 'report', 'summary', 'kitne', 'kitnay', 'kitney']);

/** A message is only read as a broadcast when it asks for one. */
const BROADCAST = /\b(demand|alert|alerts|message|msg|bhejo|bhaijo|bhej|bhejdo|batao|bata|bolo|ping|notify|broadcast|send)\b/;

/** "f7", "f 7", "F-7/2" — the shape of a Pakistani sector, and nothing else. */
const SECTOR = /^([a-z])\s*-?\s*(\d{1,2})(?:\s*\/\s*(\d))?$/i;

/** `F-7`, `G-10/4`, `Blue Area` — how the area is written in the message we send. */
export function normaliseArea(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ');
  const sector = SECTOR.exec(text);
  if (sector) return `${sector[1]!.toUpperCase()}-${sector[2]}${sector[3] ? `/${sector[3]}` : ''}`;
  return text.replace(/(^|[\s-])([a-z])/g, (_m, pre: string, c: string) => pre + c.toUpperCase());
}

/**
 * The first Pakistani mobile in a sentence, however it was typed.
 *
 * Reads digit runs rather than one shape, because the same number arrives as
 * `03441563032`, `0344 1563032`, `+92 344 156 3032` and `92-344-1563032`
 * depending on whose contact card it was copied from. `toWhatsAppNumber` is the
 * judge of what is actually a mobile, so "20 km" and "F-7" cannot become one.
 */
export function findPhone(text: string): string | null {
  for (const run of text.match(/\+?\d[\d\s\-().]{6,}\d/g) ?? []) {
    const phone = toWhatsAppNumber(run);
    if (phone) return phone;
  }
  return null;
}

/**
 * What an admin's message is asking for. Pure, so every phrasing anybody
 * actually types is a unit test rather than a WhatsApp round trip.
 */
export function readDeskCommand(text: string): DeskCommand {
  const clean = text.trim().toLowerCase();
  if (!clean) return { kind: 'help' };

  const phone = findPhone(text);
  const words = clean.split(/[^a-z0-9/+-]+/).filter(Boolean);

  if (phone) {
    // A number plus "band karo" is the one way an admin can undo their own
    // mistake — the number they typed wrong belongs to somebody.
    return words.some((w) => REMOVE.has(w)) ? { kind: 'remove', phone } : { kind: 'add', phone };
  }

  // Tight on purpose: "alert F-7 ko bhejo" is a broadcast, not the master
  // switch, so only the bare two-word form touches it.
  const master = /^alerts?\s+(on|chalu|start|off|band|bandh)$/.exec(clean);
  if (master) return { kind: 'alerts', on: /^(on|chalu|start)$/.test(master[1]!) };

  if (words.some((w) => STATUS.has(w))) return { kind: 'status' };

  const area = readArea(words);
  // A bare "F-7" is unambiguous enough to act on; anything else has to say what
  // it wants done, or an admin thinking out loud becomes a broadcast.
  if (area && (BROADCAST.test(clean) || SECTOR.test(clean))) return { kind: 'area', area };

  return { kind: 'help' };
}

/**
 * The place name inside an instruction: the longest run of words that are not
 * filler.
 *
 * A run rather than "everything that is not filler" so that "F-7 mein demand
 * hai, G-10 nahi" cannot become "F-7 G-10", and so a two-word name survives
 * intact — which is the whole reason "Blue Area" works.
 */
function readArea(words: string[]): string | null {
  // "area F-7", "sector G-10": filler only in front of the name.
  const rest = words[0] === 'area' || words[0] === 'sector' ? words.slice(1) : words;

  let best: string[] = [];
  let run: string[] = [];
  for (const w of [...rest, '']) {
    if (w && !FILLER.has(w)) {
      run.push(w);
      continue;
    }
    if (run.length > best.length) best = run;
    run = [];
  }
  return best.length ? normaliseArea(best.join(' ')) : null;
}

/**
 * Where an area is, without paying for it twice.
 *
 * Our own map first — `velocityLocations` holds the places riders have actually
 * been driven to, and a sector an admin names is very likely one of them. Only
 * then Google, through the cached geocoder every booking already uses, which
 * makes a repeated "F-7" free after the first time.
 *
 * The result must land in one of our cities. That is the guard against a
 * mistyped name resolving to a sector of Dhaka and alerting nobody, or worse,
 * somebody.
 */
export async function resolveArea(area: string): Promise<{ name: string; lat: number; lng: number } | null> {
  const own = await lookupOwnPlace(area);
  const hit = own ?? (await fetchGeocode(`${area}, Pakistan`));
  if (!hit || !cityFor(hit)) return null;
  return { name: area, lat: hit.lat, lng: hit.lng };
}

/* ───────────────────────────── doing the thing ───────────────────────────── */

/** Numbers allowed to run commands on the business number. Empty = desk off. */
export function deskAdmins(): string[] {
  return (process.env.WHATSAPP_DESK_ADMINS ?? '')
    .split(/[,;\s]+/)
    .map((n) => toWhatsAppNumber(n))
    .filter((n): n is string => n !== null);
}

/** `923441563032` → `+92 344 1563032`, how a number is read back to a person. */
function pretty(phone: string): string {
  return `+${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5)}`;
}

/**
 * The recruit invite: the first thing a driver we met in person ever receives
 * from us.
 *
 * Its own template, with no variables at all — every word was approved by Meta,
 * and a template with nothing to fill cannot fail on a parameter it did not
 * expect. `urlButtonIndex: null` because its button is a static link to the
 * store, which takes no parameter.
 */
function inviteConfig(cfg: WhatsAppConfig | null): WhatsAppConfig | null {
  if (!cfg) return null;
  return {
    ...cfg,
    templateName: (process.env.WHATSAPP_INVITE_TEMPLATE_NAME ?? '').trim() || 'driver_invite',
    templateLang: (process.env.WHATSAPP_INVITE_TEMPLATE_LANG ?? '').trim() || cfg.templateLang,
    urlButtonIndex: null,
  };
}

/** What a recruit is told when they write back and ask. */
export const RECRUIT_HELP =
  '*Drive with Velocity Rides* 🚗\n\n' +
  'What you need to sign up:\n' +
  '1. CNIC — front and back photo\n' +
  '2. Driving licence\n' +
  '3. Vehicle registration book or card\n' +
  '4. Photos of your car — front, back and inside\n' +
  '5. A selfie for the face check\n' +
  '6. 18 years or older, with a smartphone\n\n' +
  'Sign up free in the app:\n' +
  `${APP_LINKS}\n\n` +
  'Open the app → *Become a driver* → upload the papers. We check them the same day, ' +
  'and you keep every rupee of the fare except our 5% commission.\n\n' +
  'Reply STOP to stop these messages.';

/** A plain text message, allowed because the person we are answering wrote first. */
async function say(cfg: WhatsAppConfig, to: string, body: string): Promise<void> {
  const res = await postMessage(cfg, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body, preview_url: false },
  });
  if (!res.ok) logger.warn('WhatsApp desk: reply failed', { detail: res.detail });
}

/**
 * One command from an admin. Returns false when the message was not from an
 * admin number, so the webhook can carry on treating it as anything else.
 */
export async function handleDeskMessage(from: string, text: string): Promise<boolean> {
  const normalised = toWhatsAppNumber(from);
  if (!normalised || !deskAdmins().includes(normalised)) return false;

  const cfg = whatsAppConfig();
  if (!cfg) return true; // nothing can be sent, and this is not a lead either

  const command = readDeskCommand(text);
  logger.info('WhatsApp desk: command', { kind: command.kind, by: normalised.slice(-4) });

  const reply = await runCommand(command, normalised);
  await say(cfg, from, reply);
  return true;
}

async function runCommand(command: DeskCommand, by: string): Promise<string> {
  switch (command.kind) {
    case 'add':
      return addRecruit(command.phone, by);
    case 'remove':
      return removeRecruit(command.phone);
    case 'area':
      return broadcastArea(command.area);
    case 'alerts':
      return setMasterSwitch(command.on, by);
    case 'status':
      return deskStatus();
    case 'help':
      return HELP;
  }
}

const HELP =
  '*Velocity desk* — send me:\n\n' +
  '• `03XX XXXXXXX add karo` — put a driver on the list and send them the app invite\n' +
  '• `03XX XXXXXXX hatao` — take a number off the list\n' +
  '• `F-7 mein demand bhejo` — alert the drivers around an area\n' +
  '• `status` — drivers, recruits and today’s messages\n' +
  '• `alerts on` / `alerts off` — the master switch';

/**
 * Put a number on the list and send it the invite.
 *
 * The consent being recorded here is real but it is OURS to prove: an admin met
 * this person and they said yes. So it is written down with who added it and
 * when, every message it ever sends carries a way out, and a number that has
 * already said STOP is refused outright — re-adding somebody who opted out is
 * not a mistake we are willing to make on an admin's behalf.
 */
/**
 * The driver record of a number that signed in with it, for somebody who has
 * never touched the alerts switch.
 *
 * `statePathForNumber` matches `whatsappAlerts.number`, which only exists once
 * consent has been given once. Without this second look, a driver who has been
 * on the platform for months would be filed as a fresh recruit and invited to
 * download an app they are already driving on.
 */
async function driverPathForPhone(phone: string): Promise<string | null> {
  const users = await db.collection('users').where('phoneNumber', '==', `+${phone}`).limit(1).get();
  const uid = users.docs[0]?.id;
  if (!uid) return null;
  const driver = await db.doc(`drivers/${uid}`).get();
  return driver.exists ? driver.ref.path : null;
}

async function addRecruit(phone: string, by: string): Promise<string> {
  const existing = (await statePathForNumber(phone)) ?? (await driverPathForPhone(phone));

  if (existing) {
    const snap = await db.doc(existing).get();
    const alerts = (snap.get('whatsappAlerts') ?? {}) as { optIn?: boolean; blocked?: boolean };
    if (alerts.blocked === true) {
      return (
        `⛔ ${pretty(phone)} has asked us to stop messaging them, so I cannot add them back.\n` +
        'They can send *START* from that number themselves, or switch alerts on in the app.'
      );
    }

    const isDriver = existing.startsWith('drivers/');
    if (!alerts.optIn) {
      await db.doc(existing).set(
        {
          whatsappAlerts: {
            optIn: true,
            number: phone,
            optInAt: FieldValue.serverTimestamp(),
            optInSource: 'admin-in-person',
            optInBy: `+${by}`,
          },
        },
        { merge: true },
      );
    }
    const who = isDriver
      ? `${(snap.get('fullName') as string | undefined) ?? 'a Velocity driver'} (${(snap.get('verificationStatus') as string | undefined) ?? 'driver'})`
      : 'already on the recruit list';
    return `✅ ${pretty(phone)} — ${who}. Demand alerts are on for them.`;
  }

  const now = FieldValue.serverTimestamp();
  await db.doc(`${PROSPECTS_COLLECTION}/${phone}`).set(
    {
      phone: `+${phone}`,
      source: 'admin-whatsapp',
      addedBy: `+${by}`,
      addedAt: now,
      whatsappAlerts: {
        optIn: true,
        number: phone,
        blocked: false,
        optInAt: now,
        optInSource: 'admin-in-person',
        optInBy: `+${by}`,
      },
    },
    { merge: true },
  );

  const invite = inviteConfig(whatsAppConfig());
  const res = invite ? await sendTemplate(invite, phone, []) : null;
  if (res?.ok) {
    await db.doc(`${PROSPECTS_COLLECTION}/${phone}`).set({ invitedAt: now }, { merge: true });
    return (
      `✅ ${pretty(phone)} added.\n` +
      'The invite with the app link and the papers they need is on its way to them.\n' +
      'They will now get the demand alerts for our cities until they reply STOP.'
    );
  }

  // The number is on the list either way — the only thing that failed is one
  // message, and the owner needs to know exactly which part to fix.
  await db
    .doc(`${PROSPECTS_COLLECTION}/${phone}`)
    .set({ inviteError: res?.detail ?? 'WhatsApp not configured' }, { merge: true });
  return (
    `✅ ${pretty(phone)} added to the list, but the invite did NOT send:\n` +
    `${res?.detail ?? 'WhatsApp is not configured on the backend.'}\n\n` +
    `${res?.code === 132001 ? `Create the template *${invite?.templateName}* in WhatsApp Manager (see docs/WHATSAPP_ALERTS.md) and add them again.` : 'They will still get demand alerts.'}`
  );
}

/** Takes a number off the list. Never deletes the record: an opt-out is evidence. */
async function removeRecruit(phone: string): Promise<string> {
  const path = await statePathForNumber(phone);
  if (!path) return `❓ ${pretty(phone)} is not on the list.`;
  await db.doc(path).set(
    {
      whatsappAlerts: {
        optIn: false,
        blocked: true,
        blockedReason: 'removed by admin',
        blockedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
  return `🚫 ${pretty(phone)} removed. They will get no more WhatsApp from us.`;
}

/** Why nobody was messaged, in the words the person who typed the command needs. */
const BLOCK_REASON: Record<string, string> = {
  disabled: 'WhatsApp alerts are switched off. Send *alerts on* first.',
  'not-configured': 'the WhatsApp credentials are not set on the backend.',
  'circuit-open':
    'the safety breaker is open — Meta pushed back on an earlier send. ' +
    'Check the quality rating in WhatsApp Manager, then clear it from the admin console.',
  'quiet-hours': 'it is quiet hours (10pm–7am). Nobody is messaged at night.',
  'global-cap': "today's WhatsApp budget is spent.",
  'enough-drivers-online': 'enough drivers are already online there.',
  'fare-too-small': 'the fare is below the alert threshold.',
};

async function broadcastArea(area: string): Promise<string> {
  const place = await resolveArea(area);
  if (!place) {
    return (
      `❓ I could not place "${area}" on the map.\n` +
      'Try a sector or a known area — F-7, G-10, Blue Area, Saddar, Bahria Town.'
    );
  }

  const out = await alertAreaDemand(place);
  if (out.blocked) return `⛔ Nothing sent for ${place.name} — ${BLOCK_REASON[out.blocked] ?? out.blocked}`;
  if (out.found === 0) {
    return (
      `😐 Nobody to tell about ${place.name}.\n` +
      'No opted-in driver or recruit is within range of it. Add numbers with ' +
      '`03XX XXXXXXX add karo`.'
    );
  }
  if (out.sent === 0) {
    return (
      `😐 ${place.name}: ${out.found} nearby, but nobody could be messaged right now ` +
      '(already told recently, daily cap reached, or their app is open).' +
      (out.failure ? `\nLast error from Meta: ${out.failure.detail}` : '')
    );
  }
  return (
    `📣 ${place.name}: told ${out.sent} of the ${out.found} nearby` +
    `${out.recruits > 0 ? `, which include ${out.recruits} recruit${out.recruits === 1 ? '' : 's'} without the app yet` : ''}.` +
    (out.failure ? `\n⚠️ One send failed: ${out.failure.detail}` : '')
  );
}

/**
 * The master switch, and only that.
 *
 * Not the circuit breaker: that one is Meta telling us to stop, and clearing it
 * from a phone — without the quality panel in front of you — is how a warning
 * becomes a restriction.
 */
async function setMasterSwitch(on: boolean, by: string): Promise<string> {
  await db.doc(SETTINGS_DOC).set(
    { enabled: on, updatedAt: FieldValue.serverTimestamp(), updatedBy: `+${by}` },
    { merge: true },
  );
  const health = await readHealth();
  logger.warn('WhatsApp desk: master switch', { on, by: by.slice(-4) });
  return on
    ? `🔔 WhatsApp alerts are ON.${health.circuitOpen ? '\n⚠️ The safety breaker is still open, so nothing will send until it is cleared from the admin console.' : ''}`
    : '🔕 WhatsApp alerts are OFF. Sign-in codes still work.';
}

async function deskStatus(): Promise<string> {
  const day = pktDayKey(Date.now());
  const [settings, health, drivers, recruits, usage] = await Promise.all([
    readSettings(),
    readHealth(),
    db.collection('drivers').where('whatsappAlerts.optIn', '==', true).count().get(),
    db.collection(PROSPECTS_COLLECTION).where('whatsappAlerts.optIn', '==', true).count().get(),
    db.doc(`whatsappUsage/${day}`).get(),
  ]);
  const n = (field: string) => (usage.get(field) as number | undefined) ?? 0;

  return (
    '*Velocity WhatsApp desk*\n' +
    `Alerts: ${settings.enabled ? 'ON' : 'OFF'}${health.circuitOpen ? ' (breaker OPEN — nothing sends)' : ''}\n` +
    `Drivers on alerts: ${drivers.data().count}\n` +
    `Recruits waiting for the app: ${recruits.data().count}\n` +
    `Today: ${n('sent')} sent, ${n('failed')} failed, ${n('optOuts')} opted out\n` +
    `Budget left today: ${Math.max(0, settings.dailyGlobalCap - n('reserved'))} of ${settings.dailyGlobalCap}\n` +
    `Radius: ${settings.radiusKm} km · max ${settings.maxPerDriverPerDay} a day per driver`
  );
}

/* ──────────────────────────── a recruit writing back ─────────────────────── */

/**
 * A recruited driver answering the invite.
 *
 * Handled here rather than by the commute bot, which would otherwise greet them
 * as a rider and start asking for their office pin — a driver who asked "kaise
 * karun?" being told to send their office location is the kind of thing that
 * makes somebody delete the chat.
 *
 * The answer is free-form text, which is allowed and unbilled because they
 * wrote first: we are inside Meta's 24-hour service window. It repeats at most
 * once every few hours, and everything they say is kept on their record so the
 * owner can read it later — nobody can open this number's inbox.
 */
export async function handleRecruitReply(
  from: string,
  text: string,
  profileName: string | null,
): Promise<boolean> {
  const phone = toWhatsAppNumber(from);
  if (!phone) return false;
  const ref = db.doc(`${PROSPECTS_COLLECTION}/${phone}`);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const lastHelp = snap.get('lastHelpAt');
  const lastHelpMs = lastHelp instanceof Timestamp ? lastHelp.toMillis() : 0;
  const alerts = (snap.get('whatsappAlerts') ?? {}) as { optIn?: boolean; blocked?: boolean };
  /**
   * Two reasons not to answer, and both still claim the message so the commute
   * bot cannot welcome them as a rider: somebody who said STOP is owed silence,
   * not a different leaflet; and a recruit who has signed up is a driver now,
   * whose chat belongs to their driver record rather than to a recruitment
   * list. The message itself is still kept either way.
   */
  const silenced = alerts.optIn !== true || alerts.blocked === true || snap.get('signedUpAt') != null;
  const due = !silenced && Date.now() - lastHelpMs > RECRUIT_REPLY_GAP_MS;

  const patch: Record<string, unknown> = {
    repliedAt: FieldValue.serverTimestamp(),
    // serverTimestamp() is not allowed inside an array, so the time is the clock's.
    messages: [
      ...((snap.get('messages') as unknown[] | undefined) ?? []),
      { text: text.slice(0, 500), at: new Date().toISOString() },
    ].slice(-20),
  };
  if (profileName && !snap.get('name')) patch.name = profileName.slice(0, 100);
  if (due) patch.lastHelpAt = FieldValue.serverTimestamp();
  await ref.set(patch, { merge: true });

  const cfg = whatsAppConfig();
  if (cfg && due) await say(cfg, from, RECRUIT_HELP);
  return true;
}
