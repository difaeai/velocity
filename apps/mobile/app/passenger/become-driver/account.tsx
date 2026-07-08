import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Driver account gate. After choosing "Driver" on the intro screen the user
 * decides whether they are signing up (→ phone login → registration) or already
 * have a driver account (→ straight to the driver rides dashboard).
 */
export default function DriverAccountChoice() {
  const router = useRouter();

  // New driver: authenticate by phone/OTP, then fill in the registration.
  const goSignup = () => router.push('/passenger/become-driver/login');
  // Existing driver: jump to their rides booking dashboard.
  const goExisting = () => router.replace('/driver/home');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>🚗</Text>
          <Text style={styles.heroTitle}>Drive with Velocity</Text>
          <Text style={styles.heroSub}>
            Sign up to start earning, or log in if you already have a driver account.
          </Text>
        </View>

        <View style={styles.spacer} />

        <Pressable style={styles.primaryBtn} onPress={goSignup}>
          <Text style={styles.primaryText}>Sign up</Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={goExisting}>
          <Text style={styles.secondaryText}>I already have an account</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#3a3a3a' },
  topbar: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 2 },
  back: { color: '#fff', fontSize: 28, fontWeight: '700' },
  container: { padding: 20, paddingTop: 10, gap: 16, flexGrow: 1 },

  hero: { backgroundColor: '#1b7a2e', borderRadius: 18, padding: 24, gap: 10 },
  heroEmoji: { fontSize: 40 },
  heroTitle: { color: '#fff', fontSize: 26, fontWeight: '900' },
  heroSub: { color: '#eafff0', fontSize: 16, fontWeight: '600', lineHeight: 22 },

  spacer: { flex: 1, minHeight: 30 },

  primaryBtn: {
    backgroundColor: '#ccff00',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  primaryText: { color: '#000', fontSize: 18, fontWeight: '800' },

  secondaryBtn: {
    backgroundColor: '#1d1d1d',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  secondaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
