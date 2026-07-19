import { useRouter } from 'expo-router';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDriverEntry } from '../../../src/hooks/useDriverEntry';
import { themed } from '../../../src/theme';

function Benefit({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.benefit}>
      <Text style={styles.benefitIcon}>{icon}</Text>
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

function RoleCard({
  emoji,
  label,
  onPress,
  disabled,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.roleCard, disabled && { opacity: 0.6 }]} onPress={onPress} disabled={disabled}>
      <Text style={styles.roleEmoji}>{emoji}</Text>
      <Text style={styles.roleLabel}>{label}</Text>
      <Text style={styles.roleChevron}>›</Text>
    </Pressable>
  );
}

export default function DriverIntro() {
  const router = useRouter();
  const driverEntry = useDriverEntry();
  // A signed-in passenger goes straight to the registration steps — no second
  // number/OTP. Only a signed-out user is routed to the login gate.
  const goDriver = () => driverEntry.go();
  const goPassenger = () => router.replace('/passenger/home');

  const goCourier = () =>
    Alert.alert('Coming soon', 'Courier sign-up will be available shortly. You can register as a driver now.');

  const openMenu = () =>
    Alert.alert('Velocity', undefined, [
      { text: 'Switch to passenger mode', onPress: goPassenger },
      { text: 'Contact support', onPress: () => Linking.openURL('mailto:support@velocity.app').catch(() => {}) },
      { text: 'Close', style: 'cancel' },
    ]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topbar}>
        <Pressable onPress={openMenu} hitSlop={12}>
          <Text style={styles.menuIcon}>≡</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Get income with us</Text>
          <Benefit icon="🕒" text="Flexible hours" />
          <Benefit icon="💼" text="Your prices" />
          <Benefit icon="％" text="Low service payments" />
        </View>

        <RoleCard emoji="🚗" label="Driver" onPress={goDriver} disabled={driverEntry.busy} />
        <RoleCard emoji="📦" label="Courier" onPress={goCourier} />

        <View style={styles.spacer} />

        <Pressable onPress={goPassenger} style={styles.passengerBtn}>
          <Text style={styles.passengerLink}>Go to passenger mode</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#3a3a3a' },
  topbar: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 2 },
  menuIcon: { color: '#fff', fontSize: 30, fontWeight: '700' },
  container: { padding: 20, paddingTop: 10, gap: 16, flexGrow: 1 },

  hero: { backgroundColor: '#1b7a2e', borderRadius: 18, padding: 22, gap: 12 },
  heroTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginBottom: 6 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  benefitText: { color: '#eafff0', fontSize: 17, fontWeight: '600', flex: 1 },

  roleCard: {
    backgroundColor: '#1d1d1d',
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  roleEmoji: { fontSize: 30 },
  roleLabel: { color: '#fff', fontSize: 20, fontWeight: '700', flex: 1 },
  roleChevron: { color: '#9aa3a0', fontSize: 26, fontWeight: '600' },

  spacer: { flex: 1, minHeight: 30 },

  passengerBtn: { paddingVertical: 14, alignItems: 'center' },
  passengerLink: { color: '#e6e6e6', fontSize: 18, fontWeight: '600' },
}));
