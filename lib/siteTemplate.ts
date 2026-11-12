import { firebaseConfig } from './config';

/**
 * Which website velocityrides.app opens as — chosen in the console, under
 * Website.
 *
 * The owner wanted the front page switchable without a deploy: the two sites
 * side by side, or one of them alone at the address itself (not at /rides or
 * /vexa — the chosen one *is* the website, with its own header, footer and
 * pages), or the older front page where a slider of the two sat above
 * everything Vexa does.
 *
 * The choice lives in Firestore at adminConfig/site, which only an admin can
 * write and nobody can read without credentials — so the page reads it on the
 * server, as the App Hosting backend's own service account, through the
 * Firestore REST API. No new dependency, no rule to relax, nothing about it in
 * the browser. Anywhere there is no metadata server (a laptop, a preview, a
 * build) the read is skipped and the default stands, and any failure at all
 * falls back to it rather than taking the front page down.
 */

export const SITE_TEMPLATES = ['split', 'rides', 'vexa', 'mix'] as const;
export type SiteTemplate = (typeof SITE_TEMPLATES)[number];

/** What the console shows for each one. */
export const SITE_TEMPLATE_INFO: Record<SiteTemplate, { name: string; what: string }> = {
  split: {
    name: 'Split website',
    what: 'Both websites at once, each in its own box — Velocity Rides on the left, Vexa on the right, with a way into each.',
  },
  rides: {
    name: 'Only Velocity Rides',
    what: 'The ride app’s website is the whole front page. Vexa stays reachable at /vexa.',
  },
  vexa: {
    name: 'Only Vexa',
    what: 'Vexa’s website is the whole front page — her header, her footer and her pages. Velocity Rides stays at /rides.',
  },
  mix: {
    name: 'Mix (slider on top)',
    what: 'The older front page: a slider of the two products at the top, and everything Vexa does under it.',
  },
};

export const DEFAULT_SITE_TEMPLATE: SiteTemplate = 'split';

/** Where the console writes it. */
export const SITE_TEMPLATE_DOC = { collection: 'adminConfig', id: 'site' } as const;

export const isSiteTemplate = (v: unknown): v is SiteTemplate =>
  typeof v === 'string' && (SITE_TEMPLATES as readonly string[]).includes(v);

/** The access token of whatever service account this server runs as, or null off Google. */
async function runtimeToken(): Promise<string | null> {
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      // Half a minute, like the page itself: never 'no-store', which would make
      // the front page dynamic and read Firestore on every single visit.
      { headers: { 'Metadata-Flavor': 'Google' }, next: { revalidate: 30 }, signal: AbortSignal.timeout(2000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * The chosen template, read on the server. Never throws: anything unexpected —
 * no metadata server, no permission, a doc that was never written — is the
 * default.
 */
export async function readSiteTemplate(): Promise<SiteTemplate> {
  // An override for a laptop, a preview, or an emergency: set SITE_TEMPLATE in
  // apphosting.yaml and the console's choice is ignored until it is removed.
  if (isSiteTemplate(process.env.SITE_TEMPLATE)) return process.env.SITE_TEMPLATE;
  const token = await runtimeToken();
  if (!token) return DEFAULT_SITE_TEMPLATE;
  try {
    const url =
      `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}` +
      `/databases/(default)/documents/${SITE_TEMPLATE_DOC.collection}/${SITE_TEMPLATE_DOC.id}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return DEFAULT_SITE_TEMPLATE;
    const body = (await res.json()) as { fields?: { template?: { stringValue?: string } } };
    const chosen = body.fields?.template?.stringValue;
    return isSiteTemplate(chosen) ? chosen : DEFAULT_SITE_TEMPLATE;
  } catch {
    return DEFAULT_SITE_TEMPLATE;
  }
}
