/**
 * The commute QR bot: somebody scans the poster, lands in our WhatsApp, and a
 * few messages later we know where they start, where they work and when.
 *
 * Every chat is keyed by the sender's number, so a thousand people answering at
 * once are a thousand separate `whatsappLeads/{number}` docs. Nobody reads these
 * chats by hand — the number lives on the Cloud API and has no phone app — so
 * the admin page at /dashboard/whatsapp-leads is the only place they surface.
 *
 * Every reply is free-form, never a template: the person wrote first, so we are
 * inside Meta's 24-hour service window, where non-template replies are allowed
 * and not billed. The bot never messages anyone who has not just messaged it.
 */
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import { postMessage, toWhatsAppNumber, whatsAppConfig } from './client';

// Same links as lib/site.ts (the web app), which the backend cannot import.
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.velocityridzpk.app';
const APP_STORE_URL = 'https://apps.apple.com/pk/app/velocity-rides/id6810774199';
const APP_LINKS = `Android: ${PLAY_URL}\niPhone: ${APP_STORE_URL}`;

export type LeadStep = 'pickup' | 'dropoff' | 'timings' | 'done';

export interface LeadPin {
  lat: number;
  lng: number;
  /** The place name, when they picked one on the map rather than "current location". */
  name: string | null;
  address: string | null;
}

export type LeadInbound =
  | { kind: 'text'; text: string }
  | { kind: 'location'; pin: LeadPin }
  /** A photo, sticker, voice note — anything that is neither a pin nor words. */
  | { kind: 'other' };

export type LeadReply =
  | 'welcome'
  | 'askPickup'
  | 'pickupPinOnly'
  | 'askDropoff'
  | 'dropoffPinOnly'
  | 'askTimings'
  | 'timingsAgain'
  | 'thanks';

export interface LeadTurn {
  step: LeadStep;
  /** Answers to store; `null` clears one, which is what a restart does. */
  answers: { pickup?: LeadPin | null; dropoff?: LeadPin | null; timings?: string | null };
  /** Something said after the questions were done, kept for the admin page. */
  extra?: string;
  replies: LeadReply[];
}

const REPLY_TEXT: Record<LeadReply, string> = {
  welcome:
    `Welcome to *Velocity Rides*! 👋\nThis is the official WhatsApp of Velocity Rides.\n\n` +
    `Get the app:\n${APP_LINKS}`,
  askPickup:
    'Please send your *pickup location* pin 📍\n' +
    'Tap *Send location* below, then send your current location or choose your pickup point on the map.',
  pickupPinOnly:
    'Please send your pickup location as a *pin*, not text.\n' +
    'Tap *Send location* below and choose your pickup point on the map.',
  askDropoff:
    'Now send your *drop-off (office) location* pin 📍\n' +
    'Tap *Send location*, search for your office on the map and send that pin.',
  dropoffPinOnly:
    'Please send your office location as a *pin*, not text.\n' +
    'Tap *Send location*, search for your office on the map and send that pin.',
  askTimings: 'Please enter your *office timings*, e.g. 9am to 5pm',
  timingsAgain: 'Please type your office timings with the time, e.g. 9am to 5pm',
  thanks: `Thank you! ✅\nPlease download the Velocity app:\n${APP_LINKS}`,
};

/** Replies that carry WhatsApp's own "Send location" button. */
const PIN_REPLIES = new Set<LeadReply>(['askPickup', 'pickupPinOnly', 'askDropoff', 'dropoffPinOnly']);

/** The QR's prefilled text is "Hi Velocity"; sending the name again starts over. */
export function isStartMessage(msg: LeadInbound): boolean {
  return msg.kind === 'text' && /velocity/i.test(msg.text);
}

/**
 * One step of the conversation: where they are, what they sent, what happens.
 * Pure, so every branch is a unit test rather than a WhatsApp round trip.
 */
export function leadTurn(step: LeadStep | null, msg: LeadInbound): LeadTurn | null {
  if (step === null || isStartMessage(msg)) {
    return {
      step: 'pickup',
      answers: { pickup: null, dropoff: null, timings: null },
      replies: ['welcome', 'askPickup'],
    };
  }
  switch (step) {
    case 'pickup':
      // Pins only: "G10" cannot be grouped with anyone, a coordinate can.
      return msg.kind === 'location'
        ? { step: 'dropoff', answers: { pickup: msg.pin }, replies: ['askDropoff'] }
        : { step, answers: {}, replies: ['pickupPinOnly'] };
    case 'dropoff':
      return msg.kind === 'location'
        ? { step: 'timings', answers: { dropoff: msg.pin }, replies: ['askTimings'] }
        : { step, answers: {}, replies: ['dropoffPinOnly'] };
    case 'timings':
      // A time has a digit in it; "morning" or a stray emoji does not.
      return msg.kind === 'text' && /\d/.test(msg.text)
        ? { step: 'done', answers: { timings: msg.text }, replies: ['thanks'] }
        : { step, answers: {}, replies: ['timingsAgain'] };
    case 'done':
      return msg.kind === 'text' ? { step, answers: {}, extra: msg.text, replies: [] } : null;
  }
}

