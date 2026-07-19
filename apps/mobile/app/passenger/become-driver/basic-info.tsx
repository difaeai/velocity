import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import {
  Bullet,
  DateField,
  Field,
  OnbButton,
  OnbKeyboardView,
  PhotoCircle,
  StepHeader,
  oc,
  pickPhoto,
} from '../../../src/ui/onboarding';
import { themed } from '../../../src/theme';

const now = new Date();
const DOB_MAX = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate()); // drivers must be adults
const DOB_MIN = new Date(1940, 0, 1);
const DOB_INITIAL = new Date(now.getFullYear() - 25, now.getMonth(), now.getDate());

export default function BasicInfo() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Basic info" />
      <OnbKeyboardView>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.photoCard}>
            <PhotoCircle uri={data.photo} onPick={() => pickPhoto((uri) => set({ photo: uri }))} />
            <View style={styles.bullets}>
              <Bullet>Clearly visible face</Bullet>
              <Bullet>Without sunglasses</Bullet>
              <Bullet>Good lighting and without filters</Bullet>
            </View>
          </View>

          <Field label="First name" value={data.firstName} onChangeText={(t) => set({ firstName: t })} />
          <Field label="Last name" value={data.lastName} onChangeText={(t) => set({ lastName: t })} />
          <DateField
            label="Date of birth"
            optional
            value={data.dob}
            onChange={(v) => set({ dob: v })}
            placeholder="DD/MM/YYYY"
            format="dmy"
            minimumDate={DOB_MIN}
            maximumDate={DOB_MAX}
            initialDate={DOB_INITIAL}
          />

          <OnbButton
            label="Next"
            onPress={() => router.back()}
            disabled={!data.photo || !data.firstName.trim() || !data.lastName.trim()}
            disabledHint="Add your profile photo and enter your first and last name."
          />
        </ScrollView>
      </OnbKeyboardView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 12 },
  photoCard: { backgroundColor: oc.card, borderRadius: 18, padding: 20, alignItems: 'center', gap: 12, marginBottom: 4 },
  bullets: { gap: 6, alignSelf: 'stretch', paddingHorizontal: 8 },
}));
