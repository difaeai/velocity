import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { Field, OnbButton, StepHeader, oc } from '../../../src/ui/onboarding';
import { RIDE_TYPE_LABELS, type RideType } from '../../../src/domain/types';

const RIDE_TYPES = Object.keys(RIDE_TYPE_LABELS) as RideType[];

export default function VehicleDetails() {
  const router = useRouter();
  const { data, set } = useOnboarding();
  const valid = !!data.vehicleType && data.vehicleMake.trim().length > 0 && data.color.trim().length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Vehicle details" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.typeCard}>
          <Text style={styles.typeLabel}>Vehicle type</Text>
          <View style={styles.pillRow}>
            {RIDE_TYPES.map((rt) => (
              <Pressable
                key={rt}
                onPress={() => set({ vehicleType: rt })}
                style={[styles.pill, data.vehicleType === rt && styles.pillActive]}
              >
                <Text style={[styles.pillText, data.vehicleType === rt && { color: '#fff' }]}>
                  {RIDE_TYPE_LABELS[rt]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Field
          label="Make & model"
          value={data.vehicleMake}
          onChangeText={(t) => set({ vehicleMake: t })}
          placeholder="e.g. Toyota Corolla"
        />
        <Field label="Colour" value={data.color} onChangeText={(t) => set({ color: t })} placeholder="e.g. White" />

        <OnbButton label="Done" onPress={() => router.back()} disabled={!valid} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 12 },
  typeCard: { backgroundColor: oc.card, borderRadius: 16, padding: 16, marginBottom: 2 },
  typeLabel: { fontSize: 16, fontWeight: '800', color: oc.text, marginBottom: 12, textAlign: 'center' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  pill: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: oc.fieldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: oc.green, borderColor: oc.green },
  pillText: { fontWeight: '800', color: oc.text },
});
