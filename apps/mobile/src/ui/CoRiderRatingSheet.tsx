/**
 * Rate the people you shared the car with.
 * ----------------------------------------------------------------------------
 * The driver rating sheet next door (RatingModal) rates one person, and that
 * shape does not stretch: a shared ride can have three other people in it, and
 * stacking three modals or asking the rider to come back twice would mean
 * almost nobody rated anybody. So this is one sheet that walks the car —
 * "1 of 3", a tap, next — and lets the rider leave at any point.
 *
 * Two deliberate choices about how this behaves:
 *
 *   • It never nags. Every rider can be skipped, the sheet can be dismissed
 *     whole, and nothing is blocked by not rating. A rating extracted from
 *     somebody trying to get rid of a modal is not information.
 *   • It says nothing about what the rating will do. It is anonymous to its
 *     subject (see the backend's ratings/coRiders) and the honest way to convey
 *     that is the one line under the title, not a reassurance nobody reads.
 *
 * The per-rider star state is reset as the sheet advances, so a four-star tap
 * for the first person is never carried into the second.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from './Text';

import { colors } from '../config';
import { themed } from '../theme';

export interface CoRiderTarget {
  uid: string;
  firstName: string;
  gender: string;
  alreadyRated: boolean;
  /** Null when too few people have rated them to show a number. */
  coRiderRating: number | null;
  coRiderRatingCount: number;
}

interface Props {
  visible: boolean;
  targets: CoRiderTarget[];
  /** Resolves when the rating is stored; the sheet then advances by itself. */
  onSubmit: (target: CoRiderTarget, stars: number, comment: string) => Promise<void>;
  onClose: () => void;
}

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export function CoRiderRatingSheet({ visible, targets, onSubmit, onClose }: Props) {
  const [queue, setQueue] = useState<CoRiderTarget[]>([]);
  const [index, setIndex] = useState(0);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /**
   * The car is snapshotted when the sheet opens, and walked by index from there.
   *
   * Deliberately not re-derived from `targets` on every render: the screen
   * above marks each rider as rated the moment their rating is stored, so a
   * live-derived queue would shrink under the person using it — "2 of 3" would
   * renumber itself mid-tap, and the shrinking list would race the advance,
   * which is how somebody gets skipped.
   *
   * Adjusted during render rather than in an effect, which is React's
   * documented way to respond to a changed input and the same pattern
   * lib/cachedResource.ts uses: in an effect this would paint one frame of the
   * PREVIOUS ride's queue before correcting itself.
   */
  const [openFor, setOpenFor] = useState(false);
  if (visible !== openFor) {
    setOpenFor(visible);
    if (visible) {
      setQueue(targets.filter((t) => !t.alreadyRated));
      setIndex(0);
      setStars(0);
      setComment('');
      setError('');
    }
  }

  const pending = queue;
  const current = pending[index];

  function advance() {
    setStars(0);
    setComment('');
    setError('');
    if (index + 1 >= pending.length) {
      onClose();
      return;
    }
    setIndex(index + 1);
  }

  async function handleSubmit() {
    if (!current || stars === 0) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(current, stars, comment);
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that rating.');
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;

  const standing =
    current.coRiderRating !== null
      ? `${current.coRiderRating.toFixed(1)} ★ from ${current.coRiderRatingCount} riders`
      : 'New to ride sharing';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.label}>Rate who you rode with</Text>
          <Text style={styles.name}>{current.firstName}</Text>
          <Text style={styles.standing}>{standing}</Text>
          {pending.length > 1 ? (
            <Text style={styles.progress}>
              {index + 1} of {pending.length}
            </Text>
          ) : null}

          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable key={s} onPress={() => setStars(s)} hitSlop={8} disabled={busy}>
                <Text style={[styles.star, s <= stars && styles.starOn]}>★</Text>
              </Pressable>
            ))}
          </View>
          {stars > 0 ? <Text style={styles.starLabel}>{STAR_LABELS[stars]}</Text> : null}

          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Add a note for Velocity Rides (optional)"
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
            numberOfLines={3}
            maxLength={300}
            editable={!busy}
          />

          {/* Said plainly, because a rider deciding how honest to be is
              entitled to know who will see it. */}
          <Text style={styles.privacy}>
            {current.firstName} will not see your rating or your note, and will not be told who
            rated them.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.submitBtn, (stars === 0 || busy) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={stars === 0 || busy}
          >
            {busy ? (
              <ActivityIndicator color="#0b0b0b" />
            ) : (
              <Text style={styles.submitBtnText}>
                {index + 1 >= pending.length ? 'Submit rating' : 'Submit and next'}
              </Text>
            )}
          </Pressable>

          <View style={styles.skipRow}>
            <Pressable style={styles.skipBtn} onPress={advance} disabled={busy} hitSlop={6}>
              <Text style={styles.skipText}>
                {index + 1 >= pending.length ? 'Not now' : 'Skip this rider'}
              </Text>
            </Pressable>
            {pending.length > 1 && index + 1 < pending.length ? (
              <Pressable style={styles.skipBtn} onPress={onClose} disabled={busy} hitSlop={6}>
                <Text style={styles.skipText}>Skip all</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
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
    paddingBottom: 32,
    gap: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 6,
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
  standing: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.muted,
    textAlign: 'center',
    marginTop: -6,
  },
  progress: {
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    marginTop: -4,
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 2,
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
    marginTop: -8,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    fontSize: 14,
    minHeight: 68,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
  },
  privacy: {
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.muted,
    textAlign: 'center',
  },
  error: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.danger,
    textAlign: 'center',
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
    color: '#0b0b0b',
    fontSize: 16,
    fontWeight: '800',
  },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
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
}));
