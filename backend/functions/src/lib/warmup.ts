/**
 * Wake-up pings for the sign-in callables.
 *
 * Sign-in is the one moment the app cannot hide a slow function: somebody is
 * watching a spinner, waiting for a code. At Velocity's volume every sign-in
 * function has gone back to sleep by the time the next person arrives, and in
 * production (September 2026) nearly every `startWhatsAppOtp` request started a
 * new instance: about 2.5 s to boot, then up to 9 s more while the fresh
 * instance opened its first connection across to Firestore in nam5. The same
 * request on an instance that was already awake took 1.6 s.
 *
 * So the app pings each function a few seconds before it needs it — the send
 * function as the phone-number screen opens, the verify or exchange function
 * the moment a code is on its way — and the instance is booted and connected by
 * the time the real request lands. It is the free alternative to `minInstances`,
 * which would bill an idle instance all month for a handful of logins.
 *
 * Each function is its own Cloud Run service, so a ping only ever wakes the
 * function it is sent to. That is why it is a mode of each callable rather than
 * a callable of its own.
 */
import { db } from './firebase';

/** True for `{ warm: true }`, which is the whole of a ping's payload. */
export function isWarmPing(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { warm?: unknown }).warm === true;
}

/** An instance that read something this recently already has its channel open. */
const REWARM_MS = 60_000;
let warmedAt = 0;

/**
 * Opens this instance's Firestore channel with one small read.
 *
 * Booting the container is only half of a cold start; the first Firestore call
 * on a fresh instance pays for the connection and the credential as well. The
 * read is skipped when this instance did one in the last minute, so a flood of
 * pings costs at most one read per instance per minute: all a ping can do is
 * wake the function, which any request could already do.
 */
export async function warmUp(): Promise<{ warm: true }> {
  const now = Date.now();
  if (now - warmedAt >= REWARM_MS) {
    warmedAt = now;
    await db.doc('config/whatsappOtp').get().catch(() => undefined);
  }
  return { warm: true };
}
