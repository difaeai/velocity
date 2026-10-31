/**
 * Road alerts — what the rest of the backend sees.
 *
 * The pipeline is: `sources.ts` fetches thirteen Pakistani news feeds — two of
 * them Islamabad-specific, one of which carries Islamabad Traffic Police
 * advisories verbatim — `classify.ts` refuses roughly 99% of what they carry,
 * `gazetteer.ts` turns the surviving road names into our own coordinates,
 * `window.ts` reads the hours the story gave so an alert only shows while the
 * road is actually broken, `ingest.ts` stores them on a schedule, and
 * `functions.ts` serves them to a rider's city or a driver's route.
 *
 * Read `types.ts` first — it says what an alert is allowed to claim.
 */
export { getTrafficAlerts, adminGetTrafficRun, adminRefreshTrafficAlerts } from './functions';
export { refreshTrafficAlerts } from './ingest';
export type { TrafficAlert, TrafficKind, TrafficSeverity } from './types';
