/**
 * Call the Velocity Rides helpline — an AI voice that answers in Urdu or English,
 * hears the caller out, and stops talking the moment they start.
 *
 * The server briefs the session (driver or passenger, their own account) and
 * hands back a one-use token, so this screen is only the telephone. Beyond the
 * plumbing it has two jobs:
 *
 *   echo      The agent's voice leaves the loudspeaker and goes straight back
 *             into the microphone. Without echo cancellation the agent hears
 *             itself, decides it was interrupted and stops mid-word, over and
 *             over. The two-way audio module records through the phone's own
 *             voice-call echo canceller for exactly this reason.
 *   barge-in  The model stops the moment the caller speaks, but audio it had
 *             already sent is still on the phone. So playback is fed only
 *             LEAD_MS ahead of real time from a queue here, and "interrupted"
 *             empties the queue — the agent falls silent within a third of a
 *             second instead of finishing its sentence over the caller.
 *
 * shortcut: one Live connection, so a call ends at the server's ~10 minute
 * limit; add session resumption on `goAway` if real calls run that long.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import {
  addExpoTwoWayAudioEventListener,
  initialize,
  playPCMData,
  requestMicrophonePermissionsAsync,
  tearDown,
  toggleRecording,
} from '@speechmatics/expo-two-way-audio';

import { callSystem } from '../../modules/velocity-calls';
import { api } from '../../src/api/client';
import { colors } from '../../src/config';
import {
  PCM16K_BYTES_PER_MS,
  base64ToBytes,
  bytesToBase64,
  bytesToSamples,
  createResampler,
  decodeUtf8,
  samplesToBytes,
} from '../../src/lib/pcm';
import { themed } from '../../src/theme';
import { Text } from '../../src/ui/Text';
import { explainDenied } from '../../src/lib/permissions';

const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
/** How far ahead of real time the agent's audio is handed to the speaker — the most that plays on after an interruption. */
const LEAD_MS = 300;
/** Queue slices of 100 ms, so one long chunk from the model cannot blow the lead. */
const SLICE_BYTES = 100 * PCM16K_BYTES_PER_MS;

type Line = { who: 'caller' | 'agent'; text: string };
type Phase = 'starting' | 'connecting' | 'listening' | 'speaking' | 'over';

interface LiveMessage {
  setupComplete?: object;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    interrupted?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: { id: string; name: string; args?: Record<string, unknown> }[] };
}

