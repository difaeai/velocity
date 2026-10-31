/**
 * The camera half of the face scan, shared by both of the places that need it.
 *
 * A driver looks into the front camera and is asked, one at a time, to do the
 * things the server chose a moment ago — look straight, then turn their head
 * slightly one way and the other. Every picture is read on the phone as it is
 * taken (modules/velocity-face), so each pose is captured the moment it is
 * done, and until then the screen says what is missing: come closer, a little
 * further, the other way. There is no capture button, because a button is a
 * moment in which a phone can be pointed at a photograph instead of a face.
 *
 * Why this exists at all is in backend/functions/src/domain/faceScan.ts. The
 * short version: a selfie upload proves nothing — the cheapest fake driver
 * account in Pakistan is somebody else's CNIC plus their photo off Facebook —
 * and a head that turns on command, in an order nobody could have known, is the
 * cheapest thing to ask for that a photograph cannot do.
 *
 * TWO CALLERS, one mechanism and one screen:
 *   · the last step of an application (passenger/become-driver/face-scan), where
 *     the frames are compared with the CNIC and the licence just uploaded;
 *   · the daily check (driver/face-check-in), where they are compared with the
 *     face enrolled when the driver was approved.
 *
 * The caller supplies the words and decides what happens on a pass. Everything
 * about the camera, the reading, the uploads and the retry loop is here, so the
 * two never drift apart — and the poses, the scoring and the verdict all stay
 * on the server, where a patched build cannot reach them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Text } from './Text';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { uploadDriverDoc, type UploadResult } from '../lib/uploadDoc';
import { OnbButton, StepHeader, oc } from './onboarding';
import { themed } from '../theme';
import { detectFace } from '../../modules/velocity-face';
import {
  CHALLENGE_GLYPH,
  POSE_COUNTDOWN_SECONDS,
  type FaceChallenge,
  type FaceScanPurpose,
} from '../domain/faceScan';
import { FACE_MIN_WIDTH, JUDGED_ON_PHONE, NO_PROGRESS, judgeFrame } from '../domain/faceLiveness';
import { explainDenied } from '../lib/permissions';

type Phase = 'intro' | 'running' | 'uploading' | 'done' | 'error';

interface Pose {
  challenge: FaceChallenge;
  prompt: string;
}

/**
 * Android saves the sensor's full size by default — up to 50 MP on some front
 * cameras, seconds to write and megabytes to upload — and the server shrinks
 * every frame to 1600 px anyway. iOS's default preset is already 1080p.
 */
const PICTURE_SIZE = Platform.OS === 'android' ? '1600x1200' : undefined;

/** Failures in a row (camera or reader) before that part is given up on. */
const MAX_FAILURES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A picture that did not show the pose is never used; dozens of them in the cache help nobody. */
function discard(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    // Already gone. Nothing to do.
  }
}

export interface FaceScanResult {
  status: 'passed' | 'failed' | 'review';
  identity: 'match' | 'mismatch' | 'unclear';
  message: string;
  /** Onboarding only: the application has gone to the engine. */
  submitted?: boolean;
}

export interface FaceScanRunnerProps {
  purpose: FaceScanPurpose;
  /** Header, and the word used in every error. */
  title: string;
  introTitle: string;
  introText: string;
  /** The label on the button that starts it. */
  startLabel: string;
  doneTitle: string;
  doneText: string;
  /** Label of the button on the success screen. */
  doneLabel: string;
  onDone: (result: FaceScanResult) => void;
  /** An escape hatch out of a failure, when the caller can afford to offer one. */
  later?: { label: string; onPress: () => void };
}

