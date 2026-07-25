/**
 * Floating mic for the driver app.
 *
 * A driver is usually holding a steering wheel, so this is built to need no
 * reading and no aiming: one large target, one tap to listen, and a spoken
 * acknowledgement of whatever it did. There are no follow-up questions — the
 * command grammar in ../voice/commands has no slots to fill, so an utterance
 * either resolves to an action or asks to be repeated.
 *
 * The screen owns what each command means. This component only recognises and
 * confirms; `onCommand` returns false when a command doesn't apply right now
 * (accepting a ride with no request on screen), and the driver hears that
 * rather than silence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { Text } from './Text';
import { MicIcon } from './ServiceIcons';
import { colors } from '../config';
import { themed } from '../theme';
import {
  COMMAND_ACK,
  COMMAND_LABEL,
  DRIVER_NOT_UNDERSTOOD,
  DRIVER_PROMPT,
  resolveCommand,
  type DriverCommand,
} from '../voice/commands';
import {
  abortListening,
  isRecognitionAvailable,
  loadPreferredLocale,
  requestPermission,
  speak,
  startListening,
  stopListening,
  stopSpeaking,
  type VoiceLocale,
} from '../voice/speech';

export interface DriverVoiceButtonProps {
  /**
   * Perform a command. Return false when it isn't applicable in the current
   * state so the driver gets told, instead of the app appearing to ignore them.
   */
  onCommand: (command: DriverCommand) => boolean | Promise<boolean>;
}

/** Spoken when a command is understood but can't run right now. */
const NOT_APPLICABLE = 'ابھی یہ نہیں ہو سکتا۔';

export function DriverVoiceButton({ onCommand }: DriverVoiceButtonProps) {
  const [available] = useState(() => isRecognitionAvailable());
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const localeRef = useRef<VoiceLocale>('ur-PK');
  const finalTranscriptRef = useRef('');
  const heardRef = useRef('');
  // Handlers fire from native code; without this the callback captured at mount
  // would be the one that runs, holding stale screen state.
  const onCommandRef = useRef(onCommand);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  /**
   * Leaving the screen aborts the recogniser, which fires a final `end` event.
   * Without this guard that event would be handled as a real utterance and could
   * run a command against a screen the driver has already navigated away from.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!available) return;
    void loadPreferredLocale().then((locale) => {
      localeRef.current = locale;
    });

    return () => {
      abortListening();
      stopSpeaking();
    };
  }, [available]);

  const begin = useCallback(async () => {
    stopSpeaking();

    const granted = await requestPermission();
    if (!granted) {
      setStatus('Microphone permission needed');
      return;
    }

    finalTranscriptRef.current = '';
    heardRef.current = '';
    setStatus(null);
    setListening(true);
    await speak(DRIVER_PROMPT);
    startListening(localeRef.current);
  }, []);

  const handleUtterance = useCallback(async (transcript: string) => {
    const command = resolveCommand(transcript);

    if (!command) {
      setStatus(transcript ? `Didn't catch that: "${transcript}"` : "Didn't catch that");
      await speak(DRIVER_NOT_UNDERSTOOD);
      return;
    }

    setStatus(COMMAND_LABEL[command]);

    const applied = await onCommandRef.current(command);
    await speak(applied ? COMMAND_ACK[command] : NOT_APPLICABLE);

    if (!applied) setStatus(null);
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript ?? '';
    heardRef.current = transcript;
    if (event.isFinal) finalTranscriptRef.current = transcript;
  });

  useSpeechRecognitionEvent('end', () => {
    if (!mountedRef.current) return;
    setListening(false);
    void handleUtterance(finalTranscriptRef.current || heardRef.current);
  });

  useSpeechRecognitionEvent('error', () => {
    if (!mountedRef.current) return;
    setListening(false);
    setStatus("Didn't catch that");
  });

  // A handset with no recogniser gets no button at all — every driver action
  // here already has an on-screen control.
  if (!available) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {status ? (
        <View style={styles.status}>
          <Text style={styles.statusTxt}>{status}</Text>
        </View>
      ) : null}

      <Pressable
        style={[styles.fab, listening && styles.fabLive]}
        onPress={() => (listening ? stopListening() : void begin())}
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop listening' : 'Speak a command'}
      >
        <MicIcon size={26} color="#0b0d0c" />
      </Pressable>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      right: 16,
      bottom: 96,
      alignItems: 'flex-end',
      gap: 8,
    },
    status: {
      backgroundColor: 'rgba(0,0,0,0.82)',
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
      maxWidth: 240,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
    },
    statusTxt: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
    fab: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 6,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    fabLive: { backgroundColor: '#ffffff' },
  }),
);
