/**
 * An in-app voice call between a rider and their driver — free, over the internet.
 *
 * The phones talk WebRTC to each other; Firestore is only the switchboard. The
 * caller puts an offer on the call document, the callee puts an answer, and from
 * then on the audio goes phone to phone and never touches a server. Each side
 * gathers its network candidates BEFORE writing (no trickle ICE): about a second
 * more on answering, in exchange for no candidate sub-collections and no rules
 * to guard them.
 *
 * One screen for both sides: `/call/new?...` places a call, `/call/{id}` is one
 * somebody placed — ringing, live, or already over (a notification tapped late
 * lands on "Missed call" with a way to ring back).
 *
 * The call lives as long as this screen, so the hardware Back key is held while
 * it is up — the red button is the way out. Leaving the APP is fine on Android:
 * a microphone foreground service (modules/velocity-calls) keeps the call going
 * through Google Maps or a dark screen, and a call that comes in while the phone
 * is locked rings full-screen and opens this screen over the lock screen.
 *
 * shortcut: iPhone is still foreground-only — that needs CallKit + VoIP push.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStream,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

import { callSystem } from '../../modules/velocity-calls';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { db } from '../../src/firebase';
import { openCalls } from '../../src/lib/inAppCall';
import { themed } from '../../src/theme';
import { Text } from '../../src/ui/Text';

type Status = 'ringing' | 'active' | 'declined' | 'cancelled' | 'missed' | 'ended';
type Sdp = { type: 'offer' | 'answer'; sdp: string };

interface CallDoc {
  id: string;
  callerId: string;
  calleeId: string;
  driverId: string | null;
  callerName: string;
  calleeName: string;
  rideKind: 'trip' | 'poolRide';
  rideId: string;
  status: Status;
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  offer: Sdp | null;
  answer: Sdp | null;
}

type Phase = 'starting' | 'loading' | 'ringing' | 'incoming' | 'connecting' | 'live' | 'over';

/** How long the caller rings before it counts as no answer. */
const RING_MS = 45_000;
/** Candidates arrive in well under a second; a slow relay must not hold the call up. */
const GATHER_MS = 2500;

function overText(status: Status, iAmCaller: boolean): string {
  if (status === 'declined') return iAmCaller ? 'Call declined' : 'Call ended';
  if (status === 'cancelled') return iAmCaller ? 'Call cancelled' : 'Missed call';
  if (status === 'missed') return iAmCaller ? 'No answer' : 'Missed call';
  return 'Call ended';
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Resolve when ICE gathering finishes, or after GATHER_MS with whatever was found. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      pc.onicegatheringstatechange = null;
      resolve();
    };
    const timer = setTimeout(finish, GATHER_MS);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
  });
}

export default function CallRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // A second screen for a call one is already showing — a notification tapped
  // while it rings — steps straight back out instead of answering it twice.
  const [duplicate] = useState(() => id !== 'new' && openCalls.has(id));
  useEffect(() => {
    if (duplicate) router.back();
  }, [duplicate, router]);
  return duplicate ? null : <CallScreen />;
}

