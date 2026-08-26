/**
 * "WhatsApp me new rides" — the driver's own control over the one channel that
 * reaches them when the app is closed.
 *
 * Two things happen on this screen, and they are deliberately separate:
 *
 *  1. CONSENT. Nothing is ever sent until the driver switches it on here. The
 *     backend refuses to set the flag any other way, because an unrequested
 *     WhatsApp message from a business is what people report — and enough
 *     reports take Velocity's number out of service for everybody.
 *  2. THE NUMBER. A driver's WhatsApp is very often not the number they drive
 *     on: a second SIM, a family handset, the number their own customers
 *     already have. Alerts sent to a number with no WhatsApp on it are worse
 *     than useless — they bounce, and bounces count against the sender — so the
 *     driver gets to correct it here rather than being stuck with whatever
 *     onboarding captured.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Text } from '../../src/ui/Text';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { useDriverProfile } from '../../src/hooks/driver';
import { themed } from '../../src/theme';
import { PrimaryButton } from '../../src/ui/components';

/** "+92 300 1234567" / "0300-1234567" → "3001234567" (the subscriber digits). */
function stripPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('92') && d.length > 10) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d;
}

/** "3001234567" → "300 1234567" (display only). */
function prettyPhone(digits: string): string {
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** Every Pakistani mobile is ten digits starting with 3, once 0/+92 is gone. */
function isValidPkMobile(digits: string): boolean {
  return /^3\d{9}$/.test(digits);
}

/** `923001234567` (as stored) → the subscriber digits the input shows. */
function subscriberDigits(stored: string | undefined): string {
  if (!stored) return '';
  return stored.startsWith('92') ? stored.slice(2) : stored;
}

export default function WhatsAppAlerts() {
  const router = useRouter();
  const { user } = useAuth();
  const profile = useDriverProfile(user?.uid);

  const saved = profile?.whatsappAlerts;
  const optIn = saved?.optIn === true;
  const blocked = saved?.blocked === true;
  const savedDigits = useMemo(() => subscriberDigits(saved?.number), [saved?.number]);

  const [busy, setBusy] = useState(false);
  // `null` means "no local edit yet", so the field mirrors whatever the server
  // has — including a number changed from another device. Once the driver types
  // anything it holds their draft, and no incoming snapshot can yank the text
  // out from under them mid-edit. Deriving it this way rather than syncing an
  // effect means there is no window where the two disagree.
  const [draft, setDraft] = useState<string | null>(null);
  const phone = draft ?? savedDigits;

  const valid = isValidPkMobile(phone);
  const changed = phone !== savedDigits;

  async function save(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.setWhatsAppAlerts({
        enabled,
        // Only sent when turning ON. Switching off must never depend on a valid
        // number — "stop messaging me" has to work from any state.
        ...(enabled && valid ? { phone: `92${phone}` } : {}),
      });
      setDraft(null);
      if (enabled) {
        Alert.alert(
          'WhatsApp alerts are on ✅',
          `We'll message ${res.number ?? 'your number'} when a ride comes up near you while you're offline.`,
        );
      }
    } catch (e) {
      const message = (e as { message?: string })?.message ?? 'Please try again.';
      Alert.alert(enabled ? 'Could not turn alerts on' : 'Could not turn alerts off', message);
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(next: boolean) {
    if (next && !valid) {
      Alert.alert('Check your number', 'Enter your WhatsApp number as 3XX XXXXXXX first.');
      return;
    }
    save(next);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/driver/home'))}
          hitSlop={12}
        >
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>WhatsApp alerts</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Edge-to-edge windows ignore adjustResize, so the keyboard would
          otherwise sit on top of the Save button. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.heroIcon}>💬</Text>
            <Text style={styles.heroTitle}>Get rides even with the app closed</Text>
            <Text style={styles.heroBody}>
              When you are offline we cannot send you a notification — the app is not running. Add
              your WhatsApp number and we will message you instead when a ride comes up near you.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>YOUR WHATSAPP NUMBER</Text>
          <View style={styles.card}>
            <View style={styles.phoneRow}>
              <View style={styles.prefix}>
                <Text style={styles.prefixFlag}>🇵🇰</Text>
                <Text style={styles.prefixCode}>+92</Text>
              </View>
              <View style={styles.phoneDivider} />
              <TextInput
                value={prettyPhone(phone)}
                onChangeText={(t) => setDraft(stripPhone(t))}
                keyboardType="phone-pad"
                placeholder="300 1234567"
                placeholderTextColor={colors.muted}
                style={styles.phoneInput}
                maxLength={11}
                returnKeyType="done"
                editable={!busy}
              />
            </View>
          </View>
          <Text style={styles.hint}>
            This can be different from the number you signed up with — use whichever phone actually
            has WhatsApp on it. Make sure the number is on WhatsApp, or the message will not arrive.
          </Text>

          <Text style={styles.sectionLabel}>ALERTS</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>WhatsApp me new rides</Text>
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Switch
                  value={optIn}
                  onValueChange={handleToggle}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              )}
            </View>
          </View>

          {/* Saying this before they switch it on, not after, is the point:
              consent that turns out to mean something different from what the
              person expected is what gets a business number reported. */}
          <View style={styles.promises}>
            <Text style={styles.promise}>• A few messages a day at most — never a flood.</Text>
            <Text style={styles.promise}>• Nothing between 10pm and 7am.</Text>
            <Text style={styles.promise}>• Only real rides near you, never ads or offers.</Text>
            <Text style={styles.promise}>• Reply STOP on WhatsApp any time to end them.</Text>
          </View>

          {optIn && changed ? (
            <PrimaryButton
              label="Save new number"
              onPress={() => save(true)}
              loading={busy}
              disabled={busy || !valid}
            />
          ) : null}

          {blocked && !optIn ? (
            <Text style={styles.blockedNote}>
              Alerts are currently stopped for this number. Check the number above, then switch
              alerts back on to start receiving them again.
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 32 },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  container: { padding: 16, gap: 10, paddingBottom: 40 },

  hero: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 8,
  },
  heroIcon: { fontSize: 30 },
  heroTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  heroBody: { fontSize: 13, lineHeight: 19, color: colors.muted },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    marginTop: 14,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  hint: { fontSize: 11, color: colors.muted, lineHeight: 16, marginLeft: 4 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6 },
  prefix: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12 },
  prefixFlag: { fontSize: 18 },
  prefixCode: { fontSize: 15, fontWeight: '700', color: colors.text },
  phoneDivider: { width: 1, height: 24, backgroundColor: colors.border, marginHorizontal: 12 },
  phoneInput: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.text, paddingVertical: 12 },

  promises: { gap: 6, marginTop: 4, marginLeft: 4, marginBottom: 8 },
  promise: { fontSize: 12, color: colors.muted, lineHeight: 18 },

  blockedNote: { fontSize: 12, color: colors.danger, lineHeight: 18, marginLeft: 4, marginTop: 8 },
}));
