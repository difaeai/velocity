/**
 * Emergency contacts — the five people an SOS goes to.
 *
 * A top-level route, not a passenger one: drivers press SOS too, and a driver
 * alone on an intercity road at 3am is the person who needs this most.
 *
 * ── THE WHATSAPP CHECK ──────────────────────────────────────────────────────
 *
 * A number that is not on WhatsApp is a contact who will never hear the alarm,
 * and the user will not find that out until the night it matters. Nothing can
 * tell us from here whether a stranger's number is registered (see the header
 * of src/lib/sos.ts), so the screen makes the phone answer the question: it
 * opens the contact's WhatsApp chat with a short hello already written. If the
 * number is not on WhatsApp, WhatsApp itself says so and no chat opens.
 *
 * When the app comes back to the foreground it asks what happened. That is a
 * self-reported answer and we treat it as one — an unchecked contact is still
 * alerted, because refusing to raise an alarm over a missing checkbox would be
 * indefensible — but it is nagged about until it is done, and sending the hello
 * has a second use: the contact learns what an SOS from this number means
 * before one arrives at 2am.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Text, TextInput } from '../src/ui/Text';
import { PrimaryButton } from '../src/ui/components';
import { AttachmentError, pickChatContact } from '../src/chat/attachments';
import { colors } from '../src/config';
import { themed } from '../src/theme';
import { useAuth } from '../src/auth/AuthContext';
import { useEmergencyContacts } from '../src/hooks/emergencyContacts';
import {
  MAX_EMERGENCY_CONTACTS,
  contactIntroMessage,
  formatPhone,
  prepareContact,
  whatsAppChatUrls,
  type EmergencyContact,
} from '../src/lib/sos';

export default function EmergencyContactsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { contacts, loading, save } = useEmergencyContacts(user?.uid);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * The contact whose WhatsApp we just opened, waiting on the user coming back.
   * A ref, not state: the AppState listener must read the current value and
   * must not be torn down and re-subscribed every time a contact changes.
   */
  const awaitingCheck = useRef<EmergencyContact | null>(null);

  const markChecked = useCallback(
    async (target: EmergencyContact, ok: boolean) => {
      if (!ok) return;
      try {
        await save(
          contacts.map((c) =>
            c.id === target.id ? { ...c, whatsappCheckedAt: Date.now() } : c,
          ),
        );
      } catch {
        /* The contact still works; only the badge is lost. */
      }
    },
    [contacts, save],
  );

  // Ask what happened once the user is back from WhatsApp — never before, or
  // the question is behind the app they just switched to.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const pending = awaitingCheck.current;
      if (!pending) return;
      awaitingCheck.current = null;
      Alert.alert(
        `Did WhatsApp open ${pending.name}'s chat?`,
        'If WhatsApp said the number is not registered, fix the number — an SOS would never reach them.',
        [
          { text: 'No, it failed', style: 'destructive' },
          { text: 'Yes, it opened', onPress: () => void markChecked(pending, true) },
        ],
      );
    });
    return () => sub.remove();
  }, [markChecked]);

  async function openWhatsApp(contact: EmergencyContact) {
    const { app, web } = whatsAppChatUrls(contact.phone, contactIntroMessage(user?.displayName));
    awaitingCheck.current = contact;
    try {
      await Linking.openURL(app);
    } catch {
      try {
        await Linking.openURL(web);
      } catch {
        awaitingCheck.current = null;
        Alert.alert('WhatsApp did not open', 'Install WhatsApp, or check the number.');
      }
    }
  }

  async function addFromPhonebook() {
    try {
      const picked = await pickChatContact();
      if (!picked) return;
      setName(picked.name);
      setPhone(picked.phone);
    } catch (e) {
      Alert.alert(
        'Could not open contacts',
        e instanceof AttachmentError ? e.message : 'Type the number instead.',
      );
    }
  }

  async function addContact() {
    const check = prepareContact({
      existing: contacts,
      name,
      phone,
      ownPhone: user?.phoneNumber,
    });
    if (!check.ok) {
      Alert.alert('Check this', check.message);
      return;
    }
    setSaving(true);
    try {
      await save([...contacts, check.contact]);
      setAdding(false);
      setName('');
      setPhone('');
      // Straight into the WhatsApp check: the contact is useless until it
      // passes, and the user will not come back to do it later.
      Alert.alert(
        `${check.contact.name} added`,
        'Send them a quick hello on WhatsApp now — it proves the number works and tells them what an SOS from you means.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open WhatsApp', onPress: () => void openWhatsApp(check.contact) },
        ],
      );
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function removeContact(target: EmergencyContact) {
    Alert.alert(
      `Remove ${target.name}?`,
      'They will stop getting your SOS alerts.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void save(contacts.filter((c) => c.id !== target.id)).catch(() =>
              Alert.alert('Could not remove', 'Please try again.'),
            );
          },
        },
      ],
    );
  }

  const full = contacts.length >= MAX_EMERGENCY_CONTACTS;
  const unchecked = contacts.filter((c) => !c.whatsappCheckedAt).length;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Emergency contacts</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Who hears it when you press SOS</Text>
          <Text style={styles.introBody}>
            Up to {MAX_EMERGENCY_CONTACTS} people. Pressing SOS opens WhatsApp with a message
            already written — your live location, your driver, the car and the number plate —
            and you press send.
          </Text>
          <Text style={styles.introBody}>
            It goes{' '}
            <Text style={styles.bold}>from your own number</Text>, not from a Velocity number,
            so your family sees it is really you and can simply reply.
          </Text>
          <Text style={styles.introNote}>
            Everyone on this list must be on WhatsApp. Add them, then send the hello so you know
            the number works.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : contacts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>Nobody added yet</Text>
            <Text style={styles.emptyBody}>
              An SOS with no contacts still calls the police and still reaches us — but nobody
              who loves you is told. Add at least one.
            </Text>
          </View>
        ) : (
          contacts.map((c, i) => (
            <View key={c.id} style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{c.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName}>
                  {i + 1}. {c.name}
                </Text>
                <Text style={styles.rowPhone}>{formatPhone(c.phone)}</Text>
                {c.whatsappCheckedAt ? (
                  <Text style={styles.okBadge}>✓ WhatsApp confirmed</Text>
                ) : (
                  <Pressable onPress={() => void openWhatsApp(c)} hitSlop={6}>
                    <Text style={styles.warnBadge}>⚠ Not checked — tap to send a hello</Text>
                  </Pressable>
                )}
              </View>
              <Pressable onPress={() => removeContact(c)} hitSlop={10} style={styles.removeBtn}>
                <Text style={styles.removeTxt}>✕</Text>
              </Pressable>
            </View>
          ))
        )}

        {unchecked > 0 ? (
          <Text style={styles.uncheckedNote}>
            {unchecked} {unchecked === 1 ? 'contact has' : 'contacts have'} not been checked on
            WhatsApp yet. They will still be alerted — but if the number is wrong, nothing
            arrives.
          </Text>
        ) : null}

        {full ? (
          <Text style={styles.fullNote}>
            {MAX_EMERGENCY_CONTACTS} of {MAX_EMERGENCY_CONTACTS} — remove someone to add
            another.
          </Text>
        ) : (
          <PrimaryButton
            label={`+ Add contact (${contacts.length}/${MAX_EMERGENCY_CONTACTS})`}
            onPress={() => setAdding(true)}
          />
        )}

        <Text style={styles.footnote}>
          These numbers are stored on your own account and are never shown to drivers, to other
          riders, or to anyone else.
        </Text>
      </ScrollView>

      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <KeyboardAvoidingView
          style={styles.modalWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add an emergency contact</Text>

            <Pressable style={styles.pickBtn} onPress={() => void addFromPhonebook()}>
              <Text style={styles.pickTxt}>📒 Pick from my phone contacts</Text>
            </Pressable>

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ammi, Bhai, a friend…"
              placeholderTextColor={colors.muted}
              maxLength={40}
            />

            <Text style={styles.label}>WhatsApp number</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="0300 1234567"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              maxLength={20}
            />
            <Text style={styles.hint}>
              The number they use on WhatsApp. A number without WhatsApp will never get your
              SOS.
            </Text>

            <PrimaryButton label="Save contact" onPress={() => void addContact()} loading={saving} />
            <Pressable onPress={() => setAdding(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
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
    content: { padding: 16, paddingBottom: 48, gap: 10 },

    intro: {
      backgroundColor: colors.danger + '14',
      borderWidth: 1,
      borderColor: colors.danger + '55',
      borderRadius: 16,
      padding: 14,
      gap: 7,
    },
    introTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
    introBody: { fontSize: 12.5, color: colors.muted, lineHeight: 19 },
    introNote: { fontSize: 12, color: colors.danger, lineHeight: 18, fontWeight: '700' },
    bold: { fontWeight: '900', color: colors.text },

    empty: { alignItems: 'center', paddingVertical: 26, gap: 6 },
    emptyIcon: { fontSize: 34 },
    emptyTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
    emptyBody: {
      fontSize: 12.5,
      color: colors.muted,
      lineHeight: 19,
      textAlign: 'center',
      paddingHorizontal: 10,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 12,
    },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.primary + '22',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarTxt: { fontSize: 16, fontWeight: '900', color: colors.text },
    rowBody: { flex: 1, gap: 1 },
    rowName: { fontSize: 14.5, fontWeight: '800', color: colors.text },
    rowPhone: { fontSize: 12.5, color: colors.muted },
    okBadge: { fontSize: 11.5, color: colors.primary, fontWeight: '800', marginTop: 2 },
    warnBadge: { fontSize: 11.5, color: colors.danger, fontWeight: '800', marginTop: 2 },
    removeBtn: { padding: 6 },
    removeTxt: { fontSize: 16, color: colors.muted, fontWeight: '900' },

    uncheckedNote: {
      fontSize: 11.5,
      color: colors.danger,
      lineHeight: 17,
      fontWeight: '700',
      marginTop: 2,
    },
    fullNote: {
      fontSize: 12,
      color: colors.muted,
      textAlign: 'center',
      marginTop: 6,
      fontWeight: '700',
    },
    footnote: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 14, lineHeight: 17 },

    modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
    modalCard: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 18,
      paddingBottom: 28,
      gap: 8,
    },
    modalTitle: { fontSize: 17, fontWeight: '900', color: colors.text, marginBottom: 2 },
    pickBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      marginBottom: 4,
    },
    pickTxt: { fontSize: 13.5, fontWeight: '800', color: colors.text },
    label: { fontSize: 11.5, fontWeight: '900', color: colors.muted, textTransform: 'uppercase' },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.card,
    },
    hint: { fontSize: 11.5, color: colors.muted, lineHeight: 17, marginBottom: 6 },
    cancelBtn: { alignItems: 'center', paddingVertical: 12 },
    cancelTxt: { fontSize: 14, fontWeight: '800', color: colors.muted },
  }),
);
