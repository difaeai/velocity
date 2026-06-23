import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../../src/auth/AuthContext';
import { useDriverProfile } from '../../../src/hooks/driver';
import { useOnboarding, type SectionKey } from '../../../src/onboarding/context';
import { colors } from '../../../src/config';
import { StepHeader } from '../../../src/ui/onboarding';
import { PrimaryButton } from '../../../src/ui/components';

const SECTIONS: { key: SectionKey; label: string; route: string }[] = [
  { key: 'basic', label: 'Basic info', route: '/passenger/become-driver/basic-info' },
  { key: 'license', label: 'Driver licence', route: '/passenger/become-driver/license' },
  { key: 'cnic', label: 'CNIC', route: '/passenger/become-driver/cnic' },
  { key: 'selfie', label: 'Selfie with ID', route: '/passenger/become-driver/selfie' },
  { key: 'vehicle', label: 'Vehicle info', route: '/passenger/become-driver/vehicle' },
];

export default function Checklist() {
  const router = useRouter();
  const { user } = useAuth();
  const profile = useDriverProfile(user?.uid);
  const { complete, allComplete, submitting, error, submit } = useOnboarding();
  const status = profile?.verificationStatus;

  async function onSubmit() {
    const ok = await submit();
    if (ok) {
      Alert.alert(
        'Application submitted',
        "We're reviewing your documents. You'll be notified once you're approved.",
      );
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Registration" />
      <ScrollView contentContainerStyle={styles.container}>
        {status === 'rejected' ? (
          <View style={styles.declined}>
            <Text style={styles.declinedText}>
              Your driver application was declined. Correct the items and submit again.
            </Text>
          </View>
        ) : null}
        {status === 'pending' ? (
          <View style={styles.pending}>
            <Text style={styles.pendingText}>Your application is under review.</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          {SECTIONS.map((s, i) => {
            const done = complete[s.key];
            return (
              <Pressable
                key={s.key}
                onPress={() => router.push(s.route)}
                style={[styles.row, i < SECTIONS.length - 1 && styles.rowBorder]}
              >
                <Text style={[styles.rowLabel, !done && status === 'rejected' && { color: colors.danger }]}>
                  {s.label}
                </Text>
                <View style={styles.rowRight}>
                  {done ? (
                    <View style={styles.check}>
                      <Text style={styles.checkMark}>✓</Text>
                    </View>
                  ) : (
                    <View style={styles.warn}>
                      <Text style={styles.warnMark}>!</Text>
                    </View>
                  )}
                  <Text style={styles.chevron}>›</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PrimaryButton
          label={status === 'pending' ? 'Submitted — under review' : 'Submit application'}
          onPress={onSubmit}
          loading={submitting}
          disabled={!allComplete || status === 'pending'}
        />
        <Text style={styles.terms}>By submitting you agree to our Terms &amp; Privacy Policy.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 14 },
  declined: { backgroundColor: colors.danger, borderRadius: 12, padding: 14 },
  declinedText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 20 },
  pending: { backgroundColor: '#fff7e6', borderColor: '#f5d384', borderWidth: 1, borderRadius: 12, padding: 14 },
  pendingText: { color: '#92600a', fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 18, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '900' },
  warn: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#e0a106', alignItems: 'center', justifyContent: 'center' },
  warnMark: { color: '#e0a106', fontSize: 13, fontWeight: '900' },
  chevron: { color: colors.muted, fontSize: 24, fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '600', fontSize: 14 },
  terms: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
