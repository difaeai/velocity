/**
 * Reading a prospect's website: free, three requests at most, no model.
 *
 * Harvey's best idea, ported: the facts that make a cold email specific — who
 * they are, how to reach them, whether they already pay for ads — are sitting in
 * HTML anybody can fetch. This turns a page into those facts with plain
 * matching, so the writer has something real to say and no tokens are spent
 * finding it.
 *
 * Every address fetched here came from map data, a model or a customer, so the
 * fetch refuses anything that resolves to a private, loopback or metadata
 * address (SSRF), caps size and time, and follows no more than three redirects.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;

/** True for addresses a server must never be tricked into calling. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** A URL we may fetch: http(s), a public host name, resolving only to public addresses. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web addresses can be read.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('Not a public site.');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(privateAddress)) throw new Error('Not a public site.');
  return url;
}

/** GET a public page as text, size- and time-capped, redirects checked one by one. */
export async function fetchPage(raw: string): Promise<{ url: string; html: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; VelocityStudioBot/1.0; +https://velocityrides.app/studio)' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location') as string, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`The site answered ${res.status}.`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    return { url: url.toString(), html: Buffer.concat(chunks).toString('utf8') };
  }
  throw new Error('Too many redirects.');
}

/** The words a person would read on a page: no scripts, styles or tags, whitespace collapsed. Pure. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Addresses that are never a person to write to. */
const JUNK_EMAIL = /(example\.|sentry|wixpress|godaddy|\.png|\.jpg|\.webp|\.gif|@2x|noreply|no-reply|domain\.com|email\.com)/i;

export interface SiteRead {
  title: string;
  description: string;
  emails: string[];
  phones: string[];
  /** Plain-language observations the writer may use, e.g. "runs Meta ads". */
  signals: string[];
}

/** Facts from one page of HTML. Pure: tested without a network. */
export function readSite(html: string, pageUrl: string): SiteRead {
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  // "info&#64;site" and "info [at] site" are the commonest ways a page hides an address from scrapers.
  const decoded = html.replace(/&#64;|&#x40;|\s?\[at\]\s?|\s?\(at\)\s?/gi, '@');
  const text = decoded.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');

  const found = new Set<string>();
  for (const m of decoded.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) found.add(m[0].toLowerCase());
  const emails = [...found]
    .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e))
    // Their own domain first: info@theirsite beats a web designer's address in the footer.
    .sort((a, b) => Number(b.endsWith(host)) - Number(a.endsWith(host)))
    .slice(0, 5);

  // tel: links, and the WhatsApp number in a wa.me / click-to-chat link — the number most Pakistani shops answer.
  const phones = [
    ...new Set([
      ...[...html.matchAll(/tel:([+\d][\d\s-]{6,18}\d)/gi)].map((m) => m[1].replace(/[\s-]/g, '')),
      ...[...html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)\+?(\d{10,15})/gi)].map((m) => `+${m[1]}`),
    ]),
  ].slice(0, 3);

  const has = (re: RegExp) => re.test(html);
  const signals = [
    has(/connect\.facebook\.net|fbq\(/) ? 'runs Meta (Facebook/Instagram) ads — the Meta pixel is on the site' : '',
    has(/googleadservices|gtag\(\s*['"]config['"]\s*,\s*['"]AW-/) ? 'runs Google Ads' : '',
    has(/instagram\.com\//i) ? 'links to an Instagram account' : 'no Instagram link on the site',
    has(/wa\.me\/|api\.whatsapp\.com/i) ? 'takes orders or questions on WhatsApp' : '',
    !has(/\b(book|booking|appointment|reserve|order now|order online)\b/i) ? 'no way to book or order online on the home page' : '',
  ].filter(Boolean);

  const pick = (re: RegExp) => (html.match(re)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    title: pick(/<title[^>]*>([^<]*)<\/title>/i),
    description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    emails,
    phones,
    signals,
  };
}

/** The same-site link a page labels as its contact page, or null. Pure. */
export function contactLink(html: string, pageUrl: string): string | null {
  const host = new URL(pageUrl).hostname;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    if (!/contact|get in touch|reach us/i.test(`${m[1]} ${m[2]}`)) continue;
    try {
      const u = new URL(m[1], pageUrl);
      if (u.hostname === host && /^https?:$/.test(u.protocol)) return u.href;
    } catch {
      /* not a link */
    }
  }
  return null;
}

/**
 * A business as its own site describes it: the home page, then — only when the
 * home page gives no address or no number — its contact page, where most small
 * businesses put them. Two extra pages at most, each through fetchPage's guard.
 */
export async function readBusiness(website: string): Promise<{ url: string; site: SiteRead }> {
  const home = await fetchPage(website);
  const site = readSite(home.html, home.url);
  const tries = [contactLink(home.html, home.url), new URL('/contact', home.url).href].filter(
    (u, i, all): u is string => Boolean(u) && u !== home.url && all.indexOf(u) === i,
  );
  for (const next of tries) {
    if (site.emails.length && site.phones.length) break;
    try {
      const page = await fetchPage(next);
      const more = readSite(page.html, page.url);
      site.emails = [...new Set([...site.emails, ...more.emails])].slice(0, 5);
      site.phones = [...new Set([...site.phones, ...more.phones])].slice(0, 3);
    } catch {
      /* no contact page is normal */
    }
  }
  return { url: home.url, site };
}
