/**
 * SOS — the five people who hear about it, and the message they get.
 *
 * Pressing SOS does three things at once: it tells our safety desk, it opens
 * the police line, and it puts everything a relative would need into a WhatsApp
 * message. This file is the pure half of that — the numbers, the validation and
 * the text — so all of it can be tested without a phone.
 *
 * ── WHY THE MESSAGE LEAVES FROM THE USER'S OWN NUMBER ───────────────────────
 *
 * Velocity has a WhatsApp Business number and could send these alerts itself,
 * from the server, with no taps at all. We deliberately do not, and the reason
 * is what happens at the other end.
 *
 * A message from an unknown business number at 11pm is a message people have
 * been trained to ignore: it looks like the spam they get every day, it lands
 * in a thread with no history, and the first instinct is to check whether it is
 * a scam rather than to act. A message from their daughter's own number lands
 * in the thread they were already talking in, is already on their home screen,
 * and is believed instantly. Believed instantly is the entire product here.
 *
 * It also means the family can simply reply — to her, not to us — and that a
 * ride-hailing company is never standing in the middle of a family emergency.
 *
 * The cost of that choice is honest and worth stating: WhatsApp gives no way to
 * send on somebody's behalf, so each message is a deep link that opens their
 * WhatsApp with the text already written, and they press send. Five contacts is
 * five presses. `smsAllUrl` below exists for the case where even that is too
 * much — one tap, every contact, still from their own number.
 *
 * ── CAN WE PROVE A CONTACT IS ON WHATSAPP? ──────────────────────────────────
 *
 * Not from here, and not from the server either: there is no API that answers
 * "is this number registered on WhatsApp" for a number that has never messaged
 * us. (The Cloud API only tells you after a send fails, which would mean
 * messaging strangers from the business number to find out — exactly the thing
 * that gets a WhatsApp number restricted.)
 *
 * So the app proves it the only way a phone can: it opens the contact's
 * WhatsApp chat. If the number is not on WhatsApp, WhatsApp itself says so and
 * no chat opens. The user confirms what they saw, and that confirmation is
 * `whatsappCheckedAt`. A contact without it still gets the message — refusing
 * to alert somebody in an emergency over a missing checkbox would be absurd —
 * but the contacts screen keeps asking until it is done.
 */

/**
 * How many people an SOS goes to.
 *
 * Five is the product rule, and it is also the practical ceiling: every contact
 * is one more WhatsApp screen to press send on while something is going wrong,
 * and a list nobody can get to the end of is worse than a short one they can.
 */
export const MAX_EMERGENCY_CONTACTS = 5;

/**
 * Pakistan's national police emergency line.
 *
 * Lives here rather than only in the Safety Centre screen because the SOS sheet
 * dials it too, and two copies of an emergency number is one copy too many.
 */
export const POLICE_HELPLINE = '15';

/** Pakistan. Every number typed without a country code is read as Pakistani. */
const DEFAULT_CC = '92';

/** Pakistan is UTC+5 all year — no daylight saving to get wrong. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** One of the people an SOS goes to. */
export interface EmergencyContact {
  /** Stable id, so a row can be removed without matching on the number. */
  id: string;
  name: string;
  /** Digits only, international, no leading '+' — what wa.me takes verbatim. */
  phone: string;
  /** Epoch ms of the last confirmed WhatsApp chat open, or null. See header. */
  whatsappCheckedAt: number | null;
}

/**
 * Turn whatever somebody typed into the digits WhatsApp wants.
 *
 * Pakistanis write their own number at least four ways — 0300 1234567,
 * +92 300 1234567, 0092 300 1234567, 300 1234567 — and all four have to end up
 * as 923001234567, because a WhatsApp deep link built from anything else opens
 * an error page instead of a chat. Returns null when the input cannot be a
 * phone number at all; the caller turns that into something the user can act on.
 */
export function toWhatsAppNumber(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  // A leading '+' means the user already wrote the country code, so none of the
  // local-format rules below apply to it.
  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (!hadPlus) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = DEFAULT_CC + digits.slice(1);
    else if (digits.length === 10 && digits.startsWith('3')) digits = DEFAULT_CC + digits;
  }

  // "92 0300 1234567" — the country code AND the trunk zero. There is no
  // Pakistani area code 0, so this is always the mistake it looks like.
  if (digits.startsWith(`${DEFAULT_CC}0`)) digits = DEFAULT_CC + digits.slice(3);

  // E.164 bounds. Anything outside them is a typo, not a number.
  if (digits.length < 10 || digits.length > 15) return null;
  // 0000000000 and friends.
  if (/^(\d)\1+$/.test(digits)) return null;

  return digits;
}

