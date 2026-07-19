/**
 * "Report request" sheet — a driver flags a fake or abusive ride request.
 *
 * At least one reason chip is required (the backend enforces the same rule);
 * the free-text box is optional. Submitting calls `reportOpenRequest`, which
 * is deliberately separate from `createDispute`: the driver never accepted
 * this trip, so they are not a participant and the dispute guard would reject
 * them.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { REPORT_REASON_LABELS, type ReportReason } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';

const REASONS = Object.keys(REPORT_REASON_LABELS) as ReportReason[];

interface Props {
  visible: boolean;
  submitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (reasons: ReportReason[], description: string) => void;
}

export function ReportRequestModal({ visible, submitting, error, onClose, onSubmit }: Props) {
  const [reasons, setReasons] = useState<ReportReason[]>([]);
  const [description, setDescription] = useState('');

  const toggle = (r: ReportReason) =>
    setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const reset = () => {
    setReasons([]);
    setDescription('');
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.header}>
              <Text style={styles.title}>Report request</Text>
              <Pressable onPress={close} hitSlop={12} style={styles.closeBtn}>
                <Text style={styles.closeTxt}>✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={styles.lead}>
                Please describe in detail what&apos;s wrong with this request
              </Text>

              <View style={styles.chips}>
                {REASONS.map((r) => {
                  const on = reasons.includes(r);
                  return (
                    <Pressable
                      key={r}
                      onPress={() => toggle(r)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>
                        {REPORT_REASON_LABELS[r]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>What happened?</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={1000}
                style={styles.input}
                placeholder="Add any detail that helps us review this"
                placeholderTextColor={colors.muted}
                textAlignVertical="top"
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>

            <View style={styles.footer}>
              <Pressable
                style={[styles.submit, (reasons.length === 0 || submitting) && styles.submitOff]}
                disabled={reasons.length === 0 || submitting}
                onPress={() => onSubmit(reasons, description.trim())}
              >
                {submitting ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.submitTxt}>Send report</Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  flex:     { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    height: '92%',
    backgroundColor: '#1c1e1d',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  title:    { fontSize: 20, fontWeight: '800', color: colors.text },
  closeBtn: {
    position: 'absolute',
    right: 18,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: { fontSize: 15, fontWeight: '700', color: colors.text },

  body: { paddingHorizontal: 18, paddingBottom: 24, gap: 14 },
  lead: { fontSize: 17, fontWeight: '600', color: colors.text, lineHeight: 24 },

  chips:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.glassStrong,
  },
  chipOn:    { backgroundColor: colors.primary },
  chipTxt:   { fontSize: 15, fontWeight: '600', color: colors.text },
  chipTxtOn: { color: '#000', fontWeight: '800' },

  label: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 6 },
  input: {
    minHeight: 110,
    borderRadius: 14,
    backgroundColor: colors.glassStrong,
    padding: 14,
    color: colors.text,
    fontSize: 15,
  },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },

  footer: { padding: 18, paddingTop: 8 },
  submit: {
    height: 58,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitOff: { opacity: 0.4 },
  submitTxt: { fontSize: 18, fontWeight: '900', color: '#000' },
}));
