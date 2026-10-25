/**
 * The phone line: Twilio's REST API, over fetch, and the check that a webhook
 * really came from Twilio.
 *
 * Twilio because it was asked for by name, and because it does the one thing
 * the AI voice needs from a carrier: it streams a call's audio over a
 * WebSocket (Media Streams), so the voice bridge can hand it to Gemini Live.
 * It calls Pakistani mobiles at $0.18/min. It does NOT rent Pakistani numbers:
 * an agent calls from a Twilio number (US, UK, …) or from the customer's own
 * number once it is verified in Twilio as a caller ID.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.twilio.com/2010-04-01';

export interface TwilioAuth {
  accountSid: string;
  authToken: string;
}

export class TwilioError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TwilioError';
  }
}

async function call<T>(auth: TwilioAuth, method: 'GET' | 'POST' | 'DELETE', path: string, form?: Record<string, string | string[]>): Promise<T> {
  const body = form ? new URLSearchParams() : undefined;
  for (const [k, v] of Object.entries(form ?? {})) {
    for (const one of Array.isArray(v) ? v : [v]) body!.append(k, one);
  }
  const res = await fetch(`${API}/Accounts/${auth.accountSid}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${auth.accountSid}:${auth.authToken}`).toString('base64')}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return {} as T;
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* handled below */
  }
  if (!res.ok) throw new TwilioError(String(json.message ?? (text.slice(0, 200) || res.statusText)), res.status);
  return json as T;
}

/** Proves the SID and token: the account's own record. */
export async function fetchAccount(auth: TwilioAuth): Promise<{ friendlyName: string; status: string; type: string }> {
  const a = await call<{ friendly_name?: string; status?: string; type?: string }>(auth, 'GET', '.json');
  return { friendlyName: a.friendly_name ?? '', status: a.status ?? '', type: a.type ?? '' };
}

export interface OwnedNumber {
  sid: string;
  phone: string;
  name: string;
  /** A rented Twilio number, or a number of the customer's own verified as a caller ID. */
  kind: 'twilio' | 'verified';
}

/** Every number the account can call from. */
export async function listNumbers(auth: TwilioAuth): Promise<OwnedNumber[]> {
  const [rented, verified] = await Promise.all([
    call<{ incoming_phone_numbers?: { sid: string; phone_number: string; friendly_name?: string }[] }>(
      auth,
      'GET',
      '/IncomingPhoneNumbers.json?PageSize=100',
    ),
    call<{ outgoing_caller_ids?: { sid: string; phone_number: string; friendly_name?: string }[] }>(
      auth,
      'GET',
      '/OutgoingCallerIds.json?PageSize=100',
    ),
  ]);
  return [
    ...(rented.incoming_phone_numbers ?? []).map((n) => ({ sid: n.sid, phone: n.phone_number, name: n.friendly_name ?? '', kind: 'twilio' as const })),
    ...(verified.outgoing_caller_ids ?? []).map((n) => ({ sid: n.sid, phone: n.phone_number, name: n.friendly_name ?? '', kind: 'verified' as const })),
  ];
}

/** Numbers on sale in a country that can make calls. */
export async function searchNumbers(auth: TwilioAuth, country: string): Promise<{ phone: string; place: string }[]> {
  const r = await call<{ available_phone_numbers?: { phone_number: string; locality?: string; region?: string }[] }>(
    auth,
    'GET',
    `/AvailablePhoneNumbers/${encodeURIComponent(country)}/Local.json?VoiceEnabled=true&PageSize=10`,
  );
  return (r.available_phone_numbers ?? []).map((n) => ({
    phone: n.phone_number,
    place: [n.locality, n.region].filter(Boolean).join(', '),
  }));
}

export async function buyNumber(auth: TwilioAuth, phone: string): Promise<OwnedNumber> {
  const n = await call<{ sid: string; phone_number: string; friendly_name?: string }>(auth, 'POST', '/IncomingPhoneNumbers.json', {
    PhoneNumber: phone,
  });
  return { sid: n.sid, phone: n.phone_number, name: n.friendly_name ?? '', kind: 'twilio' };
}

export async function releaseNumber(auth: TwilioAuth, sid: string): Promise<void> {
  await call(auth, 'DELETE', `/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`);
}

/** Ring `to`; Twilio asks `answerUrl` what to do when they pick up. */
export async function createCall(
  auth: TwilioAuth,
  p: { to: string; from: string; answerUrl: string; statusUrl: string; ringSeconds: number; maxSeconds: number },
): Promise<{ sid: string }> {
  const c = await call<{ sid: string }>(auth, 'POST', '/Calls.json', {
    To: p.to,
    From: p.from,
    Url: p.answerUrl,
    Method: 'POST',
    StatusCallback: p.statusUrl,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['answered', 'completed'],
    Timeout: String(p.ringSeconds),
    TimeLimit: String(p.maxSeconds),
  });
  return { sid: c.sid };
}

/** Put the phone down on a call. */
export async function hangUp(auth: TwilioAuth, callSid: string): Promise<void> {
  await call(auth, 'POST', `/Calls/${encodeURIComponent(callSid)}.json`, { Status: 'completed' });
}

/**
 * Twilio's request signature: HMAC-SHA1 with the auth token over the exact URL
 * it called plus every POST parameter, sorted by name, as name+value. Pure.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, unknown>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((s, k) => s + k + String(params[k] ?? ''), url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/** True when `signature` is Twilio's for this request. Constant time. */
export function validTwilioRequest(authToken: string, url: string, params: Record<string, unknown>, signature: unknown): boolean {
  if (typeof signature !== 'string' || !signature || !authToken) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A Pakistani mobile as E.164 (+923001234567), or null. Pure. */
export function pkMobileE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(2);
  if (d.startsWith('03') && d.length === 11) d = `92${d.slice(1)}`;
  if (d.startsWith('3') && d.length === 10) d = `92${d}`;
  return /^923\d{9}$/.test(d) ? `+${d}` : null;
}

/** Any phone number as E.164 for calling: a Pakistani mobile, or something already in +E.164. Pure. */
export function dialable(raw: string | null | undefined): string | null {
  const pk = pkMobileE164(raw);
  if (pk) return pk;
  const s = String(raw ?? '').replace(/[\s()-]/g, '');
  // Pakistani landlines (+92 then an area code) are allowed too: businesses answer on them.
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : /^0[1-9]\d{8,10}$/.test(s) ? `+92${s.slice(1)}` : null;
}

/** XML-escape a TwiML attribute value. Pure. */
export const xmlAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