/** `923001234567` → `+92 300 1234567`. Display only — never sent anywhere. */
export function formatPhone(digits: string): string {
  if (digits.length === 12 && digits.startsWith(DEFAULT_CC)) {
    return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
  }
  return `+${digits}`;
}

/** Why a contact could not be added. */
export type ContactRejection = 'name' | 'phone' | 'duplicate' | 'self' | 'full';

export type ContactCheck =
  | { ok: true; contact: EmergencyContact }
  | { ok: false; reason: ContactRejection; message: string };

/**
 * Validate one new (or edited) contact against the list it is joining.
 *
 * Every rule here is also a rule the SOS depends on later: a duplicate means
 * one person gets two identical panics while somebody else gets none, and the
 * user's own number in the list means a seat wasted on a phone that is, by
 * definition, already in the hands of whoever is in trouble.
 */
export function prepareContact(args: {
  existing: readonly EmergencyContact[];
  name: string;
  phone: string;
  /** The user's own number, so they cannot list themselves. */
  ownPhone?: string | null;
  /** Set when editing an existing row, so it does not collide with itself. */
  id?: string;
  now?: number;
}): ContactCheck {
  const { existing, ownPhone, id, now = Date.now() } = args;

  const name = args.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    return { ok: false, reason: 'name', message: 'Give this person a name you will recognise.' };
  }

  const phone = toWhatsAppNumber(args.phone);
  if (!phone) {
    return {
      ok: false,
      reason: 'phone',
      message: 'That does not look like a phone number. Try 0300 1234567.',
    };
  }

  const own = ownPhone ? toWhatsAppNumber(ownPhone) : null;
  if (own && own === phone) {
    return {
      ok: false,
      reason: 'self',
      message: 'This is your own number. An SOS has to reach somebody else.',
    };
  }

  const clash = existing.find((c) => c.phone === phone && c.id !== id);
  if (clash) {
    return { ok: false, reason: 'duplicate', message: `${clash.name} is already on your list.` };
  }

  const replacing = id ? existing.some((c) => c.id === id) : false;
  if (!replacing && existing.length >= MAX_EMERGENCY_CONTACTS) {
    return {
      ok: false,
      reason: 'full',
      message: `You can have ${MAX_EMERGENCY_CONTACTS} emergency contacts. Remove one first.`,
    };
  }

  const previous = id ? existing.find((c) => c.id === id) : undefined;
  return {
    ok: true,
    contact: {
      id: id ?? `c${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      name: name.slice(0, 40),
      phone,
      // Changing the number invalidates the WhatsApp check; renaming does not.
      whatsappCheckedAt: previous && previous.phone === phone ? previous.whatsappCheckedAt : null,
    },
  };
}

/** Everything the SOS message is built from. Any part of it may be missing. */
export interface SosFacts {
  sender: { name?: string | null; phone?: string | null };
  when: Date;
  location: { lat: number; lng: number; address?: string | null } | null;
  trip: {
    id: string;
    status?: string | null;
    pickup?: string | null;
    dropoff?: string | null;
    driverName?: string | null;
    driverPhone?: string | null;
    vehicle?: string | null;
    plate?: string | null;
  } | null;
  /** The live-tracking page, when one could be minted. */
  watchUrl?: string | null;
}

/** A point on the map anyone can open, with or without the app. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** "16 Oct 2026, 21:42 PKT". 24-hour, because am/pm is one more thing to misread. */
export function pktStamp(when: Date): string {
  const t = new Date(when.getTime() + PKT_OFFSET_MS);
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[t.getUTCMonth()];
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${mon} ${t.getUTCFullYear()}, ${hh}:${mm} PKT`;
}

/** Trip statuses as a worried relative should read them. */
function readableStatus(status: string | null | undefined): string | null {
  switch (status) {
    case 'requested':   return 'waiting for a driver';
    case 'matched':     return 'driver confirmed';
    case 'arriving':    return 'driver on the way to me';
    case 'arrived':     return 'driver is here';
    case 'in_progress': return 'ride in progress';
    default:            return null;
  }
}

/**
 * The message itself.
 *
 * Written to be forwarded. Whoever receives it may well not be the person who
 * acts on it — it gets screenshotted into a family group, read out to a police
 * constable on 15, or passed to a cousin who lives nearer — so every line has
 * to stand on its own, the plate and both phone numbers have to be in plain
 * text rather than behind a link, and nothing may depend on having the app.
 *
 * The location link comes early for the same reason: it is the one line that
 * stops being useful if the reader gives up halfway down.
 */
export function buildSosMessage(f: SosFacts): string {
  const who = (f.sender.name ?? '').trim();
  const senderDigits = f.sender.phone ? toWhatsAppNumber(f.sender.phone) : null;
  const lines: string[] = [];

  lines.push('🆘 EMERGENCY — I need help');
  lines.push('');
  lines.push(
    `${who ? `This is ${who}` : 'I'}${senderDigits ? ` (${formatPhone(senderDigits)})` : ''}. ` +
      'I pressed SOS in the Velocity Rides app.',
  );

  if (f.location) {
    lines.push('');
    lines.push('📍 Where I am right now');
    lines.push(mapsUrl(f.location.lat, f.location.lng));
    if (f.location.address) lines.push(f.location.address);
  } else {
    lines.push('');
    lines.push('📍 My phone could not get a location fix. Call me.');
  }

  if (f.watchUrl) {
    lines.push('');
    lines.push('👁️ Follow my ride live (opens in any browser)');
    lines.push(f.watchUrl);
  }

  const t = f.trip;
  if (t) {
    const driverDigits = t.driverPhone ? toWhatsAppNumber(t.driverPhone) : null;
    const driver: string[] = [];
    if (t.driverName) driver.push(`Name: ${t.driverName}`);
    if (driverDigits) driver.push(`Phone: ${formatPhone(driverDigits)}`);
    if (t.vehicle)    driver.push(`Car: ${t.vehicle}`);
    if (t.plate)      driver.push(`Plate: ${t.plate}`);
    if (driver.length) {
      lines.push('');
      lines.push('🚕 My driver');
      lines.push(...driver);
    }

    const ride: string[] = [];
    if (t.pickup)  ride.push(`From: ${t.pickup}`);
    if (t.dropoff) ride.push(`To: ${t.dropoff}`);
    const status = readableStatus(t.status);
    if (status) ride.push(`Status: ${status}`);
    ride.push(`Trip ID: ${t.id}`);
    lines.push('');
    lines.push('🛣️ The ride');
    lines.push(...ride);
  }

  lines.push('');
  lines.push(`⏰ ${pktStamp(f.when)}`);
  lines.push('');
  lines.push(
    `If you cannot reach me, call the police on ${POLICE_HELPLINE} and read them this message.`,
  );

  return lines.join('\n');
}

/**
 * The two ways to open one person's WhatsApp chat with the text ready to send.
 *
 * `app` keeps the user inside WhatsApp; `web` is the fallback for a phone where
 * the custom scheme is not registered, and it is also what shows WhatsApp's own
 * "this number is not on WhatsApp" page — which is how a bad contact is caught.
 */
export function whatsAppChatUrls(phone: string, text: string): { app: string; web: string } {
  const t = encodeURIComponent(text);
  return {
    app: `whatsapp://send?phone=${phone}&text=${t}`,
    web: `https://wa.me/${phone}?text=${t}`,
  };
}

/**
 * One SMS to everybody, from the user's own number.
 *
 * The escape hatch for the worst version of the emergency: no WhatsApp, no data
 * signal, or no hands free to press send five times. SMS crosses a dead mobile
 * data connection that WhatsApp cannot, which on a road between two cities is
 * not a rare case.
 *
 * The recipient separator is platform-specific — iOS splits on commas, Android
 * on semicolons — and getting it wrong sends one message to one impossible
 * number instead of five messages to five people.
 */
export function smsAllUrl(phones: readonly string[], text: string, os: string): string {
  const to = phones.map((p) => `+${p}`).join(os === 'ios' ? ',' : ';');
  const body = encodeURIComponent(text);
  return os === 'ios' ? `sms:${to}&body=${body}` : `smsto:${to}?body=${body}`;
}

/**
 * The one-line hello sent when a contact is added.
 *
 * Its real job is not the greeting. It is the WhatsApp check from the header:
 * sending it is the proof that this number has WhatsApp. That it also warns the
 * contact before a 2am panic arrives — so they know to pick up — is why it is
 * worded as something a person would actually send.
 */
export function contactIntroMessage(senderName?: string | null): string {
  const who = (senderName ?? '').trim();
  return (
    `Hi, ${who ? `it's ${who}. ` : ''}I've added you as my emergency contact on Velocity Rides. ` +
    "If I ever press SOS in the app, you will get my live location and my driver's details " +
    'on this chat. Please keep this number handy.'
  );
}
