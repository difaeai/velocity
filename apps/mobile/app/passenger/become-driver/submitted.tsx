import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';

import { useAuth } from '../../../src/auth/AuthContext';
import { useDriverProfile } from '../../../src/hooks/driver';
import { OnbButton, oc } from '../../../src/ui/onboarding';
import { LogoMark } from '../../../src/ui/LogoMark';
import { themed } from '../../../src/theme';

/**
 * Post-registration status screen for a driver applicant.
 *
 * The application has been submitted to admin. This screen watches the driver
 * doc's `verificationStatus` live and polls the ID token for the `driver` role
 * claim (which the backend sets on approval). The moment the role is granted we
 * redirect to the driver home — the driver never has to sign in again.
 */
export default function ApplicationSubmitted() {
  const router = useRouter();
  const { user, role, refreshRole } = useAuth();
  const profile = useDriverProfile(user?.uid);
  const status = profile?.verificationStatus;

  // Approval sets the role claim server-side; tokens don't auto-refresh, so poll.
  useEffect(() => {
    const id = setInterval(() => { refreshRole().catch(() => {}); }, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // As soon as Firestore shows "approved", refresh the token immediately so we
  // don't wait up to 8s for the next poll to route them to the driver home.
  useEffect(() => {
    if (status === 'approved') refreshRole().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Role granted → straight to the driver experience.
  if (role === 'driver') return <Redirect href="/driver/home" />;

  const rejected = status === 'rejected' || status === 'suspended';
  // The engine has the application in hand right now, as opposed to a human
  // having it. Seconds rather than hours, and worth saying so — a driver told
  // "under review" with no end in sight resubmits, and each resubmission costs
  // us another pass over six documents.
  const verifying = profile?.verification?.status === 'verifying';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={[styles.badge, rejected && styles.badgeRejected]}>
          {rejected ? (
            <Text style={styles.badgeMark}>!</Text>
          ) : (
            <LogoMark size={44} color="#1a1a1a" spin />
          )}
        </View>

        {rejected ? (
          <>
            <Text style={styles.title}>Application not approved</Text>
            {profile?.reviewReason ? (
              <Text style={styles.reason}>“{profile.reviewReason}”</Text>
            ) : null}
            <Text style={styles.subtitle}>
              Please update the requested details and resubmit your application.
            </Text>
            <View style={styles.actions}>
              <OnbButton
                label="Update application"
                onPress={() => router.replace('/passenger/become-driver/checklist')}
              />
            </View>
          </>
        ) : verifying ? (
          <>
            <Text style={styles.title}>Checking your documents</Text>
            <Text style={styles.subtitle}>
              We are reading your licence, CNIC and vehicle papers now. This usually takes under a
              minute, and this screen will change on its own — you do not have to wait here.
            </Text>

            <View style={styles.statusRow}>
              <ActivityIndicator color={oc.green} />
              <Text style={styles.statusText}>Verifying…</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.title}>Application submitted</Text>
            <Text style={styles.subtitle}>
              Your documents have been checked and passed to our team for a final look. We will
              notify you as soon as it is done, and this screen will take you straight to your
              driver dashboard the moment you are approved.
            </Text>

            <View style={styles.statusRow}>
              <ActivityIndicator color={oc.green} />
              <Text style={styles.statusText}>With our team…</Text>
            </View>
          </>
        )}

        <Pressable
          onPress={() => router.replace('/passenger/home')}
          style={styles.passengerBtn}
          hitSlop={8}
        >
          <Text style={styles.passengerLink}>Use passenger mode meanwhile</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 14 },

  badge: {
    width: 88, height: 88, borderRadius: 26, backgroundColor: '#ccff00',
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  badgeRejected: { backgroundColor: '#fdecea' },
  badgeMark: { color: '#c0392b', fontSize: 44, fontWeight: '900' },

  title: { fontSize: 26, fontWeight: '900', color: oc.text, textAlign: 'center' },
  reason: { fontSize: 15, color: '#7b241c', fontStyle: 'italic', textAlign: 'center', lineHeight: 22 },
  subtitle: { fontSize: 15, color: oc.sub, textAlign: 'center', lineHeight: 22 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  statusText: { fontSize: 14, fontWeight: '700', color: oc.green },

  actions: { alignSelf: 'stretch', marginTop: 10 },

  passengerBtn: { position: 'absolute', bottom: 28, paddingVertical: 14, alignItems: 'center' },
  passengerLink: { color: oc.sub, fontSize: 15, fontWeight: '600' },
}));
