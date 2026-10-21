/**
 * The ride dash cam's memory: everything about a ride's recording that has to
 * outlive the screen showing it.
 *
 * The camera lives in src/ui/DashCam.tsx, and that component comes and goes far
 * more often than a ride does: a theme or language switch remounts every
 * screen, the Safety Centre replaces the trip screen, a phone call sends the app
 * to the background. So the parts that must survive all of that are here, at
 * module scope:
 *
 *   · the upload queue — finished clips waiting for a signal, persisted, so a
 *     clip recorded in a dead zone still goes up once the app is next open;
 *   · each ride's state — whether "ride started" has been said and what the
 *     cabin check found, so a remount neither repeats nor forgets them.
 *
 * Where the clips go and who may watch them is the backend's business: see
 * backend/functions/src/trips/dashcam.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Camera } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';

import { api } from '../api/client';
import { t } from '../i18n';
import { speak } from '../voice/speech';
import { DASHCAM_KEEP_MS, clipSeconds, shouldCheckCabin, type CabinView } from '../domain/dashcam';
import { uploadDashcamClip } from './uploadDoc';

/**
 * H.264 at 480p. Enough to tell faces and hands apart in a car; about 300 MB an
 * hour with sound, on the driver's own data — which is why it is not more.
 */
export const VIDEO_BITRATE = 600_000;

export const RIDE_STARTED_LINE = 'Ride started. The dash cam is recording.';
export const NO_PASSENGER_LINE =
  "I can't see any passenger. Please put your phone in a holder in the middle of the car, facing the seats.";

/** Smaller than this, the camera never really wrote anything — not worth a driver's data. */
const MIN_CLIP_BYTES = 16 * 1024;

/** A cabin check describes where the phone is now; older than this, it describes nothing. */
const CHECK_FRESH_MS = 5 * 60 * 1000;

const QUEUE_KEY = 'velocity.dashcam.queue.v1';

export interface DashcamClip {
  uid: string;
  tripId: string;
  /** By the phone's clock. Becomes the clip's name, which is how the backend orders and filters clips. */
  startedAt: number;
  uri: string;
}

interface RideState {
  announced: boolean;
  clipsStarted: number;
  checksSent: number;
  cabin: CabinView;
}

const rides = new Map<string, RideState>();

export function rideState(tripId: string): RideState {
  let ride = rides.get(tripId);
  if (!ride) {
    ride = { announced: false, clipsStarted: 0, checksSent: 0, cabin: 'unknown' };
    rides.set(tripId, ride);
  }
  return ride;
}

// ── Change notifications, for the box on screen ─────────────────────────────

let version = 0;
const listeners = new Set<() => void>();

export function subscribeDashcam(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getDashcamVersion(): number {
  return version;
}

function changed(): void {
  version += 1;
  listeners.forEach((l) => l());
}

// ── The ride ─────────────────────────────────────────────────────────────────

/** "Ride started", said once a ride however often the camera remounts. */
export function announceRideStart(tripId: string): void {
  const ride = rideState(tripId);
  if (ride.announced) return;
  ride.announced = true;
  void speak(t(RIDE_STARTED_LINE));
}

/** How long the next clip of this ride runs. Counts it as started. */
export function startClip(tripId: string): number {
  const ride = rideState(tripId);
  const seconds = clipSeconds(ride.clipsStarted);
  ride.clipsStarted += 1;
  return seconds;
}

/**
 * "I can't see any passenger", asked about a clip that has just gone up.
 *
 * Decided when the clip is up rather than when it starts: by then an earlier
 * answer may already have said somebody is there.
 */
async function checkCabin(clip: DashcamClip): Promise<void> {
  const ride = rideState(clip.tripId);
  // Only about a ride this phone is recording now. A clip left over from a dead
  // zone, or from before the app restarted, can go up in the middle of the
  // NEXT ride, and a warning about a car that has already emptied would be
  // said to a driver with a full one.
  if (ride.clipsStarted === 0 || Date.now() - clip.startedAt > CHECK_FRESH_MS) return;
  if (!shouldCheckCabin(ride.cabin, ride.checksSent)) return;
  ride.checksSent += 1;
  try {
    const { faces } = await api.checkDashcamCabin({ tripId: clip.tripId, clip: `${clip.startedAt}.mp4` });
    // Unreadable: saying nothing beats telling a driver with a full car it is empty.
    if (faces === null) return;
    ride.cabin = faces > 0 ? 'seen' : 'not_seen';
    changed();
    if (faces === 0) void speak(t(NO_PASSENGER_LINE));
  } catch {
    // A check that fails says nothing.
  }
}

// ── The upload queue ─────────────────────────────────────────────────────────

let queue: DashcamClip[] = [];
let queueLoaded: Promise<void> | null = null;

function loadQueue(): Promise<void> {
  queueLoaded ??= AsyncStorage.getItem(QUEUE_KEY)
    .then((raw) => {
      const saved: unknown = raw ? JSON.parse(raw) : [];
      // Anything recorded before the saved list arrived goes up after it.
      if (Array.isArray(saved)) queue = [...(saved as DashcamClip[]), ...queue];
    })
    .catch(() => {});
  return queueLoaded;
}

function saveQueue(): void {
  AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => {});
}

