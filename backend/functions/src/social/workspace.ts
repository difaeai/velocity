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
import { AsyncLocalStorage } from 'node:async_hooks';

import { onCall, HttpsError, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { isDocId, requireAuth } from '../lib/guards';
import { canUse, refusal, type Brand, type Need, type Workspace } from '../studio/plans';
import { modelReady } from './engine';

export const HOUSE = 'velocity';

interface Scope {
  wid: string;
  brand: Brand | null;
}

const scope = new AsyncLocalStorage<Scope>();

export const currentWorkspace = (): string => scope.getStore()?.wid ?? HOUSE;
export const isHouse = (): boolean => currentWorkspace() === HOUSE;
/** The customer's brand; null in the house, whose brand is written into the prompts. */
export const workspaceBrand = (): Brand | null => scope.getStore()?.brand ?? null;

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
  const ws = (await workspaceRef(wid).get()).data() as Workspace | undefined;
  if (!ws || ws.ownerUid !== ctx.uid) throw new HttpsError('permission-denied', 'This workspace is not yours.');
  const no = refusal(ws, need, Date.now());
  if (no) throw new HttpsError('failed-precondition', no);
  // The key-free local engine only knows Velocity; a customer's desk needs a model.
  if (!modelReady()) throw new HttpsError('unavailable', 'The AI team is offline for a moment. Try again shortly.');
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
  const others = modelReady() ? await liveWorkspaces(need).catch(() => []) : [];
  for (const wid of [HOUSE, ...others]) {
    try {
      await inWorkspace(wid, fn);
    } catch (e) {
      logger.error('studio: a workspace job failed', { wid, message: (e as Error).message });
    }
  }
}
