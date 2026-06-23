import { useRouter } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import {
  AddPhotoButton,
  Bullet,
  OnbButton,
  SelfieDontArt,
  StepHeader,
  SupportNote,
  oc,
  pickPhoto,
} from '../../../src/ui/onboarding';

export default function Selfie() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Selfie with ID" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Selfie with driver licence</Text>
          {data.selfie ? (
            <Image source={{ uri: data.selfie }} style={styles.preview} resizeMode="cover" />
          ) : (
            <SelfieDontArt />
          )}
          <AddPhotoButton uri={data.selfie} onPick={() => pickPhoto((uri) => set({ selfie: uri }))} />
          <View style={styles.bullets}>
            <Bullet>Your face and the driving licence must be clearly visible.</Bullet>
            <Bullet>No sunglasses, mask or hat in the photo.</Bullet>
          </View>
        </View>

        <OnbButton label="Done" onPress={() => router.back()} disabled={!data.selfie} />
        <SupportNote />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
  card: { backgroundColor: oc.card, borderRadius: 18, padding: 20, alignItems: 'center', gap: 16 },
  title: { fontSize: 19, fontWeight: '700', color: oc.text, textAlign: 'center' },
  preview: { width: 200, height: 200, borderRadius: 16, backgroundColor: '#eef0ef' },
  bullets: { gap: 8, alignSelf: 'stretch', paddingHorizontal: 4 },
});
