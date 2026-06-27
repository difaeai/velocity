import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '../config';

interface Props {
  visible:     boolean;
  targetLabel: string; // "Rate your driver" | "Rate your passenger"
  targetName:  string;
  onSubmit:    (stars: number, comment: string) => Promise<void>;
  onSkip:      () => void;
}

export function RatingModal({ visible, targetLabel, targetName, onSubmit, onSkip }: Props) {
  const [stars,   setStars]   = useState(0);
  const [comment, setComment] = useState('');
  const [busy,    setBusy]    = useState(false);

  const starLabels = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

  async function handleSubmit() {
    if (stars === 0) return;
    setBusy(true);
    try {
      await onSubmit(stars, comment);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStars(0);
    setComment('');
    setBusy(false);
  }

  function handleSkip() {
    reset();
    onSkip();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleSkip}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.label}>{targetLabel}</Text>
          <Text style={styles.name}>{targetName}</Text>

          {/* Star row */}
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable key={s} onPress={() => setStars(s)} hitSlop={8}>
                <Text style={[styles.star, s <= stars && styles.starOn]}>★</Text>
              </Pressable>
            ))}
          </View>
          {stars > 0 && <Text style={styles.starLabel}>{starLabels[stars]}</Text>}

          {/* Comment */}
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Leave a comment (optional)"
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
            numberOfLines={3}
            maxLength={300}
          />

          <Pressable
            style={[styles.submitBtn, (stars === 0 || busy) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={stars === 0 || busy}
          >
            <Text style={styles.submitBtnText}>
              {busy ? 'Submitting…' : 'Submit rating'}
            </Text>
          </Pressable>

          <Pressable style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    gap: 14,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  name: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 6,
  },
  star: {
    fontSize: 40,
    color: colors.border,
  },
  starOn: {
    color: '#f59e0b',
  },
  starLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f59e0b',
    textAlign: 'center',
    marginTop: -6,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  skipText: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '600',
  },
});
