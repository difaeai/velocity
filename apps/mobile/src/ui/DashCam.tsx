/**
 * The dash cam box: the camera, live on the driver's screen, recording the ride.
 *
 * Mounted for as long as a ride is running: on the trip screen below the map
 * and the drop-off list, so the driver still sees where everybody is going, and
 * in the Safety Centre if the driver opens it mid-ride, so an emergency is never
 * the moment the recording stops. It is the FRONT camera — the one facing the
 * cabin when the phone sits in a holder in the middle of the dashboard —
 * because what a recording has to settle is what happened between the people
 * inside the car.
 *
 * The recording runs in two-minute clips that upload as they finish (the queue
 * is src/lib/dashcam.ts; who may watch them is the backend's trips/dashcam.ts).
 * A clip is the unit of loss: a crash, a flat battery or a phone thrown out of
 * a window costs the clip in progress, not the ride.
 *
 * What it cannot do, and says so: record while another app is in front.
 * Neither Android nor iOS lets an app use the camera from the background, so
 * the box asks the driver to keep the app open, the screen is held awake, and a
 * notice goes up the moment they leave.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';

import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';
import { t } from '../i18n';
import { dismissLocalNotice, showLocalNotice } from '../lib/notifications';
import {
  NO_PASSENGER_LINE,
  VIDEO_BITRATE,
  adoptCutOffClip,
  announceRideStart,
  clipsWaiting,
  drainDashcamQueue,
  enqueueClip,
  getDashcamVersion,
  rideState,
  startClip,
  subscribeDashcam,
} from '../lib/dashcam';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Recordings in a row that came back empty before the camera is torn down and built again. */
const REBUILD_AFTER_FAILURES = 3;

export function DashCam({ tripId, uid }: { tripId: string; uid: string }) {
  // A screen that locks sends the app to the background, and the camera with it.
  useKeepAwake('dashcam');
  // Re-render when a clip is queued or uploaded, or the cabin check answers.
  useSyncExternalStore(subscribeDashcam, getDashcamVersion, getDashcamVersion);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  // Bumped to throw the native camera away and build a fresh one.
  const [generation, setGeneration] = useState(0);
  const [mountError, setMountError] = useState<string | null>(null);

  // Clips left over from a dead zone, or from a ride the app was closed during.
  useEffect(() => {
    void drainDashcamQueue();
  }, []);

  // Say so the moment the driver leaves: the usual reason is Google Maps, which
  // keeps talking them through the turns from the background, so coming back
  // here costs them nothing.
  useEffect(() => {
    let notice: string | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !notice) {
        void showLocalNotice(
          t('Dash cam paused'),
          t('Come back to Velocity Rides to keep recording this ride. Google Maps keeps guiding you.'),
        ).then((id) => {
          notice = id;
        });
      } else if (state === 'active' && notice) {
        dismissLocalNotice(notice);
        notice = null;
      }
    });
    return () => {
      sub.remove();
      if (notice) dismissLocalNotice(notice);
    };
  }, []);

  // The recording itself: clip after clip for as long as this box is mounted.
  useEffect(() => {
    const camera = cameraRef.current;
    if (!ready || !camera) return;
    let alive = true;

    void (async () => {
      announceRideStart(tripId);
      let failures = 0;
      while (alive) {
        // In the background the camera is off; there is nothing to record.
        if (AppState.currentState !== 'active') {
          await sleep(1000);
          continue;
        }
        const seconds = startClip(tripId);
        const clip = { uid, tripId, startedAt: Date.now() };
        let saved = false;
        const finished = camera
          .recordAsync({ maxDuration: seconds, ...(Platform.OS === 'ios' ? { codec: 'avc1' as const } : {}) })
          .then((res) => {
            if (!res?.uri) return;
            saved = true;
            return enqueueClip({ ...clip, uri: res.uri });
          })
          .catch(() => adoptCutOffClip(clip));
        // A recording that never settles must not hold the camera for the rest of the ride.
        const settled = await Promise.race([
          finished.then(() => true),
          sleep((seconds + 20) * 1000).then(() => false),
        ]);
        if (!alive) break;
        if (!settled) camera.stopRecording();

        if (saved && Date.now() - clip.startedAt > 2000) {
          failures = 0;
          continue;
        }
        failures += 1;
        if (failures >= REBUILD_AFTER_FAILURES) {
          // A camera that keeps handing back nothing is usually one that lost
          // its session to another screen's camera; a fresh one fixes that.
          setReady(false);
          setGeneration((g) => g + 1);
          return;
        }
        await sleep(2000);
      }
    })();

    return () => {
      alive = false;
    };
  }, [ready, tripId, uid]);

  const ride = rideState(tripId);
  const waiting = clipsWaiting();
  const allowed = cameraPermission?.granted === true;
  const recording = allowed && ready && !mountError;

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <View style={[styles.dot, recording && styles.dotLive]} />
        <Text style={styles.title}>{recording ? 'Dash cam recording' : 'Dash cam starting…'}</Text>
        {waiting > 0 ? (
          <Text style={styles.waiting}>
            {waiting} {waiting === 1 ? 'clip' : 'clips'} to upload
          </Text>
        ) : null}
      </View>

      {cameraPermission && !allowed ? (
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>The dash cam needs the camera to record this ride.</Text>
          <Pressable style={styles.retry} onPress={() => void requestCameraPermission()}>
            <Text style={styles.retryText}>Allow the camera</Text>
          </Pressable>
        </View>
      ) : allowed ? (
        <CameraView
          key={generation}
          ref={cameraRef}
          style={styles.preview}
          facing="front"
          mode="video"
          videoQuality="480p"
          videoBitrate={VIDEO_BITRATE}
          // Sound only with the driver's say-so; Android refuses to record at all otherwise.
          mute={micPermission?.granted !== true}
          animateShutter={false}
          onCameraReady={() => {
            setMountError(null);
            setReady(true);
          }}
          onMountError={(e) => {
            setReady(false);
            setMountError(e.message);
          }}
        />
      ) : null}

      {mountError ? (
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>The camera did not start. {mountError}</Text>
          <Pressable
            style={styles.retry}
            onPress={() => {
              setMountError(null);
              setGeneration((g) => g + 1);
            }}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {ride.cabin === 'not_seen' ? <Text style={styles.warn}>⚠️ {NO_PASSENGER_LINE}</Text> : null}

      <Text style={styles.note}>
        Recorded for everyone&apos;s safety. You and your passengers can watch this ride for 24 hours
        after it ends. Keep Velocity Rides open — the dash cam pauses while another app is in front.
      </Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    box: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 12,
      marginTop: 12,
      gap: 10,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.muted },
    dotLive: { backgroundColor: colors.danger },
    title: { color: colors.text, fontSize: 14, fontWeight: '800', flex: 1 },
    waiting: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
    preview: { height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
    blocked: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 8,
      alignItems: 'flex-start',
    },
    blockedText: { color: colors.text, fontSize: 13 },
    retry: {
      backgroundColor: `${colors.primary}18`,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    retryText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
    warn: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18,
    },
    note: { color: colors.muted, fontSize: 11.5, lineHeight: 16 },
  }),
);