export default function HelplineCall() {
  useKeepAwake();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('starting');
  const [role, setRole] = useState<'driver' | 'passenger' | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [muted, setMuted] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [over, setOver] = useState<{ text: string; writeInstead: boolean } | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const callId = useRef<string | null>(null);
  const transcript = useRef<Line[]>([]);
  const queue = useRef<Uint8Array[]>([]);
  const playedUntil = useRef(0);
  const mutedRef = useRef(false);
  const live = useRef(false);
  const done = useRef(false);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resample = useRef(createResampler(24000, 16000)).current;

  /** The transcript in the shape the server accepts. */
  const record = () =>
    transcript.current.slice(-400).map((l) => ({ who: l.who, text: l.text.slice(0, 2000) }));

  const end = useCallback((text = 'Call ended', writeInstead = false, error?: string) => {
    if (done.current) return;
    done.current = true;
    if (limit.current) clearTimeout(limit.current);
    try {
      toggleRecording(false);
      tearDown();
    } catch {
      // Audio never started.
    }
    ws.current?.close();
    ws.current = null;
    queue.current = [];
    callSystem.stopOngoing();
    if (callId.current) {
      api.logHelplineCall({ callId: callId.current, transcript: record(), ended: true, error }).catch(() => {});
    }
    setOver({ text, writeInstead });
    setPhase('over');
  }, []);

  function addText(who: Line['who'], text: string) {
    const t = transcript.current;
    const last = t[t.length - 1];
    if (last?.who === who) last.text += text;
    else t.push({ who, text });
    setLines(t.slice(-6).map((l) => ({ ...l })));
  }

  function enqueue(b64: string) {
    const pcm = samplesToBytes(resample(bytesToSamples(base64ToBytes(b64))));
    for (let i = 0; i < pcm.length; i += SLICE_BYTES) queue.current.push(pcm.slice(i, i + SLICE_BYTES));
  }

  // Every tool runs on the server, which checks it against the ride's own record.
  async function runTool(fc: { id: string; name: string; args?: Record<string, unknown> }) {
    let result =
      'That did not go through on our side. Say sorry, and that they can write to us under Help & complaints in the app.';
    if (callId.current) {
      try {
        const res = await api.helplineAction({
          callId: callId.current,
          name: fc.name,
          args: fc.args ?? {},
          transcript: record(),
        });
        result = res.result;
        if (fc.name === 'register_complaint') setRegistered(true);
      } catch {
        // `result` already says what to tell the caller.
      }
    }
    ws.current?.send(
      JSON.stringify({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: { result } }] } }),
    );
  }

  function onMessage(data: unknown) {
    let msg: LiveMessage;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : decodeUtf8(new Uint8Array(data as ArrayBuffer)));
    } catch {
      return;
    }
    if (msg.setupComplete) {
      live.current = true;
      toggleRecording(true);
      // The agent speaks first; its instructions say what to do with this.
      ws.current?.send(JSON.stringify({ realtimeInput: { text: '[call connected]' } }));
      setPhase('listening');
    }
    const sc = msg.serverContent;
    if (sc?.interrupted) {
      queue.current = [];
      playedUntil.current = Date.now();
    }
    for (const part of sc?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) enqueue(part.inlineData.data);
    }
    if (sc?.inputTranscription?.text) addText('caller', sc.inputTranscription.text);
    if (sc?.outputTranscription?.text) addText('agent', sc.outputTranscription.text);
    for (const fc of msg.toolCall?.functionCalls ?? []) void runTool(fc);
  }

  // Dial.
  useEffect(() => {
    (async () => {
      const perm = await requestMicrophonePermissionsAsync();
      if (!perm.granted) {
        explainDenied('microphone');
        end('The helpline needs your microphone — turn it on in Settings, or write to us instead.');
        return;
      }
      const res = await api.startHelplineCall({ actions: true });
      if (done.current) return;
      if (!res.available) {
        end('The helpline cannot take calls right now.', true);
        return;
      }
      api.warmHelpline().catch(() => {});
      callId.current = res.callId;
      setRole(res.role);
      setPhase('connecting');
      if (!(await initialize())) {
        end("Couldn't start the phone's audio.", true);
        return;
      }
      // Keeps the microphone if the caller leaves the app mid-call (Android).
      callSystem.startOngoing('Velocity Rides helpline', 'Tap to return to the call');
      limit.current = setTimeout(
        () => end('That is the longest one call can be. Call again, or write to us.', true),
        res.maxSeconds * 1000,
      );

      const socket = new WebSocket(`${LIVE_URL}?access_token=${res.token}`);
      socket.binaryType = 'arraybuffer';
      ws.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ setup: { model: `models/${res.model}` } }));
      socket.onmessage = (ev) => onMessage(ev.data);
      socket.onclose = (ev) => {
        if (done.current) return;
        if (live.current) end();
        else end('The helpline is busy right now.', true, `${ev.code} ${ev.reason ?? ''}`.slice(0, 300));
      };
    })().catch(() => end('The helpline cannot take calls right now.', true));

    const mic = addExpoTwoWayAudioEventListener('onMicrophoneData', (e) => {
      const socket = ws.current;
      if (mutedRef.current || !live.current || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          realtimeInput: { audio: { data: bytesToBase64(e.data), mimeType: 'audio/pcm;rate=16000' } },
        }),
      );
    });

    // Feed the speaker a little ahead of real time; see LEAD_MS.
    const pump = setInterval(() => {
      const now = Date.now();
      while (queue.current.length > 0 && playedUntil.current - now < LEAD_MS) {
        const slice = queue.current.shift()!;
        playPCMData(slice);
        playedUntil.current = Math.max(playedUntil.current, now) + slice.length / PCM16K_BYTES_PER_MS;
      }
      if (live.current && !done.current) setPhase(playedUntil.current > now ? 'speaking' : 'listening');
    }, 60);

    return () => {
      mic.remove();
      clearInterval(pump);
      end();
    };
    // Runs once: the screen IS this one call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (phase === 'over') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [phase]);

  const title = role === 'driver' ? 'Driver helpline' : role === 'passenger' ? 'Passenger helpline' : 'Helpline';
  const statusText =
    phase === 'starting' || phase === 'connecting'
      ? 'Connecting…'
      : phase === 'speaking'
        ? 'Speaking…'
        : phase === 'listening'
          ? muted
            ? 'You are muted'
            : 'Listening…'
          : over?.text ?? '';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Velocity Rides {title}
        </Text>
        <Text style={styles.headerSub}>AI assistant · sorts it out on the call</Text>
      </View>

      <View style={styles.middle}>
        <View
          style={[styles.orb, phase === 'speaking' && styles.orbSpeaking, phase === 'over' && styles.orbOver]}
        >
          <Text style={styles.orbIcon}>{phase === 'over' ? '☎️' : '🎧'}</Text>
        </View>
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {statusText}
        </Text>
        {registered ? (
          <Text style={styles.handed}>Your complaint is registered. See it under Help & complaints.</Text>
        ) : null}
        <View style={styles.transcript}>
          {lines.map((l, i) => (
            <Text key={i} style={l.who === 'caller' ? styles.lineCaller : styles.lineAgent} numberOfLines={3}>
              {l.who === 'caller' ? 'You: ' : ''}
              {l.text.trim()}
            </Text>
          ))}
        </View>
      </View>

      {phase === 'over' ? (
        <View style={styles.overBox}>
          {over?.writeInstead ? (
            <Pressable
              style={styles.wideBtn}
              accessibilityRole="button"
              onPress={() => router.replace('/support/new')}
            >
              <Text style={styles.wideBtnTxt}>Write to us instead</Text>
            </Pressable>
          ) : null}
          {registered ? (
            <Pressable style={styles.wideBtn} accessibilityRole="button" onPress={() => router.replace('/support')}>
              <Text style={styles.wideBtnTxt}>See my complaints</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.closeBtn} accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.closeTxt}>Close</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.btnWrap}>
            <Pressable
              style={[styles.round, muted && styles.roundActive]}
              accessibilityRole="button"
              accessibilityLabel={muted ? 'Unmute' : 'Mute'}
              accessibilityState={{ selected: muted }}
              onPress={() => setMuted((m) => !m)}
            >
              <Text style={styles.roundIcon}>{muted ? '🔇' : '🎙️'}</Text>
            </Pressable>
            <Text style={styles.btnLabel}>{muted ? 'Unmute' : 'Mute'}</Text>
          </View>
          <View style={styles.btnWrap}>
            <Pressable
              style={[styles.round, styles.roundDanger]}
              accessibilityRole="button"
              accessibilityLabel="End call"
              onPress={() => end()}
            >
              <Text style={styles.roundIcon}>✕</Text>
            </Pressable>
            <Text style={styles.btnLabel}>End call</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between' },
    header: { alignItems: 'center', paddingTop: 28, paddingHorizontal: 24 },
    headerTitle: { fontSize: 18, fontWeight: '900', color: colors.text, textAlign: 'center' },
    headerSub: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
    middle: { alignItems: 'center', paddingHorizontal: 24 },
    orb: {
      width: 150,
      height: 150,
      borderRadius: 75,
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: colors.glassLime,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orbSpeaking: { backgroundColor: colors.primary + '55', borderWidth: 6 },
    orbOver: { borderColor: colors.border, backgroundColor: colors.glassChip },
    orbIcon: { fontSize: 52 },
    status: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 18, textAlign: 'center' },
    handed: { fontSize: 13, color: colors.primary, marginTop: 8, textAlign: 'center' },
    transcript: { alignSelf: 'stretch', marginTop: 22, gap: 6, minHeight: 120 },
    lineCaller: { fontSize: 13.5, color: colors.text, textAlign: 'right' },
    lineAgent: { fontSize: 13.5, color: colors.muted },
    row: { flexDirection: 'row', justifyContent: 'space-evenly', paddingBottom: 40 },
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
    roundActive: { backgroundColor: colors.primary + '33', borderColor: colors.primary },
    roundIcon: { fontSize: 26, color: '#ffffff' },
    btnLabel: { fontSize: 12.5, color: colors.muted, marginTop: 8 },
    overBox: { paddingHorizontal: 24, paddingBottom: 32, gap: 10 },
    wideBtn: { backgroundColor: colors.btnBg, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
    wideBtnTxt: { fontSize: 15, fontWeight: '900', color: colors.btnText },
    closeBtn: { paddingVertical: 14, alignItems: 'center' },
    closeTxt: { fontSize: 15, fontWeight: '800', color: colors.muted },
  }),
);