export function FaceScanRunner(props: FaceScanRunnerProps) {
  const { user } = useAuth();
  const uid = user?.uid;
  const [permission, requestPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>('intro');
  const [scan, setScan] = useState<{ scanId: string; poses: Pose[] } | null>(null);
  const [step, setStep] = useState(0);
  /** What the driver still has to do for this pose, beyond the prompt itself. */
  const [hint, setHint] = useState<string | null>(null);
  const [faceSeen, setFaceSeen] = useState(false);
  /** Only when the phone cannot read the pose itself and falls back to a timer. */
  const [countdown, setCountdown] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [result, setResult] = useState<FaceScanResult | null>(null);

  const cameraRef = useRef<CameraView>(null);
  /**
   * Bumped by every start and by unmount; async work checks it is still the
   * run it began in. A late answer from an abandoned start used to reset a
   * camera that was already open, and the screen then sat on "Starting the
   * camera…" for good.
   */
  const runRef = useRef(0);

  useEffect(() => {
    // Wakes the function while the driver reads the intro; see warmFaceScan.
    api.warmFaceScan('startFaceScan').catch(() => {});
    return () => {
      runRef.current++;
    };
  }, []);

  const start = useCallback(async () => {
    setMessage(null);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        explainDenied('camera');
        setMessage(
          'Camera access is needed for the face check. Allow it in your phone settings and try again.',
        );
        setPhase('error');
        return;
      }
    }
    const run = ++runRef.current;
    setScan(null);
    setStep(0);
    setHint(null);
    setFaceSeen(false);
    setCountdown(null);
    setCameraReady(false);
    // The camera opens now, while the server picks the poses — not after.
    setPhase('running');
    api.warmFaceScan('submitFaceScan').catch(() => {});
    try {
      const res = await api.startFaceScan({ purpose: props.purpose });
      if (run !== runRef.current) return;
      setScan({ scanId: res.scanId, poses: res.challenges });
    } catch (e) {
      if (run !== runRef.current) return;
      setMessage(e instanceof Error ? e.message : 'Could not start the face check.');
      setPhase('error');
    }
  }, [permission?.granted, props.purpose, requestPermission]);

  const finish = useCallback(async (run: number, scanId: string, uploads: Promise<UploadResult>[]) => {
    setPhase('uploading');
    try {
      // Promise.all keeps the order, and the ORDER is what tells the server
      // which pose each frame answers — a reordering here would fail an
      // honest driver every time.
      const uploaded = await Promise.all(uploads);
      const verdict = await api.submitFaceScan({ scanId, framePaths: uploaded.map((u) => u.path) });
      if (run !== runRef.current) return;

      const outcome: FaceScanResult = {
        status: verdict.status,
        identity: verdict.identity,
        message: verdict.message,
        submitted: verdict.submitted,
      };
      setResult(outcome);
      setMessage(verdict.message);
      // `ok` and not `status`: a scan can pass the camera and still not settle
      // who it was, and only the server knows whether that is good enough for
      // what this scan was for. The app shows what it is told.
      setPhase(verdict.ok ? 'done' : 'error');
    } catch (e) {
      if (run !== runRef.current) return;
      setPhase('error');
      setMessage(e instanceof Error ? e.message : 'The face check could not be completed.');
    }
  }, []);

  // The scan: take a picture, read it, keep it if it shows the pose, otherwise
  // say what is missing and take the next one. Waits for the live preview — a
  // picture taken before onCameraReady comes back black.
  useEffect(() => {
    if (phase !== 'running' || !cameraReady || !scan || !uid) return;
    const run = runRef.current;
    let stopped = false;
    const live = () => !stopped && run === runRef.current;

    void (async () => {
      const uploads: Promise<UploadResult>[] = [];
      let progress = NO_PROGRESS;
      let failures = 0;
      let reader = detectFace;

      for (let i = 0; i < scan.poses.length; ) {
        const asked = scan.poses[i]!.challenge;
        const judge = JUDGED_ON_PHONE.has(asked) ? reader : null;
        if (!judge) {
          // No reader on this build, or a pose the phone cannot see: the old
          // way, a short countdown and the shutter regardless.
          for (let s = POSE_COUNTDOWN_SECONDS; s > 0; s--) {
            if (!live()) return;
            setCountdown(s);
            await sleep(1000);
          }
          setCountdown(null);
        }

        let uri: string | undefined;
        try {
          uri = (await cameraRef.current?.takePictureAsync({ quality: 0.7, shutterSound: false }))?.uri;
        } catch {
          uri = undefined;
        }
        if (!live()) return;
        if (!uri) {
          if (++failures < MAX_FAILURES) continue;
          setMessage('The camera could not take a picture.');
          setPhase('error');
          return;
        }

        if (judge) {
          const reading = await judge(uri).catch(() => null);
          if (!live()) return;
          // A face with no angle is a reader that cannot judge a turn, not a missing face.
          if (!reading || (reading.count > 0 && reading.yaw === undefined)) {
            discard(uri);
            // A reader that keeps failing is broken: finish on the timer rather than never.
            if (++failures >= MAX_FAILURES) reader = null;
            continue;
          }
          const verdict = judgeFrame(asked, reading, progress);
          setFaceSeen(reading.count === 1 && (reading.box?.width ?? 0) >= FACE_MIN_WIDTH);
          if (!verdict.ok) {
            discard(uri);
            setHint(verdict.hint);
            continue;
          }
          progress = verdict.progress;
        }

        failures = 0;
        // Uploaded while the next pose is being done, so the end of the scan
        // waits on one picture rather than all of them.
        const upload = uploadDriverDoc(uid, `facescan-${scan.scanId}-${i}`, uri);
        upload.catch(() => {}); // awaited in finish(); this only keeps an early failure from being reported as unhandled
        uploads.push(upload);
        i += 1;
        setStep(i);
        setHint(null);
      }
      if (live()) await finish(run, scan.scanId, uploads);
    })();

    return () => {
      stopped = true;
    };
  }, [phase, cameraReady, scan, uid, finish]);

  // ── Intro ─────────────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <StepHeader title={props.title} />
        <View style={styles.introBody}>
          <View style={styles.introIcon}>
            <Text style={styles.introIconText}>☺</Text>
          </View>
          <Text style={styles.introTitle}>{props.introTitle}</Text>
          <Text style={styles.introText}>{props.introText}</Text>
          <View style={styles.tips}>
            <Tip text="Find somewhere with even light — not with a window behind you" />
            <Tip text="Take off sunglasses, a cap, or anything covering your face" />
            <Tip text="Hold the phone at eye level and follow what the screen asks" />
            <Tip text="Be on your own in the picture" />
          </View>
          {message ? <Text style={styles.error}>{message}</Text> : null}
          <OnbButton label={props.startLabel} onPress={() => void start()} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Finished ──────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <StepHeader title={props.title} />
        <View style={styles.introBody}>
          <View style={[styles.introIcon, styles.introIconOk]}>
            <Text style={styles.introIconOkText}>✓</Text>
          </View>
          <Text style={styles.introTitle}>{props.doneTitle}</Text>
          <Text style={styles.introText}>{props.doneText}</Text>
          {/* What the comparison actually found, when it is not a plain match.
              Said here rather than buried: a driver whose face did not match
              their own documents is about to wait for a human, and being told
              that now is the difference between waiting and resubmitting four
              times. */}
          {result && result.identity !== 'match' ? (
            <Text style={styles.note}>{result.message}</Text>
          ) : null}
          <OnbButton label={props.doneLabel} onPress={() => props.onDone(result!)} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Failed ────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <StepHeader title={props.title} />
        <View style={styles.introBody}>
          <View style={[styles.introIcon, styles.introIconBad]}>
            <Text style={styles.introIconBadText}>!</Text>
          </View>
          <Text style={styles.introTitle}>That did not work</Text>
          <Text style={styles.introText}>{message ?? 'Please try the face check again.'}</Text>
          <OnbButton label="Try again" onPress={() => void start()} />
          {props.later ? (
            <Pressable onPress={props.later.onPress} hitSlop={10} style={styles.laterBtn}>
              <Text style={styles.laterText}>{props.later.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  // ── Uploading ─────────────────────────────────────────────────────────────
  if (phase === 'uploading') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <StepHeader title={props.title} />
        <View style={styles.introBody}>
          <ActivityIndicator size="large" color={oc.green} />
          <Text style={styles.introTitle}>Checking</Text>
          <Text style={styles.introText}>One moment — we are looking at your scan.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Running ───────────────────────────────────────────────────────────────
  const pose = scan?.poses[step];
  // The preview is a mirror, so a driver turning to their own right turns
  // towards the right of the screen: the arrows sit on the side they turn to.
  const turnSide =
    cameraReady && pose?.challenge === 'turn_right'
      ? 'right'
      : cameraReady && pose?.challenge === 'turn_left'
        ? 'left'
        : null;
  return (
    <View style={styles.cameraWrap}>
      {/* No `mirror`: the saved frame is compared with the CNIC photo, which is
          not mirrored either. The preview mirrors on its own. */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="front"
        animateShutter={false}
        pictureSize={PICTURE_SIZE}
        onCameraReady={() => setCameraReady(true)}
      />
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.progressRow}>
          {(scan?.poses ?? []).map((_, i) => (
            <View key={i} style={[styles.progressPip, i < step && styles.progressPipOn]} />
          ))}
        </View>

        <View style={[styles.oval, faceSeen && styles.ovalSeen]} pointerEvents="none">
          {turnSide ? <TurnArrows key={turnSide} side={turnSide} /> : null}
        </View>

        <View style={styles.promptCard}>
          {scan && pose && cameraReady ? (
            <>
              <Text style={styles.promptGlyph}>{CHALLENGE_GLYPH[pose.challenge]}</Text>
              <Text style={styles.promptText}>{pose.prompt}</Text>
              <Text style={styles.promptHint} accessibilityLiveRegion="polite">
                {countdown ?? hint ?? ' '}
              </Text>
              <Text style={styles.promptStep}>
                Step {step + 1} of {scan.poses.length}
              </Text>
            </>
          ) : (
            <>
              <ActivityIndicator color="#fff" />
              <Text style={styles.promptText}>{cameraReady ? 'Getting ready…' : 'Starting the camera…'}</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

/** Each chevron's brightness over one sweep, innermost first, so they light up outwards. */
const ARROW_DIM = 0.25;
const ARROW_SWEEP = [
  { inputRange: [0, 0.25, 0.5, 1], outputRange: [ARROW_DIM, 1, ARROW_DIM, ARROW_DIM] },
  { inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [ARROW_DIM, ARROW_DIM, 1, ARROW_DIM, ARROW_DIM] },
  { inputRange: [0, 0.5, 0.75, 1], outputRange: [ARROW_DIM, ARROW_DIM, 1, ARROW_DIM] },
];

/**
 * Three chevrons beside the oval, lighting up one after another towards the
 * side to turn to — the instruction for a driver who cannot read the prompt.
 * Drawn for the right and mirrored for the left.
 */
function TurnArrows({ side }: { side: 'left' | 'right' }) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  return (
    <View
      style={[styles.arrows, side === 'left' ? styles.arrowsLeft : styles.arrowsRight]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {ARROW_SWEEP.map((range, i) => (
        <Animated.View key={i} style={{ opacity: sweep.interpolate(range) }}>
          <Svg width={14} height={28} viewBox="0 0 14 28">
            {/* A dark edge under the green, so the arrow reads on any background. */}
            <Path d="M3 3 L11 14 L3 25" stroke="rgba(0,0,0,0.5)" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M3 3 L11 14 L3 25" stroke={oc.green} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <View style={styles.tipRow}>
      <Text style={styles.tipDot}>•</Text>
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  introBody: { flex: 1, padding: 24, gap: 16, alignItems: 'center', justifyContent: 'center' },
  introIcon: {
    width: 86, height: 86, borderRadius: 43, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: oc.green,
  },
  introIconText: { fontSize: 40, color: oc.green },
  introIconOk: { backgroundColor: oc.green, borderColor: oc.green },
  introIconOkText: { fontSize: 42, color: '#fff', fontWeight: '900' },
  introIconBad: { backgroundColor: '#fdecea', borderColor: '#e74c3c' },
  introIconBadText: { fontSize: 42, color: '#c0392b', fontWeight: '900' },
  introTitle: { fontSize: 22, fontWeight: '900', color: oc.text, textAlign: 'center' },
  introText: { fontSize: 15, color: oc.sub, textAlign: 'center', lineHeight: 22 },
  note: {
    alignSelf: 'stretch', backgroundColor: oc.note, borderColor: '#f5d384', borderWidth: 1,
    borderRadius: 12, padding: 14, color: oc.noteText, fontWeight: '700', fontSize: 14,
    lineHeight: 20, textAlign: 'center',
  },
  tips: { alignSelf: 'stretch', gap: 10, backgroundColor: oc.card, borderRadius: 16, padding: 16 },
  tipRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  tipDot: { color: oc.green, fontSize: 16, fontWeight: '900', lineHeight: 20 },
  tipText: { flex: 1, color: oc.text, fontSize: 14, lineHeight: 20 },
  error: { color: '#c0392b', fontWeight: '600', fontSize: 14, textAlign: 'center' },
  laterBtn: { paddingVertical: 10 },
  laterText: { color: oc.sub, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },

  cameraWrap: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 18 },
  progressRow: { flexDirection: 'row', gap: 8 },
  progressPip: { width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressPipOn: { backgroundColor: oc.green },
  // A guide, not a crop: the frame is captured whole and the oval only tells the
  // driver where to put their face. Green once the phone can see them.
  oval: {
    width: 250, height: 330, borderRadius: 165,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)',
  },
  ovalSeen: { borderColor: oc.green },
  // Just outside the oval's edge, level with the eyes' middle; 42 wide so a
  // 360-wide screen still fits oval and arrows.
  arrows: { position: 'absolute', top: '50%', marginTop: -14, flexDirection: 'row' },
  arrowsRight: { left: '100%', marginLeft: 6 },
  arrowsLeft: { right: '100%', marginRight: 6, transform: [{ scaleX: -1 }] },
  promptCard: {
    alignSelf: 'stretch', marginHorizontal: 20, padding: 18, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', gap: 6,
  },
  promptGlyph: { color: oc.green, fontSize: 34, fontWeight: '900', lineHeight: 38 },
  promptText: { color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  promptHint: { color: '#ffd166', fontSize: 17, fontWeight: '800', textAlign: 'center', minHeight: 24 },
  promptStep: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
}));
