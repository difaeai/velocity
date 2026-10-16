import { useRouter } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../../src/auth/AuthContext';
import { useDriverProfile } from '../../../src/hooks/driver';
import { useOnboarding, type SectionKey } from '../../../src/onboarding/context';
import { OnbButton, StepHeader, oc } from '../../../src/ui/onboarding';
import { themed } from '../../../src/theme';
import { PRIVACY_URL, TERMS_URL } from '../../../src/share/links';

const SECTIONS: { key: SectionKey; label: string; hint?: string; route: string }[] = [
  { key: 'basic', label: 'Basic info', route: '/passenger/become-driver/basic-info' },
  { key: 'license', label: 'Driver licence', route: '/passenger/become-driver/license' },
  { key: 'cnic', label: 'CNIC', route: '/passenger/become-driver/cnic' },
  { key: 'vehicle', label: 'Vehicle info', route: '/passenger/become-driver/vehicle' },
  // Last, and LOCKED until the four above are done.
  //
  // Not a presentation choice: the scan is compared with the photographs on the
  // CNIC and the licence, so until those are uploaded there is nothing for it to
  // be compared with — and the backend refuses to start one. Pressing it early
  // would hand the driver an error they did nothing to deserve, so the row says
  // what it is waiting for instead.
  {
    key: 'faceScan',
    label: 'Face scan',
    hint: 'The last step — a few seconds on camera to show these documents are yours',
    route: '/passenger/become-driver/face-scan',
  },
];

