/**
 * The camera half of the face scan, shared by both of the places that need it.
 *
 * A driver looks into the front camera and is asked, one at a time, to do the
 * things the server chose a moment ago — turn left, smile, look up. Each pose
 * gets a short countdown and then the shutter fires on its own: there is no
 * capture button, because a button is a moment in which a phone can be pointed
 * at a photograph instead of a face.
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
 * about the camera, the countdown, the uploads and the retry loop is here, so
 * the two never drift apart — and the poses, the scoring and the verdict all
 * stay on the server, where a patched build cannot reach them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from './Text';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { uploadDriverDoc } from '../lib/uploadDoc';
import { OnbButton, StepHeader, oc } from './onboarding';
import { themed } from '../theme';
import {
  CHALLENGE_GLYPH,
  POSE_COUNTDOWN_SECONDS,
  type FaceChallenge,
  type FaceScanPurpose,
} from '../domain/faceScan';

type Phase = 'intro' | 'running' | 'uploading' | 'done' | 'error';

interface Pose {
  challenge: FaceChallenge;
  prompt: string;
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
  const [permission, requestPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>('intro');
  const [poses, setPoses] = useState<Pose[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [countdown, setCountdown] = useState(POSE_COUNTDOWN_SECONDS);
  const [message, setMessage] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [result, setResult] = useState<FaceScanResult | null>(null);

  const cameraRef = useRef<CameraView>(null);
  const shotsRef = useRef<string[]>([]);
  /** Guards against the countdown firing a second shutter for the same pose. */
  const capturingRef = useRef(false);
  /** Set on unmount so a capture that lands late never calls setState. */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    setMessage(null);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setMessage(
          'Camera access is needed for the face check. Allow it in your phone settings and try again.',
        );
        setPhase('error');
        return;
      }
    }
    try {
      const scan = await api.startFaceScan({ purpose: props.purpose });
      shotsRef.current = [];
      capturingRef.current = false;
      setScanId(scan.scanId);
      setPoses(scan.challenges);
      setStep(0);
      setCountdown(POSE_COUNTDOWN_SECONDS);
      setCameraReady(false);
      setPhase('running');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not start the face check.');
      setPhase('error');
    }
  }, [permission?.granted, props.purpose, requestPermission]);

  const finish = useCallback(
    async (frames: string[]) => {
      if (!user || !scanId) return;
      setPhase('uploading');
      try {
        // Uploaded in parallel, but the ORDER of the result array is what tells
        // the server which pose each frame answers — Promise.all preserves it,
        // and a reordering here would fail an honest driver every time.
        const uploaded = await Promise.all(
          frames.map((uri, i) => uploadDriverDoc(user.uid, `facescan-${scanId}-${i}`, uri)),
        );
        const verdict = await api.submitFaceScan({
          scanId,
          framePaths: uploaded.map((u) => u.path),
        });
        if (!aliveRef.current) return;

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
        if (!aliveRef.current) return;
        setPhase('error');
        setMessage(e instanceof Error ? e.message : 'The face check could not be completed.');
      }
    },
    [scanId, user],
  );

  const capture = useCallback(async () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    try {
      const shot = await cameraRef.current?.takePictureAsync({
        quality: 0.7,
        // The orientation fix-up is worth the milliseconds: a frame that
        // arrives rotated reads as "not facing the camera" and fails a pose
        // the driver actually performed.
        skipProcessing: false,
        shutterSound: false,
      });
      if (!shot?.uri) throw new Error('The camera did not return a picture.');
      shotsRef.current = [...shotsRef.current, shot.uri];

      if (!aliveRef.current) return;
      if (shotsRef.current.length >= poses.length) {
        await finish(shotsRef.current);
      } else {
        setStep((s) => s + 1);
        setCountdown(POSE_COUNTDOWN_SECONDS);
        capturingRef.current = false;
      }
    } catch (e) {
      if (!aliveRef.current) return;
      setPhase('error');
      setMessage(e instanceof Error ? e.message : 'The camera could not take a picture.');
      capturingRef.current = false;
    }
  }, [finish, poses.length]);

  // The countdown. Only runs once the preview is actually live — firing the
  // shutter before onCameraReady returns a black frame, which reads as "no face
  // visible" and fails the scan for no reason the driver can see.
  useEffect(() => {
    if (phase !== 'running' || !cameraReady) return;
    if (countdown <= 0) {
      void capture();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, cameraReady, countdown, capture]);

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
  const pose = poses[step];
  return (
    <View style={styles.cameraWrap}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="front"
        mirror
        onCameraReady={() => setCameraReady(true)}
      />
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.progressRow}>
          {poses.map((_, i) => (
            <View key={i} style={[styles.progressPip, i <= step && styles.progressPipOn]} />
          ))}
        </View>

        <View style={styles.oval} pointerEvents="none" />

        <View style={styles.promptCard}>
          {pose ? (
            <>
              <Text style={styles.promptGlyph}>{CHALLENGE_GLYPH[pose.challenge]}</Text>
              <Text style={styles.promptText}>{pose.prompt}</Text>
              <Text style={styles.promptCount}>
                {cameraReady ? (countdown > 0 ? countdown : '📸') : 'Starting the camera…'}
              </Text>
            </>
          ) : (
            <ActivityIndicator color="#fff" />
          )}
          <Text style={styles.promptStep}>
            Step {Math.min(step + 1, poses.length)} of {poses.length}
          </Text>
        </View>
      </SafeAreaView>
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
  // driver where to put their face.
  oval: {
    width: 250, height: 330, borderRadius: 165,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)',
  },
  promptCard: {
    alignSelf: 'stretch', marginHorizontal: 20, padding: 18, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', gap: 6,
  },
  promptGlyph: { color: oc.green, fontSize: 34, fontWeight: '900', lineHeight: 38 },
  promptText: { color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  promptCount: { color: '#fff', fontSize: 26, fontWeight: '900' },
  promptStep: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
}));
