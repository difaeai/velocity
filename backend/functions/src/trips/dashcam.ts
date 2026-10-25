/**
 * The ride dash cam — what becomes of the video once the driver's phone has
 * recorded it.
 *
 * The recording is the phone's job (apps/mobile/src/ui/DashCam.tsx): the front
 * camera, facing the cabin, for as long as the ride runs, cut into two-minute
 * clips that upload as they finish, to
 *
 *     dashcam/{driverUid}/{tripId}/{startedAtMs}.mp4
 *
 * Three things here decide what happens to them:
 *
 *   · getDashcamClips    who may watch, and which clips each of them sees;
 *   · checkDashcamCabin  "I can't see any passenger": counts the faces in a
 *                        clip, so the phone can warn a driver whose camera is
 *                        pointed at the roof, the road or the inside of a door;
 *   · sweepDashcamClips  deletes every clip a day after its ride ended.
 *
 * THERE IS NO FIRESTORE DOCUMENT, on purpose. The bucket is the index: a clip's
 * name carries its trip and its start time, and the trip document already says
 * who was in the car and when the ride ended. A document per clip would be a
 * second copy of both, written by the driver's phone, and so one a patched
 * phone could lie in.
 *
 * Nobody reads a clip through the storage rules; they refuse every read. The
 * links handed out here carry the object's own download token and die with the
 * object, at the 24-hour mark.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, storage } from '../lib/firebase';
import { docId, invalid, requireAuth, requireRole } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { countFaces } from '../lib/localVision';
import { escapeArg, fontDir } from '../social/reel';
import {
  clipInWindow,
  clipStartedAt,
  dashcamExpiresAt,
  viewerWindow,
  type DashcamParties,
} from '../domain/dashcam';

type Bucket = ReturnType<typeof storage.bucket>;
type ClipFile = ReturnType<Bucket['file']>;

const execFileAsync = promisify(execFile);

/** Who may watch, read off the trip document. */
function partiesOf(trip: FirebaseFirestore.DocumentSnapshot): DashcamParties {
  type Stamp = { toMillis?: () => number } | null | undefined;
  type Seat = { uid?: unknown; kind?: unknown; joinedAt?: Stamp; boardedAt?: Stamp; droppedAt?: Stamp };
  const millis = (t: Stamp) => (typeof t?.toMillis === 'function' ? t.toMillis() : null);
  // `poolRiders` first: when a car has both, that is the array a drop-off is
  // written to (see trips/dropOff).
  const seats = [
    ...((trip.get('poolRiders') as Seat[] | undefined) ?? []),
    ...((trip.get('poolRoster') as Seat[] | undefined) ?? []),
  ];
  return {
    driverId: (trip.get('driverId') as string | null | undefined) ?? null,
    passengerId: (trip.get('passengerId') as string | null | undefined) ?? null,
    poolMembers: (trip.get('poolMembers') as string[] | undefined) ?? [],
    seats: seats
      .filter((s): s is Seat & { uid: string } => typeof s.uid === 'string')
      .map((s) => ({
        uid: s.uid,
        kind: typeof s.kind === 'string' ? s.kind : undefined,
        joinedAtMs: millis(s.joinedAt),
        boardedAtMs: millis(s.boardedAt),
        droppedAtMs: millis(s.droppedAt),
      })),
    noShows: (trip.get('poolNoShows') as string[] | undefined) ?? [],
  };
}

function completedAtOf(trip: FirebaseFirestore.DocumentSnapshot): number | null {
  const at = trip.get('completedAt') as { toMillis?: () => number } | undefined;
  return typeof at?.toMillis === 'function' ? at.toMillis() : null;
}

/**
 * A link that plays the clip, using the download token every Firebase upload
 * carries. Minted here for the rare object without one, so a clip is never
 * unwatchable for want of a token.
 */
