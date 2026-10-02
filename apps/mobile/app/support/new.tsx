/**
 * Filing a complaint.
 *
 * The category picker is not administrative tidiness — it is the routing table.
 * Safety and online-scam reports never touch the AI; they open as urgent
 * tickets owned by a person, and the screen says so before the user types, so
 * nobody reporting harassment is left wondering whether a robot is about to
 * answer them.
 *
 * Safety also gets the police number on the form itself. Somebody filing a
 * harassment report at 11pm should not have to go back and find another screen
 * to learn that 15 exists.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Text, TextInput } from '../../src/ui/Text';
import { api, type SupportCategory } from '../../src/api/client';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { PrimaryButton } from '../../src/ui/components';

/** Mirrors CATEGORY_LABELS in the backend's support/types.ts. */
const CATEGORIES: { key: SupportCategory; label: string; icon: string; hint: string }[] = [
  {
    key: 'safety',
    label: 'Safety or harassment',
    icon: '🛡️',
    hint: 'A fight, a threat, harassment, or anything that frightened you.',
  },
  {
    key: 'online_scam',
    label: 'Online scam or fraud',
    icon: '🎣',
    hint: 'Someone tried to take money from you, or asked for an OTP or PIN.',
  },
  { key: 'payment', label: 'Fare or payment', icon: '💵', hint: 'A fare, a charge, or a refund.' },
  { key: 'driver_issue', label: 'Problem with a driver', icon: '🚗', hint: 'Behaviour, the car, or the route.' },
  { key: 'passenger_issue', label: 'Problem with a passenger', icon: '🙋', hint: 'For drivers: a rider on one of your trips.' },
  { key: 'commission', label: 'Commission or bonus', icon: '📋', hint: 'For drivers: your cycle, your daily target, your bonus.' },
  { key: 'account', label: 'Account or sign-in', icon: '🔐', hint: 'Codes, verification, or a blocked account.' },
  { key: 'lost_item', label: 'Lost item', icon: '🎒', hint: 'Something left in the car.' },
  { key: 'other', label: 'Something else', icon: '💬', hint: 'Anything not on this list.' },
];

/** These two open as urgent and belong to a person from the first second. */
const HUMAN_ONLY: ReadonlySet<SupportCategory> = new Set(['safety', 'online_scam']);

export default function NewSupportTicket() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; tripId?: string }>();

  const initial = useMemo<SupportCategory | null>(() => {
    const requested = typeof params.category === 'string' ? params.category : null;
    return CATEGORIES.some((c) => c.key === requested) ? (requested as SupportCategory) : null;
  }, [params.category]);

  const [category, setCategory] = useState<SupportCategory | null>(initial);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const tripId = typeof params.tripId === 'string' ? params.tripId : undefined;
  const humanOnly = !!category && HUMAN_ONLY.has(category);

  async function submit() {
    if (!category || busy) return;
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();
    if (trimmedSubject.length < 3) {
      Alert.alert('Add a short title', 'One line is enough — e.g. "Driver took a wrong route".');
      return;
    }
    if (trimmedMessage.length < 3) {
      Alert.alert('Tell us what happened', 'Even a sentence or two helps us act faster.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.openSupportTicket({
        category,
        subject: trimmedSubject,
        message: trimmedMessage,
        tripId,
      });
      // Straight into the thread — the first reply is already waiting there.
      router.replace(`/support/${res.ticketId}`);
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Report a problem</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Edge-to-edge Android ignores adjustResize, so padding behaviour on both
          platforms — see the onboarding screens for the same reasoning. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>What is it about?</Text>
          <View style={styles.cats}>
            {CATEGORIES.map((c) => {
              const active = category === c.key;
              return (
                <Pressable
                  key={c.key}
                  style={[styles.cat, active && styles.catActive]}
                  onPress={() => setCategory(c.key)}
                >
                  <Text style={styles.catIcon}>{c.icon}</Text>
                  <View style={styles.flex}>
                    <Text style={[styles.catLabel, active && styles.catLabelActive]}>{c.label}</Text>
                    <Text style={styles.catHint}>{c.hint}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Emergency guidance, on the form, for the one category that needs it
              before the form is even submitted. */}
          {category === 'safety' ? (
            <Pressable
              style={styles.policeNote}
              onPress={() =>
                Alert.alert('Call police 15?', 'This dials the Pakistan police emergency helpline.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Call 15',
                    style: 'destructive',
                    onPress: () => {
                      Linking.openURL('tel:15').catch(() => undefined);
                    },
                  },
                ])
              }
            >
              <Text style={styles.policeNoteTxt}>
                🚨 If you are in danger right now, call the police on 15 first. Tap here to
                dial. Then come back and tell us — we will still act on it.
              </Text>
            </Pressable>
          ) : null}

          {humanOnly ? (
            <Text style={styles.humanNote}>
              This goes straight to a real person at Velocity Rides, marked urgent. No
              assistant will handle it.
            </Text>
          ) : category ? (
            <Text style={styles.aiNote}>
              Our assistant answers first — usually in seconds. Ask for a human at any time
              and we will hand you over immediately.
            </Text>
          ) : null}

          <Text style={styles.label}>Short title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Charged a cancellation fee unfairly"
            placeholderTextColor={colors.muted}
            value={subject}
            onChangeText={setSubject}
            maxLength={120}
          />

          <Text style={styles.label}>What happened?</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Tell us in your own words. Include names, plate numbers, times and amounts if you have them."
            placeholderTextColor={colors.muted}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={2000}
          />
          <Text style={styles.counter}>{message.length}/2000</Text>

          <View style={{ height: 8 }} />
          <PrimaryButton
            label={busy ? 'Sending…' : 'Send'}
            onPress={submit}
            loading={busy}
            disabled={!category || busy}
          />
          {tripId ? (
            <Text style={styles.tripNote}>This will be linked to your ride, so we can see it too.</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: { fontSize: 30, color: colors.text, lineHeight: 32 },
    headerTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
    content: { padding: 16, paddingBottom: 40 },

    label: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.muted,
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      marginTop: 14,
      marginBottom: 8,
    },
    cats: { gap: 8 },
    cat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 13,
      padding: 12,
    },
    catActive: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primary + '12' },
    catIcon: { fontSize: 20 },
    catLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
    catLabelActive: { color: colors.primary },
    catHint: { fontSize: 11.5, color: colors.muted, lineHeight: 16, marginTop: 1 },

    policeNote: {
      marginTop: 14,
      backgroundColor: colors.danger + '18',
      borderWidth: 1.5,
      borderColor: colors.danger,
      borderRadius: 13,
      padding: 12,
    },
    policeNoteTxt: { fontSize: 12.5, color: colors.text, lineHeight: 19, fontWeight: '700' },
    humanNote: {
      marginTop: 12,
      fontSize: 12.5,
      color: colors.secondary,
      lineHeight: 18,
      fontWeight: '700',
    },
    aiNote: { marginTop: 12, fontSize: 12.5, color: colors.muted, lineHeight: 18 },

    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 13,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.text,
    },
    textarea: { minHeight: 130, textAlignVertical: 'top' },
    counter: { fontSize: 11, color: colors.muted, textAlign: 'right', marginTop: 4 },
    tripNote: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 17 },
  }),
);
