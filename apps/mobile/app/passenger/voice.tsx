/**
 * Voice booking — speak a trip instead of typing it.
 *
 * The whole screen is one conversation loop: listen, understand, ask for
 * whatever is still missing, read the result back, hand off. Everything runs on
 * the device. There is no server call, no API key and no per-booking cost, and
 * it works with the network down until the moment the booking itself is placed.
 *
 * It deliberately stops short of booking. Once the slots are filled it pushes
 * to the normal booking screen with them prefilled, so the map, the real fare
 * from the fare engine, and the final confirm are the same ones every other
 * passenger sees. Voice solves understanding; it does not get its own
 * money-handling path.
 *
 * Accessibility drives the layout: very large type, one control at a time, and
 * every spoken line also printed. A user who cannot read gets the full flow by
 * ear, and a user who cannot hear gets it by eye.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { Text } from '../../src/ui/Text';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { useAuth } from '../../src/auth/AuthContext';
import { useRecentDestinations } from '../../src/hooks/passenger';
import { BASE_FARES, RIDE_TYPE_LABELS, type RideType } from '../../src/domain/types';
import { MicIcon } from '../../src/ui/ServiceIcons';
import {
  parseBooking,
  parseDestinationAnswer,
  parseRideTypeAnswer,
  parseYesNo,
  type VoiceIntent,
} from '../../src/voice/parser';
import {
  abortListening,
  isRecognitionAvailable,
  loadPreferredLocale,
  nextLocale,
  rememberLocale,
  requestPermission,
  speak,
  startListening,
  stopListening,
  stopSpeaking,
  type VoiceLocale,
} from '../../src/voice/speech';
import {
  ASK_DESTINATION,
  CANCELLED,
  GREETING,
  NOT_AVAILABLE,
  NOT_UNDERSTOOD,
  NO_PERMISSION,
  POOL_NOTE,
  VOICE_RIDE_OPTIONS,
  askRideType,
  confirmLine,
  rideNameUr,
} from '../../src/voice/phrases';

/** Which slot the conversation is currently working on. */
type Step = 'destination' | 'rideType' | 'confirm';

type Phase = 'checking' | 'unavailable' | 'denied' | 'ready' | 'listening' | 'thinking';

/** Consecutive failures on one locale before trying the next one in the chain. */
const FAILURES_BEFORE_LOCALE_SWITCH = 2;

