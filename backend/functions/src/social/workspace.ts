/**
 * Whose desk this is.
 *
 * Velocity Studio sells the desk to other businesses, so every document and
 * file the desk keeps belongs to one workspace. Velocity's own desk is the
 * **house** workspace and keeps exactly the paths it always had — no migration
 * of a live desk with a 157k account on it — and every other workspace lives
 * under `workspaces/{id}/`.
 *
 * The workspace rides in AsyncLocalStorage, set once where a request or a
 * scheduled pass begins (`deskCall`, `forEachWorkspace`), so the pipeline reads
 * its own documents through `sdb` and `wsPath` without a workspace id threaded
 * through forty signatures. Code outside a scope is the house, which is what
 * every caller was before this file existed.
 *
 * Shared on purpose, never scoped: the Meta app (`system/socialMetaApp`), the
 * OAuth hand-off states, the Pixabay search cache and the starter music.
 */
import { onCall, HttpsError, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { overBudget, warmAi } from '../ai/config';
import { db } from '../lib/firebase';
import { isDocId, requireAuth } from '../lib/guards';
import { canUse, refusal, type Need, type Workspace } from '../studio/plans';
import { creditDue, spendCreditDay } from '../studio/credits';
import { modelReady } from './engine';
import { HOUSE, currentWorkspace, scope } from './scope';

export { HOUSE, currentWorkspace, isHouse, workspaceBrand } from './scope';

/** A desk path for the current workspace: unchanged in the house, under `workspaces/{id}/` otherwise. */
export function wsPath(path: string): string {
  const wid = currentWorkspace();
  return wid === HOUSE ? path : `workspaces/${wid}/${path}`;
}

/** `db.doc` / `db.collection` for the current workspace's own documents. */
export const sdb = {
  doc: (path: string) => db.doc(wsPath(path)),
  collection: (path: string) => db.collection(wsPath(path)),
};

export const workspaceRef = (wid: string) => db.doc(`workspaces/${wid}`);

/** Run `fn` as workspace `wid`. */
export async function inWorkspace<T>(wid: string, fn: () => Promise<T>): Promise<T> {
  // Its keys and this month's AI spend, so the engine's sync checks see them.
  await warmAi(wid);
  if (wid === HOUSE) return scope.run({ wid, brand: null }, fn);
  const ws = (await workspaceRef(wid).get()).data() as Workspace | undefined;
  if (!ws) throw new HttpsError('not-found', 'That Velocity Studio workspace no longer exists.');
  return scope.run({ wid, brand: ws.brand }, fn);
}

/**
 * Who is calling, and which workspace they act on — or refuse.
 *
 * A Velocity admin acts on the house desk. Anyone else acts only on the
 * workspace in their `ws` claim (set by the backend when they sign up), and only
 * for what their plan includes, and only while the trial or a paid month runs.
 */
export async function deskWorkspace(req: CallableRequest, need: Need): Promise<string> {
  const ctx = requireAuth(req);
  const wid = ctx.token.ws;
  if (ctx.role === 'admin' && wid === undefined) return HOUSE;
  if (typeof wid !== 'string' || !isDocId(wid) || wid === HOUSE) {
    throw new HttpsError('permission-denied', 'This account has no Velocity Studio workspace. Sign up at /studio.');
  }
  let ws = (await workspaceRef(wid).get()).data() as Workspace | undefined;
  if (!ws || ws.ownerUid !== ctx.uid) throw new HttpsError('permission-denied', 'This workspace is not yours.');
  await warmAi(wid);
  // A plan run out, or a month's AI used up, with credits left: today goes on credit now, not at the next sweep.
  if (creditDue(ws, Date.now(), overBudget(wid)) && (await spendCreditDay(wid))) {
    ws = (await workspaceRef(wid).get()).data() as Workspace;
  }
  const no = refusal(ws, need, Date.now());
  if (no) throw new HttpsError('failed-precondition', no);
  // The key-free local engine only knows Velocity; a customer's desk needs a model.
  if (!modelReady(wid)) {
    throw new HttpsError(
      'unavailable',
      overBudget(wid)
        ? 'This month’s AI work for your workspace is used up. Buy credits on the Billing page to carry on today — or it starts again on the 1st.'
        : 'The AI team is offline for a moment. Try again shortly.',
    );
  }
  return wid;
}

type Handler<T> = (req: CallableRequest) => Promise<T>;

/**
 * `onCall` for the desk: checks the caller's plan for `need`, then runs the
 * handler inside their workspace. Handlers only need `requireAuth` for the uid.
 */
export function deskCall<T>(need: Need, handler: Handler<T>): ReturnType<typeof onCall>;
export function deskCall<T>(need: Need, opts: CallableOptions, handler: Handler<T>): ReturnType<typeof onCall>;
export function deskCall<T>(need: Need, a: CallableOptions | Handler<T>, b?: Handler<T>): ReturnType<typeof onCall> {
  const [opts, handler] = typeof a === 'function' ? [{}, a] : [a, b as Handler<T>];
  return onCall(opts, async (req) => inWorkspace(await deskWorkspace(req, need), () => handler(req)));
}

/** The customer workspaces a scheduler should visit for `need` right now. */
export async function liveWorkspaces(need: Need, nowMs = Date.now()): Promise<string[]> {
  const snap = await db.collection('workspaces').where('accessUntilMs', '>', nowMs).get();
  return snap.docs.filter((d) => canUse(d.data() as Workspace, need, nowMs)).map((d) => d.id);
}

/**
 * Run a scheduled job once per workspace: the house first, then every customer
 * whose plan covers `need`. One workspace failing never stops the rest.
 */
// shortcut: workspaces run one after another inside one invocation; past ~20 live customers per job, fan out through a job queue.
export async function forEachWorkspace(need: Need, fn: () => Promise<void>): Promise<void> {
  const others = await liveWorkspaces(need).catch(() => []);
  for (const wid of [HOUSE, ...others]) {
    try {
      // The key-free local engine only knows Velocity: a customer with no model
      // left (none configured, or this month's allowance spent) waits.
      await inWorkspace(wid, async () => (wid === HOUSE || modelReady() ? fn() : undefined));
    } catch (e) {
      logger.error('studio: a workspace job failed', { wid, error: (e as Error).message });
    }
  }
}
