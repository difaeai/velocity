import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../../src/auth/AuthContext';
import { useDriverProfile } from '../../../src/hooks/driver';
import { useOnboarding, type SectionKey } from '../../../src/onboarding/context';
import { OnbButton, StepHeader, oc } from '../../../src/ui/onboarding';

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
                style={[styles.row, i > 0 && styles.rowBorder]}
              >
                <Text style={[styles.rowLabel, !done && status === 'rejected' && { color: '#c0392b' }]}>
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

        <OnbButton
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
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
  declined: { backgroundColor: '#fdecea', borderColor: '#f5b7b1', borderWidth: 1, borderRadius: 12, padding: 14 },
  declinedText: { color: '#c0392b', fontWeight: '700', fontSize: 14, lineHeight: 20 },
  pending: { backgroundColor: oc.note, borderColor: '#f5d384', borderWidth: 1, borderRadius: 12, padding: 14 },
  pendingText: { color: oc.noteText, fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: oc.card, borderRadius: 18, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: oc.line },
  rowLabel: { fontSize: 16, fontWeight: '600', color: oc.text },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: oc.green, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: oc.green, fontSize: 13, fontWeight: '900' },
  warn: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#e0a106', alignItems: 'center', justifyContent: 'center' },
  warnMark: { color: '#e0a106', fontSize: 13, fontWeight: '900' },
  chevron: { color: oc.green, fontSize: 24, fontWeight: '500' },
  error: { color: '#c0392b', fontWeight: '600', fontSize: 14 },
  terms: { color: oc.sub, fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