function CallScreen() {
  useKeepAwake();
  const router = useRouter();
  const p = useLocalSearchParams<{
    id: string;
    rideKind?: string;
    rideId?: string;
    calleeId?: string;
    name?: string;
    phone?: string;
    /** "1" when Answer was pressed on the ringing notification. */
    answer?: string;
  }>();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const placing = p.id === 'new';

  const [callId, setCallId] = useState<string | null>(placing ? null : p.id);
  const [call, setCall] = useState<CallDoc | null>(null);
  const [phase, setPhase] = useState<Phase>(placing ? 'starting' : 'loading');
  const [over, setOver] = useState('');
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const latest = useRef<CallDoc | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const done = useRef(false);
  const offered = useRef(false);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  /** Close this side: network, microphone and every sound. */
  const finish = useCallback((text: string) => {
    if (done.current) return;
    done.current = true;
    pc.current?.close();
    pc.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    InCallManager.stopRingtone();
    InCallManager.stopRingback();
    InCallManager.stop();
    callSystem.stopOngoing();
    if (latest.current) callSystem.dismissIncoming(latest.current.id);
    setOver(text);
    setPhase('over');
  }, []);

  /** Tell the other phone (best effort), then close this side. */
  const endCall = useCallback(
    (text?: string, timedOut = false) => {
      const c = latest.current;
      if (!c || !callId || done.current) {
        finish(text ?? 'Call ended');
        return;
      }
      const iAmCaller = c.callerId === uid;
      const status: Status =
        c.status === 'active' ? 'ended' : !iAmCaller ? 'declined' : timedOut ? 'missed' : 'cancelled';
      updateDoc(doc(db, 'calls', callId), { status, endedAt: serverTimestamp() }).catch(() => {});
      finish(text ?? overText(status, iAmCaller));
    },
    [callId, uid, finish],
  );
  const endRef = useRef(endCall);
  endRef.current = endCall;

  function peer(c: CallDoc): RTCPeerConnection {
    const conn = new RTCPeerConnection({ iceServers: c.iceServers });
    pc.current = conn;
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'connected') {
        InCallManager.stopRingback();
        setPhase('live');
      } else if (conn.connectionState === 'failed') {
        endRef.current("Couldn't connect");
      }
    };
    return conn;
  }

  async function addMic(conn: RTCPeerConnection) {
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    mic.current = stream;
    stream.getTracks().forEach((t) => conn.addTrack(t, stream));
    // Only now: Android refuses a microphone service before the permission exists.
    const c = latest.current;
    const name = c ? (c.callerId === uid ? c.calleeName : c.callerName) : 'Velocity Rides';
    callSystem.startOngoing(`On a call with ${name}`, 'Tap to return to the call');
  }

  function micError(e: unknown): string {
    return /permission|denied|allowed/i.test(String((e as Error)?.message ?? e))
      ? 'Allow the microphone in Settings to make calls'
      : "Couldn't connect";
  }

  async function placeOffer(c: CallDoc, id: string) {
    try {
      const conn = peer(c);
      await addMic(conn);
      await conn.setLocalDescription(await conn.createOffer({}));
      await gathered(conn);
      if (done.current || !conn.localDescription) return;
      await updateDoc(doc(db, 'calls', id), {
        offer: { type: 'offer', sdp: conn.localDescription.sdp },
      });
    } catch (e) {
      endRef.current(micError(e));
    }
  }

  async function accept() {
    InCallManager.stopRingtone();
    setPhase('connecting');
    try {
      // The caller may still be gathering when this is tapped.
      let c = latest.current;
      for (let i = 0; i < 50 && !c?.offer; i++) {
        await new Promise((r) => setTimeout(r, 200));
        c = latest.current;
      }
      if (!c?.offer || !callId) throw new Error('no offer');
      InCallManager.start({ media: 'audio' });
      const conn = peer(c);
      await conn.setRemoteDescription(new RTCSessionDescription(c.offer));
      await addMic(conn);
      await conn.setLocalDescription(await conn.createAnswer());
      await gathered(conn);
      if (done.current || !conn.localDescription) return;
      await updateDoc(doc(db, 'calls', callId), {
        answer: { type: 'answer', sdp: conn.localDescription.sdp },
        status: 'active',
        answeredAt: serverTimestamp(),
      });
    } catch (e) {
      endRef.current(micError(e));
    }
  }

  // Place the call.
  useEffect(() => {
    if (!placing) return;
    if (!p.rideId || (p.rideKind !== 'trip' && p.rideKind !== 'poolRide')) {
      finish("Couldn't start the call");
      return;
    }
    InCallManager.start({ media: 'audio', ringback: '_DTMF_' });
    api
      .startCall({ rideKind: p.rideKind, rideId: p.rideId, calleeId: p.calleeId || undefined })
      .then(({ callId: id }) => {
        // Hung up while it was still being placed: stop the other phone ringing.
        if (done.current) {
          updateDoc(doc(db, 'calls', id), { status: 'cancelled', endedAt: serverTimestamp() }).catch(() => {});
          return;
        }
        setCallId(id);
        setPhase('ringing');
      })
      // Not on this ride, or the other person is busy on another call — the
      // server's words say which, so show them rather than a vague failure.
      .catch((e: { code?: string; message?: string }) =>
        finish(
          (e?.code === 'functions/permission-denied' || e?.code === 'functions/failed-precondition') && e.message
            ? e.message
            : "Couldn't start the call",
        ),
      );
    // Runs once: the screen IS this one call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Over the lock screen while this screen is up — a call can arrive on a locked phone.
  useEffect(() => {
    callSystem.showOverLockScreen(true);
    return () => {
      callSystem.showOverLockScreen(false);
    };
  }, []);

  // Follow the call document.
  useEffect(() => {
    if (!callId) return;
    openCalls.add(callId);
    // This screen rings from here on; silence the notification that brought it up.
    callSystem.dismissIncoming(callId);
    const unsub = onSnapshot(
      doc(db, 'calls', callId),
      (snap) => {
        const c = snap.data() as CallDoc | undefined;
        if (!c) return;
        if (!latest.current) setSpeaker(c.driverId === uid); // drivers: phone is in a mount
        latest.current = c;
        setCall(c);
      },
      () => finish('This call is not available'),
    );
    return () => {
      unsub();
      openCalls.delete(callId);
    };
  }, [callId, uid, finish]);

  // Move through the call as the document changes.
  useEffect(() => {
    if (!call || !callId || done.current) return;
    const iAmCaller = call.callerId === uid;
    if (call.status !== 'ringing' && call.status !== 'active') {
      finish(overText(call.status, iAmCaller));
    } else if (phase === 'loading') {
      // Opened from a notification. A ringing call rings; anything else is a
      // call this phone is not actually carrying any more — close it properly.
      if (!iAmCaller && call.status === 'ringing') {
        if (p.answer === '1') {
          // Answer was already pressed on the ringing notification.
          void accept();
        } else {
          setPhase('incoming');
          InCallManager.startRingtone('_DEFAULT_', 0, 'playback', 45);
        }
      } else {
        endCall();
      }
    } else if (iAmCaller) {
      if (!offered.current) {
        offered.current = true;
        void placeOffer(call, callId);
      }
      if (call.answer && pc.current && !pc.current.remoteDescription) {
        setPhase('connecting');
        pc.current
          .setRemoteDescription(new RTCSessionDescription(call.answer))
          .catch(() => endRef.current("Couldn't connect"));
      }
    }
    // placeOffer reads refs only; re-running on its identity would re-offer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, callId, phase, uid, finish, endCall]);

  // Ring out. The caller's timeout is the real one and tells the other phone;
  // the callee's only cleans up after a caller whose app died mid-ring.
  useEffect(() => {
    if (phase === 'ringing') {
      const t = setTimeout(() => endRef.current(undefined, true), RING_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'incoming') {
      const t = setTimeout(() => finish('Missed call'), RING_MS + 15_000);
      return () => clearTimeout(t);
    }
  }, [phase, finish]);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'over' || phase === 'incoming' || phase === 'loading') return;
    InCallManager.setForceSpeakerphoneOn(speaker);
  }, [speaker, phase]);

  useEffect(() => {
    mic.current?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }, [muted, phase]);

  useEffect(() => {
    if (phase === 'over') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [phase]);

  // Leaving the screen any other way still hangs up.
  useEffect(() => () => endRef.current(), []);

  const iAmCaller = call ? call.callerId === uid : placing;
  const otherName = call ? (iAmCaller ? call.calleeName : call.callerName) : p.name || 'Calling';
  const otherRole = call ? (call.driverId === uid ? 'Your passenger' : 'Your driver') : '';
  const fallbackPhone = p.phone && over !== 'Call ended' ? p.phone : '';
  const canCallBack = !!call && !iAmCaller && over === 'Missed call';

  // Nothing left to offer: close by itself.
  useEffect(() => {
    if (phase !== 'over' || fallbackPhone || canCallBack) return;
    const t = setTimeout(leave, 1800);
    return () => clearTimeout(t);
  }, [phase, fallbackPhone, canCallBack, leave]);

  const statusLine =
    phase === 'starting'
      ? 'Calling…'
      : phase === 'loading' || phase === 'connecting'
        ? 'Connecting…'
        : phase === 'ringing'
          ? 'Ringing…'
          : phase === 'incoming'
            ? 'Incoming call'
            : phase === 'live'
              ? clock(seconds)
              : over;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Text style={styles.free}>FREE CALL · OVER THE INTERNET</Text>
        <View style={styles.avatar}>
          <Text style={styles.avatarTxt}>{otherName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.name} accessibilityRole="header">
          {otherName}
        </Text>
        {otherRole ? <Text style={styles.role}>{otherRole}</Text> : null}
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {statusLine}
        </Text>
      </View>

      {phase === 'incoming' ? (
        <View style={styles.row}>
          <RoundButton label="Decline" icon="✕" tone="danger" onPress={() => endCall()} />
          <RoundButton label="Accept" icon="📞" tone="accept" onPress={() => void accept()} />
        </View>
      ) : phase === 'over' ? (
        <View style={styles.overBox}>
          {fallbackPhone ? (
            <Pressable
              style={styles.wideBtn}
              accessibilityRole="button"
              onPress={() => Linking.openURL(`tel:${fallbackPhone}`).catch(() => {})}
            >
              <Text style={styles.wideBtnTxt}>Call their phone number instead</Text>
            </Pressable>
          ) : null}
          {canCallBack && call ? (
            <Pressable
              style={styles.wideBtn}
              accessibilityRole="button"
              onPress={() =>
                router.replace({
                  pathname: '/call/[id]',
                  params: {
                    id: 'new',
                    rideKind: call.rideKind,
                    rideId: call.rideId,
                    calleeId: call.callerId,
                    name: call.callerName,
                  },
                })
              }
            >
              <Text style={styles.wideBtnTxt}>Call back</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.closeBtn} accessibilityRole="button" onPress={leave}>
            <Text style={styles.closeTxt}>Close</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          <RoundButton
            label={muted ? 'Unmute' : 'Mute'}
            icon={muted ? '🔇' : '🎙️'}
            active={muted}
            onPress={() => setMuted((m) => !m)}
          />
          <RoundButton label="End call" icon="✕" tone="danger" onPress={() => endCall()} />
          <RoundButton
            label={speaker ? 'Speaker on' : 'Speaker'}
            icon="🔊"
            active={speaker}
            onPress={() => setSpeaker((s) => !s)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

function RoundButton({
  label,
  icon,
  tone,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  tone?: 'danger' | 'accept';
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.btnWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active }}
        style={({ pressed }) => [
          styles.round,
          tone === 'danger' && styles.roundDanger,
          tone === 'accept' && styles.roundAccept,
          active && styles.roundActive,
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={styles.roundIcon}>{icon}</Text>
      </Pressable>
      <Text style={styles.btnLabel}>{label}</Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between' },
    top: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
    free: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: colors.primary, marginBottom: 28 },
    avatar: {
      width: 112,
      height: 112,
      borderRadius: 56,
      backgroundColor: colors.glassStrong,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 18,
    },
    avatarTxt: { fontSize: 44, fontWeight: '900', color: colors.text },
    name: { fontSize: 28, fontWeight: '900', color: colors.text, textAlign: 'center' },
    role: { fontSize: 14, color: colors.muted, marginTop: 4 },
    status: { fontSize: 16, color: colors.text, marginTop: 18, fontVariant: ['tabular-nums'] },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      alignItems: 'flex-start',
      paddingHorizontal: 16,
      paddingBottom: 40,
    },
    btnWrap: { alignItems: 'center', width: 96 },
    round: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: colors.glassChip,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    roundDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
    roundAccept: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
    roundActive: { backgroundColor: colors.primary + '33', borderColor: colors.primary },
    roundIcon: { fontSize: 26, color: '#ffffff' },
    btnLabel: { fontSize: 12.5, color: colors.muted, marginTop: 8, textAlign: 'center' },
    overBox: { paddingHorizontal: 24, paddingBottom: 32, gap: 10 },
    wideBtn: {
      backgroundColor: colors.btnBg,
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: 'center',
    },
    wideBtnTxt: { fontSize: 15, fontWeight: '900', color: colors.btnText },
    closeBtn: { paddingVertical: 14, alignItems: 'center' },
    closeTxt: { fontSize: 15, fontWeight: '800', color: colors.muted },
  }),
);
