/**
 * The first screen a new driver sees after signing up.
 * ----------------------------------------------------------------------------
 * The owner's order (2026-11-13): "take the CNIC and the driving licence first,
 * then show them a button — see the rides coming".
 *
 * Two documents, not the whole registration. The full checklist asks for five
 * sections and a face scan, and a stranger who has just typed an OTP will not
 * finish five sections for an app that has shown them nothing. These two are
 * the ones that identify a driver at all, and they are the price of seeing what
 * the work looks like. Everything else is asked for on the checklist afterwards.
 *
 * Nothing is uploaded here. The CNIC and licence screens write into the shared
 * onboarding form (src/onboarding/context) exactly as they do when reached from
 * the checklist, and the whole application is submitted in one go later. So a
 * driver who stops at this screen has sent us nothing and owes us nothing —
 * which is also why this screen can be left at any time from the header.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { themed } from '../../../src/theme';
import { Text } from '../../../src/ui/Text';
import { OnbButton, StepHeader, oc } from '../../../src/ui/onboarding';

const STEPS = [
  { key: 'cnic', label: 'CNIC', hint: 'Both sides, and the number', route: '/passenger/become-driver/cnic' },
  { key: 'license', label: 'Driving licence', hint: 'The front of your licence', route: '/passenger/become-driver/license' },
] as const;

export default function DriverStart() {
  const router = useRouter();
  const { complete } = useOnboarding();
  const both = complete.cnic && complete.license;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Start driving" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Two documents to begin</Text>
          <Text style={styles.heroText}>
            Add your CNIC and your driving licence, and we will show you the rides going out around
            you right now.
          </Text>
        </View>

        <View style={styles.card}>
          {STEPS.map((s, i) => {
            const done = complete[s.key];
            return (
              <Pressable
                key={s.key}
                onPress={() => router.push(s.route)}
                android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
                pressRetentionOffset={{ top: 16, bottom: 16, left: 16, right: 16 }}
                style={[styles.row, i > 0 && styles.rowBorder]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{s.label}</Text>
                  {!done ? <Text style={styles.rowHint}>{s.hint}</Text> : null}
                </View>
                <View style={styles.rowRight}>
                  {done ? (
                    <View style={styles.check}><Text style={styles.checkMark}>✓</Text></View>
                  ) : (
                    <View style={styles.warn}><Text style={styles.warnMark}>!</Text></View>
                  )}
                  <Text style={styles.chevron}>›</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <OnbButton
          label="See the rides coming"
          onPress={() => router.push('/passenger/become-driver/rides-preview')}
          disabled={!both}
          disabledHint="Add your CNIC and your driving licence first — both are marked with ! above."
        />

        <Text style={styles.note}>
          Nothing is sent yet. You finish the rest of the registration after you have seen the rides.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },

  hero: { backgroundColor: oc.greenDark, borderRadius: 18, padding: 20, gap: 8 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  heroText: { color: '#eafff0', fontSize: 14, fontWeight: '600', lineHeight: 20 },

  card: { backgroundColor: oc.card, borderRadius: 18, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 18, paddingHorizontal: 18,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: oc.line },
  rowLabel: { fontSize: 16, fontWeight: '600', color: oc.text },
  rowHint: { fontSize: 12, color: oc.sub, fontWeight: '600', marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: oc.green,
    alignItems: 'center', justifyContent: 'center',
  },
  checkMark: { color: oc.green, fontSize: 13, fontWeight: '900' },
  warn: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#e0a106',
    alignItems: 'center', justifyContent: 'center',
  },
  warnMark: { color: '#e0a106', fontSize: 13, fontWeight: '900' },
  chevron: { color: oc.green, fontSize: 24, fontWeight: '500' },

  note: { color: oc.sub, fontSize: 12, textAlign: 'center', lineHeight: 18 },
}));
