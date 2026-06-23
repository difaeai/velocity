import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { HubRow, OnbButton, StepHeader, SupportNote, oc } from '../../../src/ui/onboarding';

export default function Vehicle() {
  const router = useRouter();
  const { data } = useOnboarding();

  const detailsDone = !!data.vehicleType && data.vehicleMake.trim().length > 0 && data.color.trim().length > 0;
  const pictureDone = !!data.vehiclePhoto;
  const plateDone = data.plate.trim().length > 2;
  const certificateDone = !!data.vehicleDoc;
  const required = detailsDone && plateDone && certificateDone;

  const summary = detailsDone ? `${data.vehicleMake}, ${data.color}` : undefined;
  const go = (route: string) => () => router.push(route);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Vehicle info" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <HubRow
            first
            label={summary ?? 'Vehicle details'}
            done={detailsDone}
            onPress={go('/passenger/become-driver/vehicle-details')}
          />
          <HubRow label="Picture" done={pictureDone} onPress={go('/passenger/become-driver/vehicle-photo')} />
          <HubRow
            label="Registration plate"
            value={plateDone ? data.plate : undefined}
            done={plateDone}
            onPress={go('/passenger/become-driver/vehicle-plate')}
          />
          <HubRow
            label="Certificate of vehicle registration"
            done={certificateDone}
            onPress={go('/passenger/become-driver/vehicle-certificate')}
          />
        </View>

        <OnbButton label="Done" onPress={() => router.back()} disabled={!required} />
        <SupportNote />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
  card: { backgroundColor: oc.card, borderRadius: 18, overflow: 'hidden' },
});