export default function Checklist() {
  const router = useRouter();
  const { user } = useAuth();
  const profile = useDriverProfile(user?.uid);
  const { complete, documentsComplete, submitting, error, submit } = useOnboarding();
  const status = profile?.verificationStatus;
  const verifying = profile?.verification?.status === 'verifying';
  /**
   * The papers are stored and the engine is waiting for the face scan.
   *
   * A real state, not a transient one: a driver whose battery died at the camera
   * comes back to this. The button becomes "Finish face verification" and goes
   * straight to the camera — their documents are already in, and re-uploading
   * six photographs to get back to where they were would be absurd.
   */
  const awaitingFaceScan = profile?.verification?.status === 'awaiting_face_scan';

  async function onSubmit() {
    // Already stored, only the scan outstanding: skip the upload entirely.
    if (awaitingFaceScan && !complete.faceScan) {
      router.push('/passenger/become-driver/face-scan');
      return;
    }
    const next = await submit();
    // The face scan is what sends the application off to be decided, so the
    // camera — not the status screen — is where the driver goes from here.
    if (next === 'face_scan') router.push('/passenger/become-driver/face-scan');
    // An older backend decided it on the spot; nothing left to do but wait.
    else if (next === 'submitted') router.replace('/passenger/become-driver/submitted');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Registration" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {status === 'rejected' ? (
          <View style={styles.declined}>
            <Text style={styles.declinedTitle}>Application not approved</Text>
            {profile?.reviewReason ? (
              <Text style={styles.declinedReason}>"{profile.reviewReason}"</Text>
            ) : null}
            <Text style={styles.declinedText}>
              Please update the highlighted sections below and resubmit.
            </Text>
          </View>
        ) : null}
        {awaitingFaceScan && !complete.faceScan ? (
          <View style={styles.checking}>
            <Text style={styles.checkingText}>
              Your documents are saved. One last step: the face scan, so we can see these documents
              are yours.
            </Text>
          </View>
        ) : status === 'pending' ? (
          // Two different waits that look identical from outside and are not:
          // the engine is reading the documents right now (seconds), or it has
          // finished and handed the application to a person (hours). Saying
          // which is the difference between a driver who waits and a driver who
          // resubmits four times.
          verifying ? (
            <View style={styles.checking}>
              <ActivityIndicator color={oc.green} />
              <Text style={styles.checkingText}>
                Checking your documents… this usually takes under a minute.
              </Text>
            </View>
          ) : (
            <View style={styles.pending}>
              <Text style={styles.pendingText}>
                Your application is with our team for review. We will let you know as soon as it is
                done.
              </Text>
            </View>
          )
        ) : null}

        <View style={styles.card}>
          {SECTIONS.map((s, i) => {
            const done = complete[s.key];
            const rejected = status === 'rejected' && (
              !profile?.rejectedSections?.length
                ? !done          // if no specific sections, flag incomplete ones
                : profile.rejectedSections.includes(s.key)
            );
            // The face scan waits for the papers it is compared against.
            const locked = s.key === 'faceScan' && !documentsComplete;
            return (
              <Pressable
                key={s.key}
                disabled={locked}
                onPress={() => router.push(s.route)}
                android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
                pressRetentionOffset={{ top: 16, bottom: 16, left: 16, right: 16 }}
                style={[styles.row, i > 0 && styles.rowBorder, rejected && styles.rowRejected]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.rowLabel,
                      rejected && { color: '#c0392b' },
                      locked && styles.rowLabelLocked,
                    ]}
                  >
                    {s.label}
                  </Text>
                  {rejected ? (
                    <Text style={styles.rejectedTag}>Changes requested — tap to update</Text>
                  ) : locked ? (
                    <Text style={styles.rowHint}>Finish the sections above first</Text>
                  ) : !done && s.hint ? (
                    <Text style={styles.rowHint}>{s.hint}</Text>
                  ) : null}
                </View>
                <View style={styles.rowRight}>
                  {rejected ? (
                    <View style={styles.rejectedDot}>
                      <Text style={styles.rejectedDotText}>✕</Text>
                    </View>
                  ) : done ? (
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
          label={
            awaitingFaceScan && !complete.faceScan
              ? 'Finish face verification'
              : status === 'pending'
                ? verifying
                  ? 'Checking your documents…'
                  : 'Submitted — under review'
                : 'Continue to face verification'
          }
          onPress={onSubmit}
          loading={submitting}
          // The face scan is NOT a precondition of this button — it is where the
          // button goes. What it needs is the four paper sections.
          disabled={!documentsComplete || (status === 'pending' && !awaitingFaceScan)}
          disabledHint={
            status === 'pending' && !awaitingFaceScan
              ? verifying
                ? 'We are reading your documents now. This screen will update on its own.'
                : 'Your application is already with our team — we will notify you once it is reviewed.'
              : 'Complete all the sections above first — the incomplete ones are marked with !'
          }
        />
        <Text style={styles.terms}>
          By submitting you agree to our{' '}
          <Text style={styles.termsLink} onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}>
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text style={styles.termsLink} onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}>
            Privacy Policy
          </Text>
          .
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
  declined: { backgroundColor: '#fdecea', borderColor: '#f5b7b1', borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  declinedTitle: { color: '#c0392b', fontWeight: '900', fontSize: 16 },
  declinedReason: { color: '#7b241c', fontWeight: '600', fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  declinedText: { color: '#c0392b', fontWeight: '600', fontSize: 13, lineHeight: 18 },
  rowRejected: { backgroundColor: '#fff5f5' },
  rejectedTag: { fontSize: 11, color: '#e74c3c', fontWeight: '600', marginTop: 2 },
  rejectedDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#e74c3c', alignItems: 'center', justifyContent: 'center' },
  rejectedDotText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  pending: { backgroundColor: oc.note, borderColor: '#f5d384', borderWidth: 1, borderRadius: 12, padding: 14 },
  pendingText: { color: oc.noteText, fontWeight: '700', fontSize: 14, lineHeight: 20 },
  checking: {
    backgroundColor: '#eaf7ee', borderColor: '#b7e3c4', borderWidth: 1, borderRadius: 12,
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  checkingText: { flex: 1, color: '#1b7a2e', fontWeight: '700', fontSize: 14, lineHeight: 20 },
  rowHint: { fontSize: 12, color: oc.sub, fontWeight: '600', marginTop: 2 },
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
  rowLabelLocked: { color: oc.sub },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: oc.green, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: oc.green, fontSize: 13, fontWeight: '900' },
  warn: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#e0a106', alignItems: 'center', justifyContent: 'center' },
  warnMark: { color: '#e0a106', fontSize: 13, fontWeight: '900' },
  chevron: { color: oc.green, fontSize: 24, fontWeight: '500' },
  error: { color: '#c0392b', fontWeight: '600', fontSize: 14 },
  terms: { color: oc.sub, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  termsLink: { color: oc.green, fontWeight: '800', textDecorationLine: 'underline' },
}));
