/**
 * "Who will you share a ride with?" — now a control on the MAP, and a gate.
 *
 * ── Why it moved out of the sheet ───────────────────────────────────────────
 * The question has been homeless twice already (see the history note in
 * SharedRideGenderStrip, which this replaces). As a card inside the booking
 * sheet it was correct and unread: it sat below the fold on a small handset,
 * it cost the sheet a whole block of height that the ride tiles wanted, and a
 * rider who never scrolled simply never answered — which the server reads as
 * "same gender only" and quietly halves their feed.
 *
 * So it is a pill on the map instead, in the space the "quiet around you" chip
 * used to take. On the map it costs the sheet nothing at all, it is visible
 * the moment the app opens, and — the part that actually fixes the problem —
 * it is the one surface a rider is sent to when they reach for a shared seat
 * without having answered. See `ShareGenderSheet` and the gate below.
 *
 * ── The gate ────────────────────────────────────────────────────────────────
 * Unanswered, every shared-ride entry point opens this sheet instead of
 * navigating. Not a warning, not a disabled tile: the question is asked, the
 * answer is saved, and the tap the rider made carries on to where it was
 * going. One interruption, once per account, on the only path it affects — a
 * rider who only ever travels solo is never asked at all.
 *
 * ── Colours ─────────────────────────────────────────────────────────────────
 * Light-on-dark literals rather than theme tokens. The pill floats over a dark
 * map and the sheet is dark in BOTH themes: `colors.text` would turn near-black
 * on them in light mode, and `colors.primary` darkens the brand lime to olive.
 */