async function playableUrl(bucket: Bucket, file: ClipFile): Promise<string> {
  let token = String(file.metadata.metadata?.firebaseStorageDownloadTokens ?? '').split(',')[0];
  if (!token) {
    token = randomUUID();
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`;
}

const tripSchema = z.object({ tripId: docId });

/**
 * The clips of one ride that the caller may watch, oldest first.
 *
 * Answers while the ride is still running too: clips appear as the driver's
 * phone uploads them, a couple of minutes behind the road.
 */
export const getDashcamClips = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = tripSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const { tripId } = parsed.data;

  await rateLimit(ctx.uid, 'getDashcamClips', 60, 600);

  const trip = await db.doc(`trips/${tripId}`).get();
  // One answer for "no such ride" and "not your ride", so the second cannot be
  // used to discover the first.
  const nothing = new HttpsError('not-found', 'There is no dash cam video for you on this ride.');
  if (!trip.exists) throw nothing;
  const parties = partiesOf(trip);
  const window = viewerWindow(parties, ctx.uid);
  if (!window || !parties.driverId) throw nothing;

  const bucket = storage.bucket();
  const [files] = await bucket.getFiles({ prefix: `dashcam/${parties.driverId}/${tripId}/` });
  const clips = files
    .map((file) => ({ file, startedAt: clipStartedAt(file.name) }))
    .filter((c): c is { file: ClipFile; startedAt: number } => c.startedAt !== null)
    .sort((a, b) => a.startedAt - b.startedAt);

  const live = trip.get('status') === 'in_progress';
  const expiresAt = dashcamExpiresAt(completedAtOf(trip), clips.at(-1)?.startedAt ?? null);
  // The sweep runs hourly; the promise is 24 hours, so the cut-off is enforced
  // here rather than left to whenever the sweep gets round to it.
  if (!live && expiresAt !== null && Date.now() >= expiresAt) {
    return { ok: true, live, expired: true, expiresAt, clips: [] };
  }

  const visible = clips.filter((c) => clipInWindow(c.startedAt, window));
  return {
    ok: true,
    live,
    expired: false,
    expiresAt: live ? null : expiresAt,
    clips: await Promise.all(
      visible.map(async (c) => ({
        startedAt: c.startedAt,
        url: await playableUrl(bucket, c.file),
        sizeBytes: Number(c.file.metadata.size ?? 0),
      })),
    ),
  };
});

/** The ffmpeg binary, required lazily: an 80 MB package nothing else on a cold start needs. */
function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const resolved = require('ffmpeg-static') as string | { default?: string } | null;
  const bin = typeof resolved === 'string' ? resolved : resolved?.default;
  if (!bin) throw new Error('ffmpeg is not available in this runtime.');
  return bin;
}

/**
 * The most faces seen in any of three frames from the start of a clip.
 *
 * Three frames, not one: a passenger turning to the window, or the car going
 * under a bridge, hides a face for a moment and must not read as an empty car.
 * The first second is skipped, because a recording opens on frames the camera
 * has not finished exposing.
 */
async function facesInClip(objectPath: string): Promise<number | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-dashcam-'));
  try {
    const clip = path.join(dir, 'clip.mp4');
    await storage.bucket().file(objectPath).download({ destination: clip });
    await execFileAsync(
      ffmpegPath(),
      ['-v', 'error', '-ss', '1', '-i', clip, '-vf', 'fps=0.4,scale=640:-2', '-frames:v', '3', '-q:v', '4',
        path.join(dir, 'frame-%d.jpg')],
      { timeout: 30_000 },
    );
    const frames = (await readdir(dir)).filter((f) => f.endsWith('.jpg'));
    let most: number | null = null;
    for (const frame of frames) {
      const faces = await countFaces(await readFile(path.join(dir, frame)));
      if (faces !== null) most = Math.max(most ?? 0, faces);
    }
    return most;
  } catch (e) {
    logger.warn('Dash cam: could not look inside a clip', { objectPath, e });
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const cabinSchema = z.object({
  tripId: docId,
  clip: z.string().regex(/^\d{13}\.mp4$/),
});

/**
 * Can the dash cam see anybody in the car?
 *
 * The phone asks this about the short clip it records the moment a ride
 * starts, and again about later clips while the answer stays no. `faces` is
 * null when the clip could not be read: the phone stays quiet then rather than
 * tell a driver with a full car that it is empty.
 *
 * Nothing is kept: the frames live in a temp directory for the second it takes
 * to count them.
 */
export const checkDashcamCabin = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = cabinSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and clip.');
  const { tripId, clip } = parsed.data;

  await rateLimit(ctx.uid, 'checkDashcamCabin', 6, 600);

  const trip = await db.doc(`trips/${tripId}`).get();
  if (!trip.exists || trip.get('driverId') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Not your trip.');
  }

  const faces = await facesInClip(`dashcam/${ctx.uid}/${tripId}/${clip}`);
  logger.info('Dash cam cabin check', { tripId, faces });
  return { ok: true, faces };
});

/** "25 Oct 2026, 10:42 pm" in Pakistan time — what a police station reads. */
function pktStamp(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(ms);
}

/**
 * The ffmpeg filter that stamps a clip as Velocity's: a heading across the top,
 * and the words tiled small and see-through on a diagonal over the whole frame,
 * so the picture stays clear but no crop of it comes away unmarked.
 */
export function proofFilter(paths: { tile: string; heading: string; sub: string }): string {
  const bold = escapeArg(path.join(fontDir(), 'Outfit-Black.ttf'));
  const body = escapeArg(path.join(fontDir(), 'WorkSans-SemiBold.ttf'));
  return (
    // A transparent sheet larger than any frame, tiled with the words, turned.
    'color=c=black@0:s=2000x2000:r=2,format=rgba,' +
    `drawtext=fontfile='${bold}':textfile='${escapeArg(paths.tile)}':fontsize=22:fontcolor=white@0.28:` +
    'borderw=1:bordercolor=black@0.14:line_spacing=62:x=0:y=0,' +
    // Negative is anticlockwise in ffmpeg: the words rise left to right.
    'rotate=a=-0.45:c=none:ow=iw:oh=ih[wm];' +
    '[0:v][wm]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,' +
    'drawbox=x=0:y=0:w=iw:h=54:color=black@0.5:t=fill,' +
    `drawtext=fontfile='${bold}':textfile='${escapeArg(paths.heading)}':fontsize=20:fontcolor=white:x=(w-text_w)/2:y=9,` +
    `drawtext=fontfile='${body}':textfile='${escapeArg(paths.sub)}':fontsize=13:fontcolor=white@0.85:x=(w-text_w)/2:y=34[out]`
  );
}

/** The tiled words; odd rows offset so the pattern reads as brickwork, not stripes. */
const PROOF_TILE = Array.from({ length: 26 }, (_, i) =>
  (i % 2 ? ' '.repeat(16) : '') + 'VELOCITY RIDES TRAVEL PROOF      '.repeat(8),
).join('\n');

/** Burn the watermark into one clip and store the copy next to it. */
async function burnProof(source: ClipFile, dest: ClipFile, startedAt: number, tripId: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-proof-'));
  try {
    const input = path.join(dir, 'clip.mp4');
    const output = path.join(dir, 'proof.mp4');
    const texts = { tile: path.join(dir, 'tile.txt'), heading: path.join(dir, 'heading.txt'), sub: path.join(dir, 'sub.txt') };
    // Text files, not inline text: a clock's colons would need escaping twice over.
    await Promise.all([
      source.download({ destination: input }),
      writeFile(texts.tile, PROOF_TILE),
      writeFile(texts.heading, 'VELOCITY RIDES · TRAVEL PROOF'),
      writeFile(texts.sub, `${pktStamp(startedAt)} PKT · Ride ${tripId.slice(0, 8).toUpperCase()}`),
    ]);
    await execFileAsync(
      ffmpegPath(),
      ['-v', 'error', '-i', input, '-filter_complex', proofFilter(texts), '-map', '[out]', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'copy', '-movflags', '+faststart', output],
      { timeout: 240_000 },
    );
    await dest.save(await readFile(output), {
      contentType: 'video/mp4',
      metadata: {
        // A download, not a page: the browser saves the file as proof.
        contentDisposition: `attachment; filename="velocity-travel-proof-${startedAt}.mp4"`,
        metadata: { firebaseStorageDownloadTokens: randomUUID() },
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A clip to keep, with Velocity's watermark burned in — the copy a rider saves
 * as proof. Made once per clip and kept beside it (`{startedAt}-proof.mp4`, a
 * name getDashcamClips does not list), so it goes with the ride at 24 hours.
 * Who may have it is exactly who may watch the clip.
 */
export const getDashcamProof = onCall({ timeoutSeconds: 300, memory: '2GiB', cpu: 2 }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = cabinSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and clip.');
  const { tripId, clip } = parsed.data;

  await rateLimit(ctx.uid, 'getDashcamProof', 30, 3600);

  const trip = await db.doc(`trips/${tripId}`).get();
  const nothing = new HttpsError('not-found', 'There is no dash cam video for you on this ride.');
  if (!trip.exists) throw nothing;
  const parties = partiesOf(trip);
  const window = viewerWindow(parties, ctx.uid);
  const startedAt = clipStartedAt(clip);
  if (!window || !parties.driverId || startedAt === null || !clipInWindow(startedAt, window)) throw nothing;
  const expiresAt = dashcamExpiresAt(completedAtOf(trip), startedAt);
  if (trip.get('status') !== 'in_progress' && expiresAt !== null && Date.now() >= expiresAt) {
    throw new HttpsError('not-found', 'This ride\'s video was deleted 24 hours after the ride ended.');
  }

  const bucket = storage.bucket();
  const folder = `dashcam/${parties.driverId}/${tripId}`;
  const source = bucket.file(`${folder}/${clip}`);
  const proof = bucket.file(`${folder}/${startedAt}-proof.mp4`);
  const [made] = await proof.exists();
  if (!made) {
    const [recorded] = await source.exists();
    if (!recorded) throw nothing;
    await burnProof(source, proof, startedAt, tripId);
  }
  await proof.getMetadata();
  logger.info('Dash cam proof handed out', { tripId, clip, freshlyBurned: !made });
  return { ok: true, url: await playableUrl(bucket, proof) };
});

/** Rides looked at per run. Each costs one trip read; the rest wait an hour. */
const SWEEP_RIDES = 400;

/**
 * Delete every ride's video a day after the ride ended.
 *
 * Hourly, so a clip outlives its promise by an hour at most — and nobody can
 * watch it in that hour, because getDashcamClips refuses at the 24-hour mark
 * itself. A clip filed under a ride its uploader did not drive was never
 * watchable by anybody, and goes on the first pass.
 */
export const sweepDashcamClips = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Asia/Karachi', timeoutSeconds: 540 },
  async () => {
    const [files] = await storage.bucket().getFiles({ prefix: 'dashcam/' });

    const rides = new Map<string, { driverId: string; tripId: string; files: ClipFile[]; newest: number }>();
    for (const file of files) {
      const [, driverId, tripId] = file.name.split('/');
      if (!driverId || !tripId) continue;
      const key = `${driverId}/${tripId}`;
      const ride = rides.get(key) ?? { driverId, tripId, files: [], newest: 0 };
      ride.files.push(file);
      ride.newest = Math.max(ride.newest, clipStartedAt(file.name) ?? 0);
      rides.set(key, ride);
    }

    // Oldest first, so the rides that are due are always inside the cap.
    const due = [...rides.values()].sort((a, b) => a.newest - b.newest).slice(0, SWEEP_RIDES);
    let deleted = 0;
    for (const ride of due) {
      const trip = await db.doc(`trips/${ride.tripId}`).get();
      const theirs = trip.exists && trip.get('driverId') === ride.driverId;
      const expiresAt = dashcamExpiresAt(theirs ? completedAtOf(trip) : null, ride.newest || null);
      if (theirs && expiresAt !== null && Date.now() < expiresAt) continue;
      await Promise.all(ride.files.map((f) => f.delete({ ignoreNotFound: true })));
      deleted += ride.files.length;
    }

    if (deleted > 0) logger.info('Dash cam: deleted expired clips', { deleted, rides: rides.size });
  },
);