/** The bits of Meta's inbound message this bot reads. */
export interface InboundMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}

const clip = (s: string | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);

export function readLeadInbound(msg: InboundMessage): LeadInbound {
  const loc = msg.location;
  if (msg.type === 'location' && loc) {
    const { latitude: lat, longitude: lng } = loc;
    if (
      typeof lat === 'number' && typeof lng === 'number' &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)
    ) {
      return { kind: 'location', pin: { lat, lng, name: clip(loc.name, 200), address: clip(loc.address, 200) } };
    }
    return { kind: 'other' };
  }
  const text = clip(msg.text?.body ?? msg.button?.text, 300);
  return text ? { kind: 'text', text } : { kind: 'other' };
}

export function replyPayload(to: string, reply: LeadReply): Record<string, unknown> {
  const body = REPLY_TEXT[reply];
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  return PIN_REPLIES.has(reply)
    ? {
        ...base,
        type: 'interactive',
        interactive: { type: 'location_request_message', body: { text: body }, action: { name: 'send_location' } },
      }
    : { ...base, type: 'text', text: { body, preview_url: false } };
}

/**
 * Runs one inbound message through the bot and sends its replies.
 *
 * The read-decide-write is one transaction so two quick messages cannot both
 * be read as the same step, and Meta's redelivery of a message we already
 * handled (same `id`) is a no-op rather than a pickup pin saved as the office.
 */
export async function handleLeadMessage(msg: InboundMessage, profileName: string | null): Promise<void> {
  const cfg = whatsAppConfig();
  const from = msg.from;
  if (!cfg || !from || !/^\d{8,15}$/.test(from)) return;
  const inbound = readLeadInbound(msg);
  const ref = db.doc(`whatsappLeads/${from}`);

  const replies = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const seen = (snap.get('seenIds') as string[] | undefined) ?? [];
    if (msg.id && seen.includes(msg.id)) return [];

    // A first message without the QR's words, from somebody we already know —
    // a driver answering an alert, a rider thanking us for a login code — is
    // not a lead, and welcoming them as one would be noise.
    if (!snap.exists && !isStartMessage(inbound)) {
      const [driver, user] = await Promise.all([
        tx.get(db.collection('drivers').where('whatsappAlerts.number', '==', toWhatsAppNumber(from) ?? from).limit(1)),
        tx.get(db.collection('users').where('phoneNumber', '==', `+${from}`).limit(1)),
      ]);
      if (!driver.empty || !user.empty) return [];
    }

    const turn = leadTurn(snap.exists ? (snap.get('step') as LeadStep) : null, inbound);
    if (!turn) return [];

    const now = FieldValue.serverTimestamp();
    const doc: Record<string, unknown> = {
      phone: `+${from}`,
      step: turn.step,
      source: 'whatsapp',
      updatedAt: now,
      seenIds: msg.id ? [...seen, msg.id].slice(-10) : seen,
      ...turn.answers,
    };
    if (profileName) doc.name = profileName.slice(0, 100);
    if (!snap.exists) doc.createdAt = now;
    if (turn.replies[0] === 'welcome') doc.completedAt = null;
    if (turn.step === 'done' && snap.get('step') !== 'done') doc.completedAt = now;
    if (turn.extra) {
      // serverTimestamp() is not allowed inside an array, so the time is the clock's.
      const extras = (snap.get('extraMessages') as unknown[] | undefined) ?? [];
      doc.extraMessages = [...extras, { text: turn.extra, at: new Date().toISOString() }].slice(-20);
    }
    tx.set(ref, doc, { merge: true });
    return turn.replies;
  });

  // In order: the welcome must land before the "send your pickup" button under it.
  for (const reply of replies) {
    const res = await postMessage(cfg, replyPayload(from, reply));
    if (!res.ok) logger.warn('WhatsApp lead: reply failed', { reply, error: res.detail });
  }
}