/** Clips recorded and not yet uploaded, so a driver in a dead zone can see it. */
export function clipsWaiting(): number {
  return queue.length;
}

export async function enqueueClip(clip: DashcamClip): Promise<void> {
  await loadQueue();
  queue.push(clip);
  saveQueue();
  changed();
  void drainDashcamQueue();
}

let draining: Promise<void> | null = null;

/** Upload whatever is waiting, oldest first. Safe to call any time; one run at a time. */
export function drainDashcamQueue(): Promise<void> {
  draining ??= drain().finally(() => {
    draining = null;
  });
  return draining;
}

async function drain(): Promise<void> {
  await loadQueue();
  while (queue.length > 0) {
    const clip = queue[0]!;
    const file = new File(clip.uri);
    // A clip that could not go up within a day is past its own deletion date.
    const worth =
      Date.now() - clip.startedAt < DASHCAM_KEEP_MS && file.exists && file.size >= MIN_CLIP_BYTES;
    if (worth) {
      try {
        await uploadDashcamClip(clip.uid, clip.tripId, clip.startedAt, clip.uri);
      } catch (e) {
        // The path is write-once, so "unauthorized" means the clip is already
        // there (a retry of an upload that landed) or will never be accepted.
        // Anything else is the network: stop, and the next clip tries again.
        if ((e as { code?: string } | null)?.code !== 'storage/unauthorized') return;
      }
    }
    queue.shift();
    saveQueue();
    try {
      if (file.exists) file.delete();
    } catch {
      // It is in the cache; the OS clears that in the end.
    }
    changed();
    if (worth) void checkCabin(clip);
  }
}

/**
 * Pick up a clip whose recording was cut off by its screen going away.
 *
 * iOS rejects a recording's promise the moment its camera view unmounts, before
 * the file is finished, so the clip that was running when the driver opened the
 * Safety Centre — or when the ride ended — would never reach the queue. The file
 * itself is fine, in the camera's cache folder, and is found by when it was
 * created. Android finishes the file and resolves as normal, so there this
 * finds nothing to do.
 */
export async function adoptCutOffClip(clip: Omit<DashcamClip, 'uri'>): Promise<void> {
  // Give the camera a moment to finish the file it was writing.
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const dir = new Directory(Paths.cache, 'Camera');
    if (!dir.exists) return;
    await loadQueue();
    const known = new Set(queue.map((c) => c.uri));
    const cutOff = dir
      .list()
      .find(
        (f): f is File =>
          f instanceof File &&
          /\.(mp4|mov)$/i.test(f.uri) &&
          !known.has(f.uri) &&
          Math.abs((f.creationTime ?? f.lastModified ?? 0) - clip.startedAt) < 10_000,
      );
    if (cutOff) await enqueueClip({ uid: clip.uid, tripId: clip.tripId, startedAt: clip.startedAt, uri: cutOff.uri });
  } catch {
    // Nothing to recover.
  }
}

/**
 * The camera, and the microphone if they will give it. Asked when the driver
 * taps Start trip: that is when the camera is needed, and when the reason is
 * plain. Sound is asked for and never required — a silent recording is still a
 * recording.
 *
 * A phone whose camera module will not even answer is not stopped from driving:
 * the box on the trip screen says the camera is not working, and the ride goes
 * on. Only a driver who says no is held at the start.
 */
export async function ensureDashcamPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const camera = await Camera.requestCameraPermissionsAsync();
    if (camera.granted) await Camera.requestMicrophonePermissionsAsync().catch(() => null);
    return camera.granted;
  } catch {
    return true;
  }
}
