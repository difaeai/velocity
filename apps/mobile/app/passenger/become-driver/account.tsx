import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { themed } from '../../../src/theme';

/**
 * Driver account gate — reached only when NOBODY is signed in (a fresh install,
 * for example). A signed-in passenger never lands here: they already have an
 * account, so `useDriverEntry` sends them straight to the registration steps.
 *
 * Both choices verify the phone by OTP because there is no session to trust.
 * The login screen then routes on the driver record it finds: registration for
 * a new applicant, the status screen while pending, driver home once approved.
 */
export default function DriverAccountChoice() {
  const router = useRouter();

  const goSignup = () => router.push('/passenger/become-driver/login');
  const goExisting = () => router.push('/passenger/become-driver/login');

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

const styles = themed(() => StyleSheet.create({
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
}));
