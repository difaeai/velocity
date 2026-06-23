import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { Bullet, Field, PhotoCircle, StepHeader, pickPhoto } from '../../../src/ui/onboarding';
import { PrimaryButton } from '../../../src/ui/components';
import { colors } from '../../../src/config';

export default function BasicInfo() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Basic info" />
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
        <Field
          label="Date of birth"
          optional
          value={data.dob}
          onChangeText={(t) => set({ dob: t })}
          placeholder="DD / MM / YYYY"
        />
        <Field
          label="Email"
          optional
          value={data.email}
          onChangeText={(t) => set({ email: t })}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="you@example.com"
        />

        <PrimaryButton label="Next" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 12 },
  photoCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 20, alignItems: 'center', gap: 12, marginBottom: 4 },
  bullets: { gap: 6, alignSelf: 'stretch', paddingHorizontal: 8 },
});
