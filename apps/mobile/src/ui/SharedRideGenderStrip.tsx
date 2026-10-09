/**
 * "Who will you share with?" — the one place the question is asked.
 *
 * The answer governs every shared ride in the app: which shared cars appear in
 * the home tiles, which ones the booking flow offers, which en-route pickups a
 * driver may add this rider to, and which joins the server will accept. See
 * `useGenderPref`.
 *
 * WHERE IT SITS, and why it has moved twice. It began as a full card between
 * "Where to?" and the shared-ride list, then as a strip welded to the bottom of
 * the "Where to?" card itself. Both put it in the path of someone booking a
 * SOLO ride, who is never going to share a car with anybody and has no reason
 * to answer it — a question with no bearing on what they are doing, in the way
 * of the button they came to press.
 *
 * So it lives in the shared-rides section instead, under the tiles it actually
 * governs, and says so in as many words. A rider who only ever rides alone can
 * ignore it forever; a rider looking at shared seats finds it beside them.
 *
 * Unanswered, it goes lime and says the sentence in full — a rider who has not
 * chosen is treated as same-gender-only, and being quietly shown half the
 * shared-ride feed is worse than being asked one question. Answered, it reports
 * the standing choice and stays tappable to change it.
 *
 * The colours are light-on-dark literals rather than theme tokens because the
 * home sheet this sits in is dark in BOTH themes: `colors.text` would turn
 * near-black on it in light mode, and `colors.primary` would darken the brand
 * lime to olive.
 */
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { themed } from '../theme';
import {
  sameGenderLabel,
  useGenderPref,
  type SharedRideGenderPref,
} from '../hooks/genderPref';
import { Text } from './Text';

/** Brand lime, fixed: see the note on the colours at the top of this file. */
const LIME = '#ccff00';

/** The prompt, said in full until the question has actually been answered. */
const GENDER_PREF_PROMPT =
  'Choose who you are willing to share a car with before you take a shared seat';

export function SharedRideGenderStrip() {
  const router = useRouter();
  const { loaded, pref, gender, saving, choose } = useGenderPref();

  // Nothing is prompted until the profile has actually been read: flashing
  // "choose a preference" at someone who chose months ago is a bug, not a nudge.
  if (!loaded) return null;

  const chosen = pref !== null;
  const unknownGender = gender !== 'male' && gender !== 'female';

  async function pick(next: SharedRideGenderPref) {
    // Same-gender only is meaningless until we know which gender that is, and
    // the server agrees — a rider with no gender (or "Other") is offered empty
    // open shared rides only.
    if (next === 'same_gender' && unknownGender) {
      Alert.alert(
        'Set your gender first',
        'Same-gender sharing needs to know whether to seat you with men or with women. '
          + 'Set it on your profile and this preference will apply to every shared ride.',
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
    <View style={[styles.strip, !chosen && styles.stripPrompting]}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Who will you share with?</Text>
          {/* Says plainly what it does and does not touch. Riding alone needs
              no answer here, and nobody should have to work that out. */}
          <Text style={[styles.sub, !chosen && styles.subPrompt]} numberOfLines={2}>
            {chosen
              ? 'Shared rides only — riding solo is unaffected'
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
          on={pref === 'same_gender'}
          disabled={saving}
          onPress={() => void pick('same_gender')}
        />
        <Option
          label="♂♀ Any gender"
          on={pref === 'any_gender'}
          disabled={saving}
          onPress={() => void pick('any_gender')}
        />
      </View>

      {/* Two different situations, and telling them apart matters: signup
          offers Male / Female / Other, and someone who deliberately chose
          "Other" is not someone who left the field empty. Both block
          same-gender matching — the server seats by male/female — but only one
          of them is missing information. */}
      {unknownGender ? (
        <Pressable onPress={() => router.push('/passenger/profile')}>
          <Text style={styles.hint}>
            {gender === 'other'
              ? 'Same-gender matching needs male or female — change it on your profile, or share with any gender →'
              : 'Your profile has no gender set — add it so same-gender rides can be matched →'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Option({
  label,
  on,
  disabled,
  onPress,
}: {
  label: string;
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
      accessibilityLabel={label}
    >
      <View style={[styles.radio, on && styles.radioOn]}>
        {on ? <View style={styles.radioDot} /> : null}
      </View>
      <Text style={[styles.optionLabel, on && styles.optionLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  /* Standalone, and deliberately quieter than the two tiles above it: those
     are the offer, this is the setting that shapes it. Same 16px radius and
     12/11 padding as the tiles so the group reads as one block. */
  strip: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 9,
  },
  /* Unanswered: lime, because until it is answered the shared-ride tile above
     is showing a filtered view nobody asked for. */
  stripPrompting: {
    backgroundColor: 'rgba(204,255,0,0.07)',
    borderColor: 'rgba(204,255,0,0.30)',
  },

  head: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { color: '#ffffff', fontSize: 13.5, fontWeight: '900' },
  sub: { color: '#9aa2a0', fontSize: 11, fontWeight: '600', marginTop: 1, lineHeight: 14 },
  subPrompt: { color: LIME, fontSize: 11.5, fontWeight: '800', lineHeight: 15 },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: LIME,
  },
  pillTxt: { color: '#0b0d0c', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6 },

  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  optionOn: { borderColor: LIME, backgroundColor: 'rgba(204,255,0,0.12)' },
  radio: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: LIME },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIME },
  optionLabel: { flex: 1, color: '#9aa2a0', fontSize: 12.5, fontWeight: '800' },
  optionLabelOn: { color: '#ffffff' },

  hint: { color: LIME, fontSize: 10.5, fontWeight: '700', lineHeight: 14 },
}));
