import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { Bullet, PhotoCircle, StepHeader, pickPhoto } from '../../../src/ui/onboarding';
import { PrimaryButton } from '../../../src/ui/components';
import { colors } from '../../../src/config';

export default function Selfie() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Selfie with ID" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <PhotoCircle uri={data.selfie} onPick={() => pickPhoto((uri) => set({ selfie: uri }))} />
          <View style={styles.bullets}>
            <Bullet>Hold your CNIC next to your face</Bullet>
            <Bullet>Your face and the ID must be clearly visible</Bullet>
            <Bullet>Good lighting, no sunglasses or filters</Bullet>
          </View>
        </View>
        <PrimaryButton label="Done" onPress={() => router.back()} disabled={!data.selfie} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 18, padding: 20, alignItems: 'center', gap: 14 },
  bullets: { gap: 6, alignSelf: 'stretch', paddingHorizontal: 8 },
});
