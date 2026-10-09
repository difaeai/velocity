/**
 * "Who will you share a car with?" — the home-screen selector.
 *
 * This is the one place the question is asked, and the answer governs every
 * shared ride in the app: which pools appear in Suggested Rides, which ones the
 * booking flow offers, which en-route pickups a driver may add this rider to,
 * and which joins the server will accept. See `useGenderPref`.
 *
 * It sits between "Where to?" and Suggested Rides because that is the order the
 * decisions happen in: who you will travel with narrows what is worth showing
 * you, so it has to be answerable BEFORE the list of pools, not buried on the
 * screen that renders the list.
 *
 * Unanswered, the card is lime-edged and says so in full — a rider who has not
 * chosen is silently treated as same-gender-only, and being quietly shown half
 * the feed is worse than being asked one question. Answered, it collapses to a
 * line that reports the standing choice and stays tappable to change it.
 */
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors } from '../config';
import { themed } from '../theme';
import {
  sameGenderLabel,
  useGenderPref,
  type SharedRideGenderPref,
} from '../hooks/genderPref';
import { Text } from './Text';
import { PoolIcon } from './RideIcons';

/** The prompt, repeated verbatim under "Where to?" so it cannot be missed. */
export const GENDER_PREF_PROMPT =
  'Please choose your preference of gender for the shared rides';

export function SharedRideGenderCard() {
  const router = useRouter();
  const { loaded, pref, gender, saving, choose } = useGenderPref();

  // Nothing is prompted until the profile has actually been read: flashing
  // "choose a preference" at someone who chose months ago is a bug, not a nudge.
  if (!loaded) return null;

  const chosen = pref !== null;
  const unknownGender = gender !== 'male' && gender !== 'female';

  async function pick(next: SharedRideGenderPref) {
    // Same-gender only is meaningless until we know which gender that is, and
    // the server agrees — an unspecified rider is offered empty open pools only.
    if (next === 'same_gender' && unknownGender) {
      Alert.alert(
        'Set your gender first',
        'Same-gender sharing needs to know your gender. Add it to your profile and '
          + 'this preference will apply to every shared ride.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open profile', onPress: () => router.push('/passenger/profile') },
        ],
      );
      return;
    }
    try {
      await choose(next);
    } catch {
      Alert.alert('Could not save preference', 'Please try again.');
    }
  }

  return (
    <View style={[styles.card, !chosen && styles.cardPrompting]}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <PoolIcon size={18} color={colors.primary} accent={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Who will you share with?</Text>
          <Text style={styles.sub}>
            {chosen
              ? 'Applies to every shared ride, pool and pickup'
              : GENDER_PREF_PROMPT}
          </Text>
        </View>
        {!chosen ? (
          <View style={styles.pill}>
            <Text style={styles.pillTxt}>CHOOSE</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.options}>
        <Option
          label={sameGenderLabel(gender)}
          sub="Only riders of my gender"
          on={pref === 'same_gender'}
          disabled={saving}
          onPress={() => void pick('same_gender')}
        />
        <Option
          label="♂♀ Any gender"
          sub="I'm open to mixed rides"
          on={pref === 'any_gender'}
          disabled={saving}
          onPress={() => void pick('any_gender')}
        />
      </View>

      {unknownGender ? (
        <Pressable onPress={() => router.push('/passenger/profile')}>
          <Text style={styles.hint}>
            Your profile has no gender set — add it so same-gender rides can be matched →
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Option({
  label,
  sub,
  on,
  disabled,
  onPress,
}: {
  label: string;
  sub: string;
  on: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      accessibilityLabel={`${label} — ${sub}`}
    >
      <View style={styles.optionTop}>
        <View style={[styles.radio, on && styles.radioOn]}>
          {on ? <View style={styles.radioDot} /> : null}
        </View>
        <Text style={[styles.optionLabel, on && styles.optionLabelOn]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.optionSub} numberOfLines={1}>{sub}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 10,
  },
  /* Unanswered: the same lime edge Suggested Rides uses, because until this is
     answered that list is showing a filtered view nobody asked for. */
  cardPrompting: {
    backgroundColor: colors.glassLime,
    borderColor: colors.glassLimeBorder,
  },

  head: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassLime,
  },
  title: { color: colors.text, fontSize: 14.5, fontWeight: '900' },
  sub: { color: colors.muted, fontSize: 11.5, fontWeight: '600', marginTop: 1, lineHeight: 15 },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  pillTxt: { color: colors.btnText, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6 },

  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    gap: 3,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glassChip,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  radio: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  optionLabel: { flex: 1, color: colors.muted, fontSize: 12.5, fontWeight: '800' },
  optionLabelOn: { color: colors.text },
  optionSub: { color: colors.muted, fontSize: 10, fontWeight: '600' },

  hint: { color: colors.primary, fontSize: 10.5, fontWeight: '700', lineHeight: 14 },
}));
