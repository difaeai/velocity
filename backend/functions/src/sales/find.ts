/**
 * Who exists: businesses of one kind in one city.
 *
 * Two free sources, as in Harvey. OpenStreetMap first — no key, no bill, every
 * entry a real place, but thin where shops have no website listed (much of
 * Pakistan). Then the engine's own grounded web search for businesses that do
 * have a site, where nothing is kept until the site has actually been fetched:
 * a model can name a business that does not exist, a web server cannot answer
 * for one.
 */
import { logger } from 'firebase-functions';

import { generateJson, modelReady } from '../social/engine';
import { fetchPage, readSite } from './site';

export interface FoundBusiness {
  name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  source: 'map' | 'search';
}

const UA = 'VelocityStudio/1.0 (+https://velocityrides.app/studio)';

/** The map tags for the kinds people ask for most; anything else is matched by name. */
const OSM_TAGS: Record<string, string[]> = {
  restaurant: ['amenity=restaurant', 'amenity=fast_food'],
  cafe: ['amenity=cafe'],
  bakery: ['shop=bakery', 'shop=confectionery', 'shop=pastry'],
  clinic: ['amenity=clinic', 'amenity=doctors'],
  dentist: ['amenity=dentist'],
  pharmacy: ['amenity=pharmacy'],
  salon: ['shop=hairdresser', 'shop=beauty'],
  gym: ['leisure=fitness_centre'],
  school: ['amenity=school', 'amenity=college'],
  hotel: ['tourism=hotel', 'tourism=guest_house'],
  'real estate': ['office=estate_agent'],
  'car dealer': ['shop=car'],
  clothing: ['shop=clothes', 'shop=boutique'],
  jeweller: ['shop=jewelry'],
  furniture: ['shop=furniture'],
  electronics: ['shop=electronics', 'shop=mobile_phone'],
  'travel agent': ['shop=travel_agency', 'office=travel_agent'],
  lawyer: ['office=lawyer'],
  accountant: ['office=accountant'],
};

/** Overpass QL for a kind inside a box (south, west, north, east). Pure. */
export function osmQuery(kind: string, box: [number, number, number, number]): string {
  const bbox = box.join(',');
  const tags = OSM_TAGS[kind.trim().toLowerCase()];
  const clauses = tags
    ? tags.map((t) => {
        const [k, v] = t.split('=');
        return `nwr["${k}"="${v}"]["name"](${bbox});`;
      })
    : // Unknown kind: anything with a shop/office/amenity tag whose name says it.
      ['shop', 'office', 'amenity', 'craft'].map(
        (k) => `nwr["${k}"]["name"~"${kind.replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 40)}",i](${bbox});`,
      );
  return `[out:json][timeout:25];(${clauses.join('')});out center tags 80;`;
}

/** Map entries worth having: a name, and some way to reach them. Pure. */
export function fromOsm(elements: { tags?: Record<string, string> }[]): FoundBusiness[] {
  const seen = new Set<string>();
  const out: FoundBusiness[] = [];
  for (const { tags = {} } of elements) {
    const name = (tags.name ?? '').trim();
    const website = tags.website ?? tags['contact:website'] ?? null;
    const email = tags.email ?? tags['contact:email'] ?? null;
    const phone = tags.phone ?? tags['contact:phone'] ?? null;
    if (!name || seen.has(name.toLowerCase()) || (!website && !email && !phone)) continue;
    seen.add(name.toLowerCase());
    out.push({
      name: name.slice(0, 120),
      website: website && /^https?:\/\//.test(website) ? website.slice(0, 300) : website ? `https://${website}`.slice(0, 300) : null,
      email: email?.split(/[;,\s]/)[0]?.toLowerCase().slice(0, 200) ?? null,
      phone: phone?.slice(0, 40) ?? null,
      source: 'map',
    });
  }
  return out;
}

export async function findOnMap(kind: string, city: string): Promise<FoundBusiness[]> {
  const geo = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city)}`,
    { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) },
  );
  const place = ((await geo.json()) as { boundingbox?: string[] }[])[0];
  if (!place?.boundingbox) return [];
  const [south, north, west, east] = place.boundingbox.map(Number);
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(osmQuery(kind, [south, west, north, east]))}`,
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`The map answered ${res.status}.`);
  return fromOsm(((await res.json()) as { elements?: { tags?: Record<string, string> }[] }).elements ?? []);
}

/** Businesses with their own website, from the engine's web search — each one fetched before it is kept. */
export async function findBySearch(kind: string, city: string, model: string): Promise<FoundBusiness[]> {
  if (!modelReady()) return [];
  const { data } = await generateJson<{ businesses?: { name?: string; website?: string }[] }>({
    model,
    grounded: true,
    what: 'The prospect search',
    system:
      'You find real local businesses for a salesperson. Use search. Only list a business whose own website you saw in the results, with that exact address. Never guess an address — leave the business out instead.',
    prompt: `Find up to 15 ${kind} businesses in ${city} that have their own website (not a directory or marketplace listing).\nReply with one JSON object and nothing else: {"businesses": [{"name": "...", "website": "https://..."}]}`,
  });
  const out: FoundBusiness[] = [];
  for (const b of (data.businesses ?? []).slice(0, 15)) {
    const name = (b.name ?? '').trim().slice(0, 120);
    if (!name || !b.website) continue;
    try {
      const page = await fetchPage(b.website);
      const site = readSite(page.html, page.url);
      out.push({ name, website: page.url, email: site.emails[0] ?? null, phone: site.phones[0] ?? null, source: 'search' });
    } catch (e) {
      logger.info('sales: a searched site did not answer; dropped', { website: b.website, message: (e as Error).message });
    }
  }
  return out;
}
