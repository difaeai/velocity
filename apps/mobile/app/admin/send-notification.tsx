import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors } from '../../src/config';
import { api } from '../../src/api/client';

type Target = 'all' | 'passengers' | 'drivers';
type NotifType = 'system' | 'promo' | 'ride' | 'wallet';

const TARGETS: { key: Target; label: string; desc: string; icon: string }[] = [
  { key: 'all',        label: 'All Users',    desc: 'Every registered user',     icon: '👥' },
  { key: 'passengers', label: 'Passengers',   desc: 'Users with passenger role', icon: '🙋' },
  { key: 'drivers',    label: 'Drivers',      desc: 'Users with driver role',    icon: '🚗' },
];

const TYPES: { key: NotifType; label: string; icon: string; color: string }[] = [
  { key: 'system', label: 'System',     icon: 'ℹ️',  color: '#8b5cf6' },
  { key: 'promo',  label: 'Promotion',  icon: '🎁',  color: '#f59e0b' },
  { key: 'ride',   label: 'Ride',       icon: '🚗',  color: '#3b82f6' },
  { key: 'wallet', label: 'Wallet',     icon: '💳',  color: '#10b981' },
];

export default function SendNotificationScreen() {
  const router = useRouter();
  const [title, setTitle]   = useState('');
  const [body, setBody]     = useState('');
  const [target, setTarget] = useState<Target>('all');
  const [type, setType]     = useState<NotifType>('system');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ sent: number } | null>(null);

  const selectedType = TYPES.find(t => t.key === type)!;

  async function send() {
    if (!title.trim()) { Alert.alert('Missing Title', 'Enter a notification title.'); return; }
    if (!body.trim())  { Alert.alert('Missing Message', 'Enter a notification message.'); return; }

    Alert.alert(
      'Send Notification',
      `Send "${title.trim()}" to ${TARGETS.find(t => t.key === target)!.label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: async () => {
          setSending(true);
          setLastResult(null);
          try {
            const res = await api.adminSendPushNotification({
              title: title.trim(),
              body:  body.trim(),
              type,
              target,
            });
            setLastResult({ sent: res.sent });
            setTitle('');
            setBody('');
            Alert.alert('Sent! ✅', `Notification delivered to ${res.sent} user${res.sent !== 1 ? 's' : ''}.`);
          } catch (e: unknown) {
            Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to send notification.');
          } finally {
            setSending(false);
          }
        }},
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin'))}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Send Notification</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Last result */}
        {lastResult && (
          <View style={styles.resultBanner}>
            <Text style={styles.resultTxt}>✅ Last sent: {lastResult.sent} users notified</Text>
          </View>
        )}

        {/* Preview */}
        <View style={styles.previewCard}>
          <Text style={styles.previewHeader}>NOTIFICATION PREVIEW</Text>
          <View style={styles.previewBody}>
            <View style={[styles.previewIcon, { backgroundColor: selectedType.color + '25', borderColor: selectedType.color + '50' }]}>
              <Text style={styles.previewIconTxt}>{selectedType.icon}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.previewTitle} numberOfLines={1}>{title || 'Notification title'}</Text>
              <Text style={styles.previewBody2} numberOfLines={2}>{body || 'Notification message will appear here…'}</Text>
            </View>
          </View>
        </View>

        {/* Title */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>TITLE</Text>
          <TextInput
            style={styles.fieldInput}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. New Feature Available!"
            placeholderTextColor={colors.muted}
            maxLength={100}
          />
          <Text style={styles.charCount}>{title.length}/100</Text>
        </View>

        {/* Body */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>MESSAGE</Text>
          <TextInput
            style={[styles.fieldInput, styles.fieldInputMulti]}
            value={body}
            onChangeText={setBody}
            placeholder="Enter the notification message…"
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={4}
            maxLength={500}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{body.length}/500</Text>
        </View>

        {/* Target audience */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TARGET AUDIENCE</Text>
          <View style={styles.optionsList}>
            {TARGETS.map(t => (
              <Pressable
                key={t.key}
                style={[styles.optionRow, target === t.key && styles.optionRowActive]}
                onPress={() => setTarget(t.key)}
              >
                <View style={styles.optionLeft}>
                  <Text style={styles.optionIcon}>{t.icon}</Text>
                  <View>
                    <Text style={[styles.optionLabel, target === t.key && { color: colors.primary }]}>{t.label}</Text>
                    <Text style={styles.optionDesc}>{t.desc}</Text>
                  </View>
                </View>
                <View style={[styles.radio, target === t.key && styles.radioActive]}>
                  {target === t.key && <View style={styles.radioInner} />}
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Type */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>NOTIFICATION TYPE</Text>
          <View style={styles.typeGrid}>
            {TYPES.map(t => (
              <Pressable
                key={t.key}
                style={[styles.typeChip, type === t.key && { borderColor: t.color, backgroundColor: t.color + '15' }]}
                onPress={() => setType(t.key)}
              >
                <Text style={styles.typeChipIcon}>{t.icon}</Text>
                <Text style={[styles.typeChipLabel, type === t.key && { color: t.color }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Warning */}
        <View style={styles.warningBox}>
          <Text style={styles.warningTxt}>
            ⚠️  This sends a push notification and writes an in-app notification for every targeted user. Use sparingly — overuse will cause users to disable notifications.
          </Text>
        </View>

        {/* Send button */}
        <Pressable
          style={[styles.sendBtn, (!title.trim() || !body.trim() || sending) && { opacity: 0.5 }]}
          onPress={send}
          disabled={!title.trim() || !body.trim() || sending}
        >
          {sending
            ? <><ActivityIndicator color="#000" /><Text style={styles.sendBtnTxt}>  Sending…</Text></>
            : <Text style={styles.sendBtnTxt}>Send Notification 🚀</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40 },
  backTxt: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  content: { padding: 16, gap: 16, paddingBottom: 40 },

  resultBanner: { backgroundColor: '#10b98115', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#10b98130' },
  resultTxt: { fontSize: 13, fontWeight: '700', color: '#10b981', textAlign: 'center' },

  previewCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  previewHeader: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  previewBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  previewIconTxt: { fontSize: 20 },
  previewTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  previewBody2: { fontSize: 13, color: colors.muted, lineHeight: 18 },

  field: { gap: 8 },
  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  fieldInput: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.text },
  fieldInputMulti: { height: 100, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: colors.muted, textAlign: 'right' },

  section: { gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  optionsList: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionRowActive: { backgroundColor: '#1a2010' },
  optionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionIcon: { fontSize: 20 },
  optionLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  optionDesc: { fontSize: 12, color: colors.muted },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },

  typeGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  typeChip: { flex: 1, minWidth: '40%', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, alignItems: 'center', gap: 4 },
  typeChipIcon: { fontSize: 22 },
  typeChipLabel: { fontSize: 12, fontWeight: '700', color: colors.muted },

  warningBox: { backgroundColor: '#f59e0b15', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#f59e0b30' },
  warningTxt: { fontSize: 12, color: '#f59e0b', lineHeight: 18 },

  sendBtn: { flexDirection: 'row', height: 54, backgroundColor: colors.primary, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 8 },
  sendBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },
});
