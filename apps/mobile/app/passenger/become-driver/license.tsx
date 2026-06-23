import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { IdCardArt, StepHeader, UploadCard, pickPhoto } from '../../../src/ui/onboarding';
import { PrimaryButton } from '../../../src/ui/components';
import { colors } from '../../../src/config';

export default function License() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Driver licence" />
      <ScrollView contentContainerStyle={styles.container}>
        <UploadCard
          title="The front of your driver's licence"
          uri={data.licensePhoto}
          onPick={() => pickPhoto((uri) => set({ licensePhoto: uri }))}
          art={<IdCardArt label="LICENCE" />}
        />
        <View style={styles.note}>
          <Text style={styles.noteText}>
            Upload a clear photo of your original licence. Only original documents are accepted.
          </Text>
        </View>
        <PrimaryButton label="Done" onPress={() => router.back()} disabled={!data.licensePhoto} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 14 },
  note: { backgroundColor: '#fffbe8', borderColor: '#f1e2a6', borderWidth: 1, borderRadius: 12, padding: 14 },
  noteText: { color: '#7a6410', fontSize: 13, lineHeight: 19 },
});
