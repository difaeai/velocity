/**
 * The staff.
 *
 * You hire people, you name them, and from that moment they do the job their
 * role covers — on every run, without being asked again. Nobody is hard-coded:
 * an empty team makes nothing, a team of one writer makes scripts and no
 * pictures, and a team with two designers shares the drawing between them.
 *
 * Three decisions worth knowing about:
 *
 * 1. **Who works is a database question, not a code question.** The pipeline
 *    asks "who covers the design stage today?" and gets an employee or nothing.
 *    That is what makes "add someone to the team and they start working" true
 *    rather than a figure of speech.
 * 2. **Work is shared by who worked least recently.** Two writers alternate,
 *    the way two writers actually would. It is also the only fair rule that
 *    needs no manager.
 * 3. **Nobody is deleted quietly.** Firing removes them from the roster, but
 *    every piece they worked on keeps their name in `team` and `work`, because
 *    "who wrote this claim" is a question you may need answered next year.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import {
  ROLES,
  ROLE_SPECS,
  STAGE_COVER,
  type Employee,
  type Role,
  type Stage,
  type TeamMemberRef,
} from './types';

const COLLECTION = 'socialEmployees';
const employeeRef = (id: string) => db.doc(`${COLLECTION}/${id}`);

/** Distinct enough to tell four people apart in a work log at a glance. */
const COLOURS = ['#ccff00', '#ff8a3d', '#4db8ff', '#b07dff', '#28c76f', '#ff5c8a', '#ffd166', '#00cfc1'];

/** Everyone on the books, in hiring order. */
export async function listEmployees(): Promise<Employee[]> {
  const snap = await db.collection(COLLECTION).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Employee), id: d.id }))
    .sort((a, b) => a.hiredAtMs - b.hiredAtMs);
}

/** Everyone who is actually working today. */
export async function activeTeam(): Promise<Employee[]> {
  return (await listEmployees()).filter((e) => e.status === 'active');
}

export function teamRefs(team: Employee[]): TeamMemberRef[] {
  return team.map((e) => ({ id: e.id, name: e.name, role: e.role, title: e.title }));
}

/**
 * Who is doing this stage today?
 *
 * The role that owns the stage first; if nobody holds it, whoever covers for
 * them; if nobody covers it either, null — and the caller says so out loud
 * instead of quietly skipping the work.
 */
export function assign(team: Employee[], stage: Stage): { employee: Employee; covering: boolean } | null {
  const cover = STAGE_COVER[stage];
  const pick = (role: Role): Employee | null => {
    const candidates = team.filter((e) => e.role === role);
    if (!candidates.length) return null;
    // Least recently worked, then longest-serving. Two people in the same job
    // alternate, which is both fair and what a real rota does.
    return candidates.sort(
      (a, b) => (a.lastWorkedAtMs ?? 0) - (b.lastWorkedAtMs ?? 0) || a.hiredAtMs - b.hiredAtMs,
    )[0];
  };

  const owner = pick(cover.primary);
  if (owner) return { employee: owner, covering: false };

  for (const fallback of cover.fallbacks) {
    const stand_in = pick(fallback);
    if (stand_in) return { employee: stand_in, covering: true };
  }
  return null;
}

/** Record that someone did a job — the rota depends on this being written. */
export async function creditWork(employeeId: string): Promise<void> {
  await employeeRef(employeeId)
    .set({ lastWorkedAtMs: Date.now(), piecesWorked: FieldValue.increment(1) }, { merge: true })
    .catch(() => undefined);
}

/**
 * What a team cannot do, in the admin's words rather than the code's.
 * Surfaced on the employees page and before a run, because "we made a carousel
 * with no pictures" should be predictable, not a surprise in the queue.
 */
export function coverageGaps(team: Employee[]): string[] {
  const held = new Set(team.map((e) => e.role));
  const gaps: string[] = [];

  if (!held.has('content-writer')) {
    gaps.push('No content writer — nothing can be written at all, so no piece can be made.');
  }
  if (!held.has('designer')) {
    gaps.push('No designer — carousels, posts and stories have no pictures, and videos open on a plain frame.');
  }
  if (!held.has('video-editor')) {
    gaps.push('No video editor — reels and videos will stop at the script.');
  }
  if (!held.has('social-manager')) {
    gaps.push('No social media manager — captions are not tailored per network and comments are not answered.');
  }
  if (!held.has('research-assistant')) {
    gaps.push('No research assistant — whoever writes will read the market themselves, less thoroughly.');
  }
  if (!held.has('seo-expert') && !held.has('google-seo-expert')) {
    gaps.push('Nobody on search — pieces will be findable only for as long as the feed shows them.');
  }
  if (!held.has('youtube-ads-expert')) {
    gaps.push('No YouTube ads expert — no campaign brief is written for the videos.');
  }
  return gaps;
}

// ── the persona ─────────────────────────────────────────────────────────────

/**
 * How an employee introduces themselves to the model.
 *
 * Their name and tenure are in the prompt on purpose. A model told "you are
 * Ayesha, senior copywriter, you have made 41 pieces here" writes with more
 * continuity than one told "you are a copywriter" — and when a human reads the
 * work log, the person who wrote a line is the same person they briefed.
 */
