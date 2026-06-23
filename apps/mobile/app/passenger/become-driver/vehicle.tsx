import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { Field, IdCardArt, StepHeader, UploadCard, pickPhoto } from '../../../src/ui/onboarding';
import { PrimaryButton } from '../../../src/ui/components';
import { colors } from '../../../src/config';
import { RIDE_TYPE_LABELS, type RideType } from '../../../src/domain/types';

const RIDE_TYPES = Object.keys(RIDE_TYPE_LABELS) as RideType[];

export default function Vehicle() {
  const router = useRouter();
  const { data, set } = useOnboarding();
  const valid =
    !!data.vehicleType && data.vehicleMake.trim().length > 0 && data.plate.trim().length > 2 && !!data.vehicleDoc;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Vehicle info" />
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
        <Field
          label="Number plate"
          value={data.plate}
          onChangeText={(t) => set({ plate: t })}
          placeholder="LEC-4820"
          autoCapitalize="characters"
        />

        <UploadCard
          title="Vehicle registration / papers"
          uri={data.vehicleDoc}
          onPick={() => pickPhoto((uri) => set({ vehicleDoc: uri }))}
          art={<IdCardArt label="VEHICLE" />}
        />

        <PrimaryButton label="Done" onPress={() => router.back()} disabled={!valid} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 12 },
  typeCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 2 },
  typeLabel: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 12, textAlign: 'center' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  pill: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontWeight: '800', color: colors.text },
});
