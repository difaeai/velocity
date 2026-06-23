import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../../src/config';
import { PrimaryButton } from '../../../src/ui/components';

function Benefit({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.benefit}>
      <Text style={styles.benefitIcon}>{icon}</Text>
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

export default function DriverIntro() {
  const router = useRouter();
  const go = () => router.push('/passenger/become-driver/checklist');

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Earn with Velocity</Text>
          <Benefit icon="🕒" text="Flexible hours — drive whenever you want" />
          <Benefit icon="💸" text="Set your own fare on every ride" />
          <Benefit icon="📉" text="Low service fee — keep 90% of each fare" />
        </View>

        <Pressable style={styles.optionCard} onPress={go}>
          <Text style={styles.optionEmoji}>🚗</Text>
          <Text style={styles.optionLabel}>Driver</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <View style={{ flex: 1, minHeight: 40 }} />

        <PrimaryButton label="Become a driver" onPress={go} />
        <Pressable onPress={() => router.replace('/passenger/home')} style={styles.passengerBtn}>
          <Text style={styles.passengerLink}>Go to passenger mode</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1c1b1b' },
  container: { padding: 20, gap: 16, flexGrow: 1 },
  hero: { backgroundColor: colors.primary, borderRadius: 20, padding: 22, gap: 14 },
  heroTitle: { color: '#fff', fontSize: 26, fontWeight: '900', marginBottom: 4 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitIcon: { fontSize: 18 },
  benefitText: { color: '#eafff4', fontSize: 15, fontWeight: '600', flex: 1 },
  optionCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  optionEmoji: { fontSize: 26 },
  optionLabel: { color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 },
  chevron: { color: '#9aa3a0', fontSize: 26, fontWeight: '700' },
  passengerBtn: { paddingVertical: 14, alignItems: 'center' },
  passengerLink: { color: '#cfd6d2', fontSize: 15, fontWeight: '700' },
});
