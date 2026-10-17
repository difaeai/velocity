/**
 * Road alerts — the shapes, and what each field is allowed to claim.
 * ----------------------------------------------------------------------------
 * A rider opens the booking screen and wants one question answered before they
 * commit money: *is anything on my way broken right now?* Pakistan has no
 * machine-readable answer to that. No traffic police force in the country
 * publishes a feed, there is no national incidents API, and the commercial ones
 * could not be confirmed to carry Pakistani incidents at all. What does exist
 * is the newsroom: Dawn, Tribune, Geo, ARY, The News, ProPakistani and Pakistan
 * Observer all serve working RSS, and between them they report a closure within
 * the hour it happens.
 *
 * So this module reads the news and refuses almost all of it. See `classify.ts`
 * for the rules, which are the actual product here — a feature that says
 * "KHYBER ROAD CLOSED" because a columnist wrote "a road is not a corridor" is
 * worse than no feature, because it is the kind of wrong that gets believed
 * once and then never again.
 *
 * WHAT AN ALERT IS NOT
 * --------------------
 *  · It is NOT a live traffic layer. We do not know how fast cars are moving.
 *    Nothing here ever claims a delay in minutes, because nothing here measures
 *    one. Google's own traffic colours already sit under the route on the map.
 *  · It is NOT a pinpoint. Coordinates come from `gazetteer.ts`, a hand-written
 *    list of major corridors with deliberately generous radii. An alert says
 *    "on or near Shahrah-e-Faisal", never "at 24.8601, 67.0752".
 *  · It is NOT advice. It reports what a newspaper reported, names the paper,
 *    and links the story so the rider can read it themselves.
 * ----------------------------------------------------------------------------
 */

/** What happened. Ordered roughly by how much a commuter cares. */
export type TrafficKind =
  | 'closure'
  | 'protest'
  | 'vip_movement'
  | 'accident'
  | 'weather'
  | 'construction'
  | 'congestion';

export type TrafficSeverity = 'high' | 'medium' | 'low';

/**
 * `city` alerts belong to one of the cities we serve and show on its booking
 * screens. `highway` alerts are intercity — a motorway or a pass — and reach a
 * rider only when their actual route runs along it.
 */
export type TrafficScope = 'city' | 'highway';

/** One item as a feed served it, before anything has been believed. */
export interface FeedItem {
  sourceId: string;
  sourceName: string;
  title: string;
  /** Description/content, tags stripped. May be empty. */
  summary: string;
  link: string;
  /** Epoch ms from the feed's own date field, or null when unparseable. */
  publishedAt: number | null;
}

/** A place an alert touches, resolved against our own gazetteer. */
export interface AlertPlace {
  /** The canonical name, as the gazetteer spells it. */
  name: string;
  lat: number;
  lng: number;
  /**
   * How far from `lat/lng` this corridor plausibly reaches. A road is a line
   * and this is a circle, so the radius is generous on purpose — it is the
   * honest width of our ignorance, not a measurement.
   */
  radiusM: number;
}

/**
 * WHEN the road is actually broken, as opposed to how long we keep the record.
 *
 * `stated` windows are read out of the story's own words by `window.ts` — "from
 * 2pm to 6pm", "closed on Sunday", "for three days". `kind` windows are the
 * fallback and mean the story gave no hours, so the window is the per-kind
 * lifetime running from publication, which is what every alert had before
 * windows existed.
 *
 * The read path shows an alert only inside this window. That is the whole
 * point: a protest announced in the morning for the afternoon should not be on
 * a rider's screen at breakfast, and should be gone by dinner.
 */
export interface AlertWindow {
  startsAt: number;
  endsAt: number;
  basis: 'stated' | 'kind';
  /** The words a stated window was read from. Null on a kind default. */
  phrase: string | null;
}

/** A road event we have decided to believe and publish. */
export interface TrafficAlert {
  /** Stable: derived from the story's URL, so re-reading a feed updates. */
  id: string;
  scope: TrafficScope;
  /** Registry city code (ISB/KHI/LHE/MUX/PEW…), or null on a highway alert. */
  cityCode: string | null;
  cityName: string | null;
  kind: TrafficKind;
  severity: TrafficSeverity;
  /** The newspaper's own headline, trimmed. Never rewritten by us. */
  headline: string;
  /** One sentence of the story — the one the classifier matched on. */
  detail: string | null;
  /** Canonical gazetteer names, for the "Shahrah-e-Faisal · Korangi Rd" line. */
  roads: string[];
  places: AlertPlace[];
  source: { id: string; name: string; url: string };
  publishedAt: number;
  /** When the disruption itself runs. Shown only inside it. See `window.ts`. */
  window: AlertWindow;
  /**
   * When the DOCUMENT may be deleted, which is the end of the window — once
   * the problem is over there is no read path that wants the record.
   *
   * It is not `publishedAt + lifetime` any more, and it must not go back to
   * being that: a Friday story about a Sunday closure would then be swept on
   * Saturday, before its own window ever opened, and the alert would never be
   * shown to anybody.
   */
  expiresAt: number;
  createdAt: number;
}

/** Firestore collection. One document per story we kept. */
export const TRAFFIC_COLLECTION = 'trafficAlerts';

/** Severity order, for sorting a list the rider reads top-down. */
export const SEVERITY_RANK: Record<TrafficSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
