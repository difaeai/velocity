/**
 * Chat management — the sheet every Travel Partner conversation hangs off.
 *
 * Two pieces, deliberately in one file because they are never used apart:
 *
 *   <ChatMenuSheet>   the ⋮ menu: the actions you can take on a conversation
 *                     or on one person in it.
 *   <ReportSheet>     pick a reason, add detail, optionally block them too.
 *
 * Both are presentational. The screens own the API calls, because what
 * "leave" means differs between a 1:1 (the thread closes) and a group (you
 * lose membership), and hiding that difference behind a shared component would
 * make the two screens lie about what the button does.
 *
 * NOT used by the trip chat. A booked ride is not a conversation you can walk
 * out of — the rider and driver need to reach each other until the trip ends,
 * and safety there runs through SOS and the disputes desk instead.
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text, TextInput } from './Text';
import { REPORT_REASONS, type ReportCategory } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';

// ── Menu ─────────────────────────────────────────────────────────────────────

export interface ChatMenuAction {
  id: string;
  icon: string;
  label: string;
  /** Shown under the label — say what the action actually does. */
  hint?: string;
  destructive?: boolean;
  onPress: () => void;
}

export function ChatMenuSheet({
  visible,
  title,
  subtitle,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: ChatMenuAction[];
  onClose: () => void;
}) {
  /**
   * The action to run once this sheet is actually gone.
   *
   * Report opens a second Modal, and iOS refuses to present one while another
   * is still dismissing — firing both in the same tick loses the report sheet
   * with no error anywhere. So the menu closes first and the action runs on
   * `onDismiss`. Android has no such restriction and no `onDismiss`, so there
   * it runs straight away rather than never.
   */
  const pending = useRef<(() => void) | null>(null);

  function flush() {
    const run = pending.current;
    pending.current = null;
    run?.();
  }

  function choose(action: ChatMenuAction) {
    pending.current = action.onPress;
    onClose();
    if (Platform.OS !== 'ios') flush();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={flush}
    >
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.sheetSub} numberOfLines={1}>{subtitle}</Text> : null}

          <View style={s.actionList}>
            {actions.map(a => (
              <Pressable
                key={a.id}
                style={s.actionRow}
                onPress={() => choose(a)}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                <View style={[s.actionIcon, a.destructive && s.actionIconDanger]}>
                  <Text style={{ fontSize: 17 }}>{a.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.actionLabel, a.destructive && { color: colors.danger }]}>{a.label}</Text>
                  {a.hint ? <Text style={s.actionHint}>{a.hint}</Text> : null}
                </View>
              </Pressable>
            ))}
          </View>

          <Pressable style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface ReportSubmission {
  category: ReportCategory;
  reason: string;
  alsoBlock: boolean;
}

/**
 * The report sheet.
 *
 * A category is required and free text is not: a queue sorted by eight known
 * reasons is triageable, and demanding a written statement from someone who
 * has just been harassed is a reason not to report at all. "Block them too" is
 * on by default — someone bad enough to report is someone you almost always
 * want gone, and the person can still switch it off.
 */
export function ReportSheet({
  visible,
  personName,
  /** Groups have no block-and-close semantics for the room, only for the person. */
  blockLabel = 'Also block this person',
  submitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  personName: string;
  blockLabel?: string;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (submission: ReportSubmission) => void;
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [detail, setDetail] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);

  function close() {
    setCategory(null);
    setDetail('');
    setAlsoBlock(true);
    onClose();
  }

  function submit() {
    if (!category || submitting) return;
    onSubmit({ category, reason: detail.trim(), alsoBlock });
    setCategory(null);
    setDetail('');
    setAlsoBlock(true);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={s.overlay} onPress={close}>
          <Pressable style={[s.sheet, s.reportSheet]} onPress={() => {}}>
            <View style={s.grabber} />
            <Text style={s.sheetTitle}>Report {personName}</Text>
            <Text style={s.sheetSub}>
              Our safety team reviews every report. {personName} is never told who reported them.
            </Text>

            <ScrollView
              style={s.reasonScroll}
              contentContainerStyle={{ paddingBottom: 6 }}
              keyboardShouldPersistTaps="handled"
            >
              {REPORT_REASONS.map(r => {
                const on = category === r.id;
                return (
                  <Pressable
                    key={r.id}
                    style={[s.reasonRow, on && s.reasonRowOn]}
                    onPress={() => setCategory(r.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <View style={[s.radio, on && s.radioOn]}>
                      {on ? <View style={s.radioDot} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.reasonLabel, on && { color: colors.primary }]}>{r.label}</Text>
                      <Text style={s.reasonHint}>{r.hint}</Text>
                    </View>
                  </Pressable>
                );
              })}

              <TextInput
                value={detail}
                onChangeText={setDetail}
                placeholder="Add anything that would help us (optional)"
                placeholderTextColor={colors.muted}
                style={s.detailInput}
                multiline
                maxLength={1000}
              />
            </ScrollView>

            <Pressable
              style={s.blockToggleRow}
              onPress={() => setAlsoBlock(v => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: alsoBlock }}
            >
              <View style={[s.checkbox, alsoBlock && s.checkboxOn]}>
                {alsoBlock ? <Text style={s.checkboxTick}>✓</Text> : null}
              </View>
              <Text style={s.blockToggleText}>{blockLabel}</Text>
            </Pressable>

            <View style={s.reportBtns}>
              <Pressable style={s.ghostBtn} onPress={close} disabled={submitting}>
                <Text style={s.ghostBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.dangerBtn, (!category || submitting) && { opacity: 0.45 }]}
                onPress={submit}
                disabled={!category || submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.dangerBtnText}>Send report</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themed(() => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 26,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  reportSheet: { maxHeight: '88%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  sheetSub: { fontSize: 12.5, color: colors.muted, marginTop: 4, lineHeight: 18 },

  actionList: { marginTop: 14, gap: 2 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  actionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.glassChip, alignItems: 'center', justifyContent: 'center' },
  actionIconDanger: { backgroundColor: `${colors.danger}1f` },
  actionLabel: { fontSize: 15.5, fontWeight: '800', color: colors.text },
  actionHint: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },

  cancelBtn: { marginTop: 10, height: 50, borderRadius: 15, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: '800', color: colors.muted },

  reasonScroll: { marginTop: 14 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  reasonRowOn: { borderColor: colors.primary, backgroundColor: `${colors.primary}12` },
  radio: { width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  reasonLabel: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  reasonHint: { fontSize: 11.5, color: colors.muted, marginTop: 2, lineHeight: 16 },

  detailInput: {
    marginTop: 12,
    minHeight: 84,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    color: colors.text,
    fontSize: 14,
    textAlignVertical: 'top',
  },

  blockToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkboxTick: { fontSize: 13, fontWeight: '900', color: '#000' },
  blockToggleText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },

  reportBtns: { flexDirection: 'row', gap: 12 },
  ghostBtn: { flex: 1, height: 50, borderRadius: 15, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontSize: 15, fontWeight: '800', color: colors.muted },
  dangerBtn: { flex: 1.4, height: 50, borderRadius: 15, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  dangerBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
}));
