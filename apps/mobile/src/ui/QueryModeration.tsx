/**
 * Report and block, for a Queries conversation — used by both sides.
 *
 *   QueryActionsSheet  the ⋯ menu: Report, and Block or Unblock
 *   ReportSheet        why, and whether to block in the same step
 *   ClosedBar          what replaces the composer when nobody can write
 *
 * A block is per business × customer, not per offer (backend
 * businessAds/moderation.ts), so the wording talks about the person, not the
 * conversation. A customer blocking a business also stops its offers.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import type { BusinessAdQueryReportReason } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { Text } from './Text';

const REASONS: { key: BusinessAdQueryReportReason; label: string }[] = [
  { key: 'spam', label: 'Spam or repeated messages' },
  { key: 'abusive', label: 'Abusive or threatening' },
  { key: 'scam', label: 'Scam or asking for money' },
  { key: 'inappropriate', label: 'Inappropriate content' },
  { key: 'other', label: 'Something else' },
];

export function QueryActionsSheet({
  visible,
  name,
  blocked,
  onClose,
  onReport,
  onBlock,
  onUnblock,
}: {
  visible: boolean;
  name: string;
  blocked: boolean;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Text style={s.title}>{name}</Text>
          <Pressable style={s.row} onPress={onReport}>
            <Text style={s.icon}>🚩</Text>
            <Text style={s.rowTxt}>Report</Text>
          </Pressable>
          {blocked ? (
            <Pressable style={s.row} onPress={onUnblock}>
              <Text style={s.icon}>✅</Text>
              <Text style={s.rowTxt}>Unblock</Text>
            </Pressable>
          ) : (
            <Pressable style={s.row} onPress={onBlock}>
              <Text style={s.icon}>⛔</Text>
              <Text style={[s.rowTxt, { color: colors.danger }]}>Block</Text>
            </Pressable>
          )}
          <Pressable style={s.cancel} onPress={onClose}>
            <Text style={s.cancelTxt}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ReportSheet({
  visible,
  name,
  alreadyBlocked,
  sending,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  name: string;
  alreadyBlocked: boolean;
  sending: boolean;
  onClose: () => void;
  onSubmit: (reason: BusinessAdQueryReportReason, block: boolean) => void;
}) {
  const [reason, setReason] = useState<BusinessAdQueryReportReason | null>(null);
  const [block, setBlock] = useState(true);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.title}>Report {name}</Text>
          <Text style={s.sub}>
            Velocity Rides will see the recent messages in this conversation. {name} isn’t told who
            reported them.
          </Text>
          {REASONS.map((r) => (
            <Pressable key={r.key} style={s.option} onPress={() => setReason(r.key)}>
              <View style={[s.radio, reason === r.key && s.on]}>
                {reason === r.key ? <View style={s.dot} /> : null}
              </View>
              <Text style={s.rowTxt}>{r.label}</Text>
            </Pressable>
          ))}
          {!alreadyBlocked ? (
            <Pressable style={s.option} onPress={() => setBlock((v) => !v)}>
              <View style={[s.check, block && s.on]}>
                {block ? <Text style={s.tick}>✓</Text> : null}
              </View>
              <Text style={s.rowTxt}>Also block {name}</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[s.submit, (!reason || sending) && { opacity: 0.4 }]}
            disabled={!reason || sending}
            onPress={() => reason && onSubmit(reason, !alreadyBlocked && block)}
          >
            <Text style={s.submitTxt}>{sending ? 'Sending…' : 'Send report'}</Text>
          </Pressable>
          <Pressable style={s.cancel} onPress={onClose}>
            <Text style={s.cancelTxt}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function ClosedBar({
  title,
  body,
  actionLabel,
  onAction,
  busy,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  return (
    <View style={s.closed}>
      <Text style={s.closedTitle}>{title}</Text>
      <Text style={s.closedBody}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable style={s.closedBtn} onPress={onAction} disabled={busy}>
          <Text style={s.closedBtnTxt}>{busy ? '…' : actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    paddingBottom: 30,
    gap: 2,
  },
  title: { fontSize: 17, fontWeight: '900', color: colors.text, marginBottom: 6 },
  sub: { fontSize: 12, fontWeight: '600', color: colors.muted, lineHeight: 17, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  icon: { fontSize: 18, width: 24, textAlign: 'center' },
  rowTxt: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelTxt: { fontSize: 14, fontWeight: '800', color: colors.muted },

  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  tick: { fontSize: 13, fontWeight: '900', color: colors.primary },
  submit: {
    marginTop: 10,
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitTxt: { fontSize: 15, fontWeight: '900', color: '#ffffff' },

  closed: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
    alignItems: 'center',
  },
  closedTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  closedBody: { fontSize: 12, fontWeight: '600', color: colors.muted, textAlign: 'center', lineHeight: 17 },
  closedBtn: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  closedBtnTxt: { fontSize: 13, fontWeight: '900', color: colors.primary },
}));