export function employeeIntro(employee: Employee): string {
  const tenureDays = Math.max(0, Math.floor((Date.now() - employee.hiredAtMs) / 86_400_000));
  const tenure =
    tenureDays < 1
      ? 'You started today.'
      : tenureDays < 30
        ? `You have been here ${tenureDays} day${tenureDays === 1 ? '' : 's'}.`
        : `You have been here ${Math.floor(tenureDays / 30)} month${tenureDays < 60 ? '' : 's'}.`;

  const record =
    employee.piecesWorked > 0
      ? ` You have worked on ${employee.piecesWorked} piece${employee.piecesWorked === 1 ? '' : 's'} for this brand, so you know the voice.`
      : '';

  return [
    `Your name is ${employee.name}. Your job title is ${employee.title}. ${tenure}${record}`,
    ROLE_SPECS[employee.role].charter,
    employee.instructions.trim() ? `Direction for you specifically:\n${employee.instructions.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ── callables ───────────────────────────────────────────────────────────────

const nameSchema = z.string().trim().min(1).max(60);

/** The roles you can hire for, and what each one would do. For the hire form. */
export const adminGetSocialRoles = onCall(async (req) => {
  requireAdmin(req);
  return {
    roles: ROLES.map((role) => ({
      role,
      label: ROLE_SPECS[role].label,
      blurb: ROLE_SPECS[role].blurb,
      stage: ROLE_SPECS[role].stage,
      titles: ROLE_SPECS[role].titles,
    })),
  };
});

export const adminHireSocialEmployee = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({
      name: nameSchema,
      role: z.enum(ROLES),
      title: z.string().trim().max(80).optional(),
      instructions: z.string().max(2000).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'A name and a role are required.');

  const existing = await listEmployees();
  if (existing.length >= 24) {
    throw new HttpsError('resource-exhausted', 'That is enough people for one desk.');
  }
  if (existing.some((e) => e.name.toLowerCase() === parsed.data.name.toLowerCase())) {
    // Two people called Ali on one team makes the work log unreadable, which is
    // the whole point of naming them.
    throw new HttpsError('already-exists', `Somebody on the team is already called ${parsed.data.name}.`);
  }

  const ref = db.collection(COLLECTION).doc();
  const employee: Employee = {
    id: ref.id,
    name: parsed.data.name,
    role: parsed.data.role,
    title: parsed.data.title?.trim() || ROLE_SPECS[parsed.data.role].titles[0],
    status: 'active',
    instructions: parsed.data.instructions ?? '',
    colour: COLOURS[existing.length % COLOURS.length],
    hiredAtMs: Date.now(),
    hiredBy: ctx.uid,
    lastWorkedAtMs: null,
    piecesWorked: 0,
  };
  await ref.set({ ...employee, hiredAt: FieldValue.serverTimestamp() });
  return { ok: true, employee };
});

export const adminUpdateSocialEmployee = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z
    .object({
      id: z.string().min(1).max(64),
      name: nameSchema.optional(),
      title: z.string().trim().max(80).optional(),
      instructions: z.string().max(2000).optional(),
      status: z.enum(['active', 'off_duty']).optional(),
      role: z.enum(ROLES).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const { id, ...changes } = parsed.data;
  const snap = await employeeRef(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Nobody by that id works here.');

  if (changes.name) {
    const clash = (await listEmployees()).find(
      (e) => e.id !== id && e.name.toLowerCase() === changes.name!.toLowerCase(),
    );
    if (clash) throw new HttpsError('already-exists', `Somebody on the team is already called ${changes.name}.`);
  }

  await employeeRef(id).set({ ...changes, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
});

/**
 * Let someone go. Their name stays on everything they made — the roster is who
 * works here now, not who ever did.
 */
export const adminFireSocialEmployee = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  await employeeRef(parsed.data.id).delete();
  return { ok: true };
});

/**
 * Hire one of each in a single press, with names you can change afterwards.
 *
 * Not a hidden default team — an empty desk stays empty until someone asks for
 * this. It exists because typing eight names before you can see the thing work
 * is a bad first five minutes.
 */
export const adminSeedSocialTeam = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const existing = await listEmployees();
  const held = new Set(existing.map((e) => e.role));

  const STARTERS: Record<Role, string> = {
    'research-assistant': 'Hina',
    'content-writer': 'Qalam',
    'seo-expert': 'Talha',
    'google-seo-expert': 'Zara',
    designer: 'Rang',
    'video-editor': 'Raftar',
    'youtube-ads-expert': 'Bilal',
    'social-manager': 'Awaaz',
  };

  const hired: Employee[] = [];
  const taken = new Set(existing.map((e) => e.name.toLowerCase()));

  for (const role of ROLES) {
    if (held.has(role)) continue;
    let name = STARTERS[role];
    let n = 2;
    while (taken.has(name.toLowerCase())) name = `${STARTERS[role]} ${n++}`;
    taken.add(name.toLowerCase());

    const ref = db.collection(COLLECTION).doc();
    const employee: Employee = {
      id: ref.id,
      name,
      role,
      title: ROLE_SPECS[role].titles[0],
      status: 'active',
      instructions: '',
      colour: COLOURS[(existing.length + hired.length) % COLOURS.length],
      hiredAtMs: Date.now() + hired.length, // keeps hiring order stable
      hiredBy: ctx.uid,
      lastWorkedAtMs: null,
      piecesWorked: 0,
    };
    await ref.set({ ...employee, hiredAt: FieldValue.serverTimestamp() });
    hired.push(employee);
  }

  return { ok: true, hired: hired.length };
});