import { useEffect, useRef } from 'react';
import { Alert, Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
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

/**
 * Whether this rider still owes us an answer.
 *
 * `loaded` matters as much as `pref`: prompting before the profile has been
 * read would stop a rider who answered months ago, and a gate that fires on
 * missing data is a gate that fires on a slow connection.
 */
export function useNeedsShareGender(): boolean {
  const { loaded, pref } = useGenderPref();
  return loaded && pref === null;
}

/* ── The map pill ──────────────────────────────────────────────────────────
   Two states, and they look nothing alike on purpose. Unanswered it is lime,
   breathing, and asks the question in full — it is the only thing on the map
   competing for attention, which is the point. Answered it collapses to a
   dark glass chip reporting the standing choice, because then it is a setting
   and settings do not pulse at people. ── */
export function ShareGenderPill({ onPress }: { onPress: () => void }) {
  const { loaded, pref, gender } = useGenderPref();
  const pulse = useRef(new Animated.Value(0)).current;
  const chosen = pref !== null;

  useEffect(() => {
    // Only the unanswered pill breathes, and it stops the moment it is
    // answered — an animation that runs forever over a map the user is panning
    // is a battery cost with nothing left to say.
    if (!loaded || chosen) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [loaded, chosen, pulse]);

  if (!loaded) return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });

  return (
    <Animated.View style={{ transform: [{ scale }], alignSelf: 'flex-start' }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          chosen ? styles.pillChosen : styles.pillPrompt,
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          chosen
            ? `Sharing preference: ${sameGenderLabel(gender)}. Tap to change.`
            : 'Choose who you will share a ride with'
        }
      >
        {chosen ? (
          <>
            <View style={styles.pillDot} />
            <Text style={styles.pillLabel} numberOfLines={1}>
              {pref === 'any_gender' ? '♂♀ Any gender' : sameGenderLabel(gender)}
            </Text>
            <Text style={styles.pillSub} numberOfLines={1}>shared rides</Text>
            <Text style={styles.pillChevron}>›</Text>
          </>
        ) : (
          <>
            <Text style={styles.pillPromptIcon}>♂♀</Text>
            <Text style={styles.pillPromptLabel} numberOfLines={1}>
              Who will you share a ride with?
            </Text>
            <View style={styles.pillChoose}>
              <Text style={styles.pillChooseTxt}>CHOOSE</Text>
            </View>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

/* ── The chooser ───────────────────────────────────────────────────────────
   A bottom sheet rather than an Alert, because the two options need room to
   say what they mean and an Alert cannot carry the profile hint. ── */
export function ShareGenderSheet({
  open,
  onClose,
  /** Ran after a choice is saved — this is what carries the original tap on. */
  onChosen,
  /** Named when the sheet was opened BY a shared-ride tap rather than the pill. */
  reason,
}: {
  open: boolean;
  onClose: () => void;
  onChosen?: () => void;
  reason?: string | null;
}) {
  const router = useRouter();
  const { pref, gender, saving, choose } = useGenderPref();
  const unknownGender = gender !== 'male' && gender !== 'female';
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rise, {
      toValue: open ? 1 : 0,
      duration: open ? 240 : 160,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [open, rise]);

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
          {
            text: 'Open profile',
            onPress: () => {
              onClose();
              router.push('/passenger/profile');
            },
          },
        ],
      );
      return;
    }
    try {
      await choose(next);
      onClose();
      // After the sheet is dismissed, never before: pushing a route out from
      // under a Modal that is still mounted leaves the overlay on screen.
      setTimeout(() => onChosen?.(), 180);
    } catch {
      Alert.alert('Could not save preference', 'Please try again.');
    }
  }

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [360, 0] });

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View style={[styles.sheetWrap, { transform: [{ translateY }] }]}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grabber} />

            <Text style={styles.sheetTitle}>Who will you share a ride with?</Text>
            <Text style={styles.sheetBody}>
              {reason
                ?? 'This decides which shared cars we show you and which seats you can take. '
                  + 'Riding solo is never affected.'}
            </Text>

            <View style={styles.optionCol}>
              <BigOption
                label={sameGenderLabel(gender)}
                detail={
                  gender === 'female'
                    ? 'Only women in the car with you'
                    : gender === 'male'
                      ? 'Only men in the car with you'
                      : 'Only riders of your own gender'
                }
                on={pref === 'same_gender'}
                disabled={saving}
                onPress={() => void pick('same_gender')}
              />
              <BigOption
                label="♂♀ Any gender"
                detail="Anyone can share the car — usually more rides to choose from"
                on={pref === 'any_gender'}
                disabled={saving}
                onPress={() => void pick('any_gender')}
              />
            </View>

            {/* Two different situations, and telling them apart matters: signup
                offers Male / Female / Other, and someone who deliberately chose
                "Other" is not someone who left the field empty. Both block
                same-gender matching — the server seats by male/female — but only
                one of them is missing information. */}
            {unknownGender ? (
              <Pressable
                onPress={() => {
                  onClose();
                  router.push('/passenger/profile');
                }}
              >
                <Text style={styles.hint}>
                  {gender === 'other'
                    ? 'Same-gender matching needs male or female — change it on your profile, or share with any gender →'
                    : 'Your profile has no gender set — add it so same-gender rides can be matched →'}
                </Text>
              </Pressable>
            ) : null}

            <Text style={styles.footnote}>You can change this any time from the map.</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function BigOption({
  label,
  detail,
  on,
  disabled,
  onPress,
}: {
  label: string;
  detail: string;
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
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, on && styles.optionLabelOn]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.optionDetail} numberOfLines={2}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  /* ── Map pill ── */
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginLeft: 16,
    marginTop: 8,
    paddingLeft: 11,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  pillPrompt: {
    backgroundColor: 'rgba(16,19,18,0.94)',
    borderColor: LIME,
  },
  pillChosen: {
    backgroundColor: 'rgba(16,19,18,0.88)',
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIME },
  pillLabel: { color: '#ffffff', fontSize: 11.5, fontWeight: '900' },
  pillSub: { color: '#9aa2a0', fontSize: 10, fontWeight: '700' },
  pillChevron: { color: '#9aa2a0', fontSize: 14, fontWeight: '900', marginLeft: -2 },
  pillPromptIcon: { color: LIME, fontSize: 12, fontWeight: '900' },
  pillPromptLabel: { color: '#ffffff', fontSize: 11.5, fontWeight: '800' },
  pillChoose: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: LIME,
  },
  pillChooseTxt: { color: '#0b0d0c', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },

  /* ── Chooser sheet ── */
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheetWrap: { width: '100%' },
  sheet: {
    backgroundColor: '#151917',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 34,
    gap: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 6,
  },
  sheetTitle: { color: '#ffffff', fontSize: 19, fontWeight: '900', letterSpacing: -0.2 },
  sheetBody: { color: '#9aa2a0', fontSize: 12.5, fontWeight: '600', lineHeight: 17 },

  optionCol: { gap: 9, marginTop: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 13,
    paddingVertical: 13,
  },
  optionOn: { borderColor: LIME, backgroundColor: 'rgba(204,255,0,0.12)' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: LIME },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: LIME },
  optionLabel: { color: '#9aa2a0', fontSize: 15, fontWeight: '900' },
  optionLabelOn: { color: '#ffffff' },
  optionDetail: { color: '#7d8482', fontSize: 11.5, fontWeight: '600', marginTop: 2, lineHeight: 15 },

  hint: { color: LIME, fontSize: 11.5, fontWeight: '700', lineHeight: 16, marginTop: 2 },
  footnote: { color: '#6b7270', fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 2 },
}));
