import { useRouter } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { AddPhotoButton, OnbButton, StepHeader, SupportNote, UploadCard, oc, pickPhoto } from '../../../src/ui/onboarding';

const MAX_EXTRA_PHOTOS = 5;

export default function VehiclePhoto() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  const addExtra = () => pickPhoto((uri) => set({ vehiclePhotos: [...data.vehiclePhotos, uri] }));
  const removeExtra = (i: number) => set({ vehiclePhotos: data.vehiclePhotos.filter((_, idx) => idx !== i) });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Picture" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <UploadCard
          title="Front of your vehicle"
          uri={data.vehiclePhoto}
          onPick={() => pickPhoto((uri) => set({ vehiclePhoto: uri }))}
        />
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            Required: take the photo from the front so the whole vehicle and its number plate are clearly
            visible.
          </Text>
        </View>

        <View style={styles.extraCard}>
          <Text style={styles.extraTitle}>
            More photos<Text style={styles.optional}>  Optional</Text>
          </Text>
          <Text style={styles.extraSub}>Add other angles — sides, back or interior.</Text>
          {data.vehiclePhotos.length > 0 ? (
            <View style={styles.thumbRow}>
              {data.vehiclePhotos.map((uri, i) => (
                <View key={`${uri}-${i}`} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                  <Pressable onPress={() => removeExtra(i)} hitSlop={8} style={styles.thumbRemove}>
                    <Text style={styles.thumbRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {data.vehiclePhotos.length < MAX_EXTRA_PHOTOS ? (
            <AddPhotoButton uri={null} onPick={addExtra} />
          ) : null}
        </View>

        <OnbButton label="Done" onPress={() => router.back()} disabled={!data.vehiclePhoto} />
        <SupportNote />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
  hint: { backgroundColor: '#eef6f1', borderRadius: 12, padding: 12 },
  hintText: { color: oc.greenDark, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  extraCard: { backgroundColor: oc.card, borderRadius: 18, padding: 18, gap: 12 },
  extraTitle: { fontSize: 16, fontWeight: '800', color: oc.text, textAlign: 'center' },
  optional: { color: oc.sub, fontWeight: '600', fontSize: 14 },
  extraSub: { fontSize: 13, color: oc.sub, textAlign: 'center' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 92, height: 92, borderRadius: 12, backgroundColor: '#eef0ef' },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1b1b1b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
