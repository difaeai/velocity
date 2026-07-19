/**
 * Passenger CNIC verification — the identity gate in front of couriers.
 *
 * Sending a parcel means handing goods to a stranger, so a passenger must prove
 * who they are before they can book a courier. Ordinary rides don't ask for
 * this. Submissions are reviewed by an admin; only an approved CNIC unlocks the
 * courier flow (the server enforces it too — see backend users/cnic.ts).
 *
 * Reuses the driver-onboarding document kit: same job, same look.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useCnicVerification } from '../../src/hooks/passenger';
import { uploadCnicDoc } from '../../src/lib/uploadDoc';
import { Field, IdCardArt, OnbButton, StepHeader, UploadCard, oc, pickPhoto } from '../../src/ui/onboarding';
import { themed } from '../../src/theme';

const CNIC_RE = /^\d{5}-\d{7}-\d$/;

export default function VerifyCnic() {
  const router = useRouter();
  const { user } = useAuth();
  const verification = useCnicVerification(user?.uid);

  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [fullName, setFullName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);

  const valid = !!front && !!back && CNIC_RE.test(number) && fullName.trim().length >= 2;

  async function submit() {
    if (!valid || !user || busy) return;
    setBusy(true);
    try {
      const [frontDoc, backDoc] = await Promise.all([
        uploadCnicDoc(user.uid, 'front', front!),
        uploadCnicDoc(user.uid, 'back', back!),
      ]);
      await api.submitCnicVerification({
        cnicNumber: number.trim(),
        fullName: fullName.trim(),
        frontUrl: frontDoc.url,
        backUrl: backDoc.url,
      });
      // The live status listener flips this screen to the "under review" state.
    } catch (e: unknown) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (verification === undefined) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <StepHeader title="CNIC verification" />
        <View style={styles.centre}><ActivityIndicator color="#1b1b1b" /></View>
      </SafeAreaView>
    );
  }

  // ── Awaiting review ────────────────────────────────────────────────────────
  if (verification?.status === 'pending') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <StepHeader title="CNIC verification" />
        <View style={styles.statusWrap}>
          <Text style={styles.statusEmoji}>🕒</Text>
          <Text style={styles.statusTitle}>Under review</Text>
          <Text style={styles.statusBody}>
            Our team is checking your CNIC. You&apos;ll get a notification as soon as it&apos;s
            approved, and couriers will unlock straight away.
          </Text>
          <OnbButton label="Done" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Verified ───────────────────────────────────────────────────────────────
  if (verification?.status === 'verified') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <StepHeader title="CNIC verification" />
        <View style={styles.statusWrap}>
          <Text style={styles.statusEmoji}>✅</Text>
          <Text style={styles.statusTitle}>You&apos;re verified</Text>
          <Text style={styles.statusBody}>
            Your identity is confirmed. You can send and receive couriers.
          </Text>
          <OnbButton label="Send a package" onPress={() => router.replace('/passenger/couriers')} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Not submitted, or rejected and resubmitting ────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="CNIC verification" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {verification?.status === 'rejected' && (
          <View style={styles.rejectedBox}>
            <Text style={styles.rejectedTitle}>Your last submission was rejected</Text>
            <Text style={styles.rejectedReason}>
              {verification.rejectionReason ?? 'Please submit clearer photos of your CNIC.'}
            </Text>
          </View>
        )}

        <View style={styles.introBox}>
          <Text style={styles.introTitle}>Why we ask</Text>
          <Text style={styles.introBody}>
            Couriers move real goods between people who&apos;ve never met. Verifying your CNIC keeps
            senders, recipients and drivers safe. It&apos;s a one-time check — normal rides never
            need it.
          </Text>
        </View>

        <UploadCard
          title="CNIC (front side)"
          uri={front}
          onPick={() => pickPhoto(setFront)}
          art={<IdCardArt label="CNIC" />}
        />
        <UploadCard
          title="CNIC (back side)"
          uri={back}
          onPick={() => pickPhoto(setBack)}
          art={<IdCardArt label="CNIC" />}
        />
        <Field
          label="Full name (as printed on the CNIC)"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Ali Raza"
        />
        <Field
          label="CNIC number"
          value={number}
          onChangeText={setNumber}
          placeholder="12345-1234567-1"
          keyboardType="numbers-and-punctuation"
        />

        <OnbButton
          label={busy ? 'Submitting…' : 'Submit for verification'}
          onPress={submit}
          disabled={!valid || busy}
          loading={busy}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe:      { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
  centre:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  introBox: {
    backgroundColor: oc.card,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  introTitle: { fontSize: 14, fontWeight: '800', color: oc.text },
  introBody:  { fontSize: 13, color: oc.sub, lineHeight: 19 },

  rejectedBox: {
    backgroundColor: '#fdecec',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f5c2c2',
    padding: 16,
    gap: 4,
  },
  rejectedTitle:  { fontSize: 14, fontWeight: '800', color: '#b42318' },
  rejectedReason: { fontSize: 13, color: '#b42318', lineHeight: 19 },

  statusWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  statusEmoji: { fontSize: 56 },
  statusTitle: { fontSize: 22, fontWeight: '900', color: oc.text },
  statusBody:  { fontSize: 14, color: oc.sub, textAlign: 'center', lineHeight: 21, marginBottom: 12 },
}));