export default function VoiceBooking() {
  const router = useRouter();
  const { user } = useAuth();
  const recents = useRecentDestinations(user?.uid);

  const [phase, setPhase] = useState<Phase>('checking');
  const [step, setStep] = useState<Step>('destination');
  const [prompt, setPrompt] = useState<string>(GREETING);
  const [heard, setHeard] = useState('');
  const [level, setLevel] = useState(0);

  // Slots gathered so far. Held in a ref as well as state because the speech
  // event handlers fire outside React's render cycle and need current values.
  const [draft, setDraft] = useState<{
    destination: string | null;
    destLat?: number;
    destLng?: number;
    rideType: RideType | null;
    pool: boolean | null;
    seats: number;
  }>({ destination: null, rideType: null, pool: null, seats: 1 });

  // Mirrored into refs so the recogniser's event handlers — which fire from
  // native code, long after any render — read current values instead of the
  // ones captured when the listener was registered. Synced in an effect rather
  // than during render, which React forbids.
  const draftRef = useRef(draft);
  const stepRef = useRef<Step>(step);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const localeRef = useRef<VoiceLocale>('ur-PK');
  const failuresRef = useRef(0);
  const finalTranscriptRef = useRef('');
  const heardRef = useRef('');

  /**
   * Set false on unmount. Leaving the screen aborts the recogniser, which fires
   * a final `end` event — without this guard that event would be handled as a
   * failed utterance and start the mic again on a screen the rider has left.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * The rider's own place names, used both to bias the recogniser and to beat
   * the national gazetteer. Memoised because it feeds the listening callbacks —
   * a fresh array each render would rebuild the whole chain of them.
   */
  const knownPlaces = useMemo(() => recents.map((r) => r.address), [recents]);

  // ── Startup: availability, permission, greeting ───────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isRecognitionAvailable()) {
        if (cancelled) return;
        setPhase('unavailable');
        setPrompt(NOT_AVAILABLE);
        await speak(NOT_AVAILABLE);
        return;
      }

      const granted = await requestPermission();
      if (cancelled) return;

      if (!granted) {
        setPhase('denied');
        setPrompt(NO_PERMISSION);
        await speak(NO_PERMISSION);
        return;
      }

      localeRef.current = await loadPreferredLocale();
      if (cancelled) return;

      setPhase('ready');
      await speak(GREETING);
    })();

    return () => {
      cancelled = true;
      abortListening();
      stopSpeaking();
    };
  }, []);

  // ── Listening controls ────────────────────────────────────────────────────

  const beginListening = useCallback(() => {
    stopSpeaking();
    setHeard('');
    finalTranscriptRef.current = '';
    setPhase('listening');
    startListening(localeRef.current, knownPlaces);
  }, [knownPlaces]);

  /** Ask a question aloud, then open the mic for the answer. */
  const ask = useCallback(
    async (line: string, nextStep: Step) => {
      setStep(nextStep);
      setPrompt(line);
      setPhase('thinking');
      await speak(line);
      // Speaking takes seconds; the rider may have left in the meantime.
      if (!mountedRef.current) return;
      beginListening();
    },
    [beginListening],
  );

  /** Nothing usable was heard: retry, moving down the locale chain if needed. */
  const handleMiss = useCallback(async () => {
    failuresRef.current += 1;

    if (failuresRef.current >= FAILURES_BEFORE_LOCALE_SWITCH) {
      const fallback = nextLocale(localeRef.current);
      if (fallback) {
        localeRef.current = fallback;
        failuresRef.current = 0;
      }
    }

    setPhase('thinking');
    setPrompt(NOT_UNDERSTOOD);
    await speak(NOT_UNDERSTOOD);
    if (!mountedRef.current) return;
    beginListening();
  }, [beginListening]);

  // ── Step handlers ─────────────────────────────────────────────────────────

  /** Move the conversation to whatever slot is still empty. */
  const advance = useCallback(
    async (next: typeof draft) => {
      setDraft(next);

      if (!next.destination) {
        await ask(ASK_DESTINATION, 'destination');
        return;
      }

      if (!next.rideType) {
        const line = next.pool ? `${askRideType()} ${POOL_NOTE}` : askRideType();
        await ask(line, 'rideType');
        return;
      }

      const line = confirmLine({
        destination: next.destination,
        rideType: next.rideType,
        pool: Boolean(next.pool),
        seats: next.seats,
      });
      await ask(line, 'confirm');
    },
    [ask],
  );

  /** Apply a parsed opening sentence to the draft. */
  const applyIntent = useCallback(
    async (intent: VoiceIntent) => {
      if (!intent.understood || !intent.destinationText) {
        // Some sentences carry a vehicle or pool preference but no destination.
        // Keep those rather than discarding a usable half-answer.
        if (intent.rideType || intent.pool !== null) {
          await advance({
            ...draftRef.current,
            rideType: intent.rideType ?? draftRef.current.rideType,
            pool: intent.pool ?? draftRef.current.pool,
            seats: intent.seats,
          });
          return;
        }
        await handleMiss();
        return;
      }

      const recent = recents.find(
        (r) => r.address.toLowerCase() === intent.destinationText!.toLowerCase(),
      );

      await advance({
        destination: intent.destinationText,
        destLat: recent?.lat,
        destLng: recent?.lng,
        rideType: intent.rideType,
        pool: intent.pool,
        seats: intent.seats,
      });
    },
    [advance, handleMiss, recents],
  );

  /** Hand the filled slots to the normal booking screen. */
  const handOff = useCallback(
    (final: typeof draft) => {
      abortListening();
      stopSpeaking();

      router.replace({
        pathname: '/passenger/booking',
        params: {
          voiceDropoff: final.destination ?? '',
          ...(final.destLat != null ? { voiceDropoffLat: String(final.destLat) } : {}),
          ...(final.destLng != null ? { voiceDropoffLng: String(final.destLng) } : {}),
          ...(final.rideType ? { voiceRideType: final.rideType } : {}),
          voicePool: final.pool ? '1' : '0',
          voiceSeats: String(final.seats),
        },
      });
    },
    [router],
  );

  /** Route one finished utterance to whichever question is open. */
  const handleTranscript = useCallback(
    async (transcript: string) => {
      const text = transcript.trim();
      if (!text) {
        await handleMiss();
        return;
      }

      // This locale produced something usable — lead with it next session.
      failuresRef.current = 0;
      void rememberLocale(localeRef.current);

      switch (stepRef.current) {
        case 'destination': {
          // The opening turn is parsed as a whole sentence; a reply to "where
          // to?" is parsed as a bare place name.
          const asSentence = parseBooking(text, knownPlaces);
          if (asSentence.destinationText) {
            await applyIntent(asSentence);
            return;
          }

          const answer = parseDestinationAnswer(text, knownPlaces);
          if (!answer.text) {
            await handleMiss();
            return;
          }

          const recent = recents.find(
            (r) => r.address.toLowerCase() === answer.text!.toLowerCase(),
          );

          await advance({
            ...draftRef.current,
            destination: answer.text,
            destLat: recent?.lat,
            destLng: recent?.lng,
            // A full sentence may have carried these alongside the place.
            rideType: asSentence.rideType ?? draftRef.current.rideType,
            pool: asSentence.pool ?? draftRef.current.pool,
            seats: asSentence.seats > 1 ? asSentence.seats : draftRef.current.seats,
          });
          return;
        }

        case 'rideType': {
          const rideType = parseRideTypeAnswer(text);
          if (!rideType) {
            await handleMiss();
            return;
          }
          await advance({ ...draftRef.current, rideType });
          return;
        }

        case 'confirm': {
          const answer = parseYesNo(text);

          if (answer === true) {
            handOff(draftRef.current);
            return;
          }

          if (answer === false) {
            setPhase('thinking');
            setPrompt(CANCELLED);
            await speak(CANCELLED);
            router.back();
            return;
          }

          // Neither yes nor no. Never assume consent on the step that leads to
          // a charge — ask again.
          await handleMiss();
          return;
        }
      }
    },
    [advance, applyIntent, handOff, handleMiss, knownPlaces, recents, router],
  );

  // ── Recogniser events ─────────────────────────────────────────────────────

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript ?? '';
    heardRef.current = transcript;
    setHeard(transcript);
    if (event.isFinal) finalTranscriptRef.current = transcript;
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    // Reported roughly -2..10; clamp to a 0..1 bar height.
    setLevel(Math.max(0, Math.min(1, (event.value ?? 0) / 10)));
  });

  useSpeechRecognitionEvent('end', () => {
    if (!mountedRef.current) return;
    setLevel(0);
    setPhase('thinking');
    void handleTranscript(finalTranscriptRef.current || heardRef.current);
  });

  useSpeechRecognitionEvent('error', () => {
    if (!mountedRef.current) return;
    setLevel(0);
    void handleMiss();
  });

  // ── Render ────────────────────────────────────────────────────────────────

  const listening = phase === 'listening';
  const blocked = phase === 'unavailable' || phase === 'denied';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.close} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeTxt}>Close</Text>
        </Pressable>

        {/* What the app just said — large, and always present in text. */}
        <Text style={styles.prompt}>{prompt}</Text>

        {/* What it heard, live. */}
        {heard ? <Text style={styles.heard}>{heard}</Text> : null}

        {/* Slots gathered so far, so a sighted user can check them at a glance. */}
        {draft.destination ? (
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Going to</Text>
            <Text style={styles.summaryValue}>{draft.destination}</Text>

            {draft.rideType ? (
              <>
                <Text style={styles.summaryLabel}>Vehicle</Text>
                <Text style={styles.summaryValue}>
                  {RIDE_TYPE_LABELS[draft.rideType]} · from PKR {BASE_FARES[draft.rideType]}
                </Text>
              </>
            ) : null}

            {draft.pool ? <Text style={styles.summaryPool}>Shared ride</Text> : null}
            {draft.seats > 1 ? (
              <Text style={styles.summaryPool}>{draft.seats} passengers</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'checking' ? <ActivityIndicator color={colors.primary} /> : null}

        {/* The mic. One control, deliberately oversized. */}
        {!blocked ? (
          <Pressable
            style={[styles.mic, listening && styles.micLive]}
            onPress={() => (listening ? stopListening() : beginListening())}
            accessibilityRole="button"
            accessibilityLabel={listening ? 'Stop listening' : 'Start speaking'}
          >
            <View style={[styles.micPulse, { transform: [{ scale: 1 + level * 0.35 }] }]} />
            <MicIcon size={54} color="#0b0d0c" />
          </Pressable>
        ) : null}

        <Text style={styles.hint}>
          {listening ? 'Listening… tap to stop' : 'Tap the mic and say where you want to go'}
        </Text>

        {/* Confirmation is never voice-only: a misheard "haan" must not be able
            to book a ride on its own. */}
        {step === 'confirm' && draft.destination && draft.rideType ? (
          <View style={styles.confirmRow}>
            <Pressable style={styles.confirmBtn} onPress={() => handOff(draft)}>
              <Text style={styles.confirmTxt}>Confirm</Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Every dead end offers the typed flow rather than trapping the user. */}
        {blocked ? (
          <Pressable
            style={styles.confirmBtn}
            onPress={() => router.replace('/passenger/booking')}
          >
            <Text style={styles.confirmTxt}>Type it instead</Text>
          </Pressable>
        ) : null}

        {step === 'rideType' ? (
          <View style={styles.chips}>
            {VOICE_RIDE_OPTIONS.map((rideType) => (
              <Pressable
                key={rideType}
                style={styles.chip}
                onPress={() => void advance({ ...draft, rideType })}
              >
                <Text style={styles.chipTxt}>
                  {rideNameUr(rideType)} · {BASE_FARES[rideType]}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 24, alignItems: 'center', gap: 18, paddingBottom: 60 },
    close: { alignSelf: 'flex-end' },
    closeTxt: { color: colors.muted, fontSize: 16, fontWeight: '700' },
    prompt: {
      fontSize: 26,
      lineHeight: 38,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      marginTop: 12,
    },
    heard: {
      fontSize: 19,
      lineHeight: 28,
      color: colors.muted,
      textAlign: 'center',
      fontStyle: 'italic',
    },
    summary: {
      alignSelf: 'stretch',
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
      padding: 16,
      gap: 4,
    },
    summaryLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginTop: 6,
    },
    summaryValue: { fontSize: 20, fontWeight: '800', color: colors.text },
    summaryPool: { fontSize: 15, fontWeight: '700', color: colors.primary, marginTop: 6 },
    mic: {
      width: 148,
      height: 148,
      borderRadius: 74,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    micLive: { backgroundColor: '#ffffff' },
    micPulse: {
      position: 'absolute',
      width: 148,
      height: 148,
      borderRadius: 74,
      backgroundColor: colors.primary,
      opacity: 0.35,
    },
    hint: { fontSize: 16, color: colors.muted, textAlign: 'center' },
    confirmRow: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
    confirmBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 16,
      paddingVertical: 18,
      alignItems: 'center',
    },
    confirmTxt: { fontSize: 20, fontWeight: '900', color: '#0b0d0c' },
    cancelBtn: {
      flex: 1,
      borderRadius: 16,
      paddingVertical: 18,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.2)',
    },
    cancelTxt: { fontSize: 20, fontWeight: '800', color: colors.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
    chip: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.16)',
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    chipTxt: { fontSize: 17, fontWeight: '800', color: colors.text },
  }),
);
