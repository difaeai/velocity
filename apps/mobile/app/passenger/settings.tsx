import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';

import { api } from '../../src/api/client';
import type { MyReferral } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { comingSoon } from '../../src/ui/components';
import { getLanguage, setLanguage } from '../../src/i18n';
import { getThemeMode, toggleTheme, themed } from '../../src/theme';

function Row({
  icon,
  label,
  value,
  onPress,
  danger,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} disabled={!onPress}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress && !danger ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

export default function Settings() {
  const router = useRouter();
  const { user, role, signOut } = useAuth();
  const [push, setPush] = useState(true);
  const [dark, setDark] = useState(getThemeMode() === 'dark');
  const [langOpen, setLangOpen] = useState(false);

  async function handleThemeToggle() {
    setDark((d) => !d);
    const reloaded = await toggleTheme();
    if (!reloaded) {
      Alert.alert('Theme saved ✅', 'Close and reopen Velocity to apply the new theme everywhere.');
    }
  }

  // Fleet referral state, re-fetched on focus so the row updates right after
  // the user comes back from applying a code.
  const [referral, setReferral] = useState<MyReferral | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .getMyReferral({})
        .then((r) => {
          if (!cancelled) setReferral(r);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, []),
  );
  const referralValue = referral
    ? referral.bound
      ? (referral.partnerName ?? referral.code ?? 'Linked')
      : 'Enter code'
    : undefined;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <Row icon="📧" label="Email" value={user?.email ?? '—'} />
          <View style={styles.divider} />
          <Row icon="🎫" label="Account type" value={role ?? 'passenger'} />
        </View>

        {/* Where someone recruited by a Velocity partner enters the fleet
            owner's code. Its own section so nobody has to hunt for it. */}
        <Text style={styles.sectionLabel}>PARTNER PROGRAM</Text>
        <View style={styles.card}>
          <Row
            icon="🎁"
            label="Referral code"
            value={referralValue}
            onPress={() => router.push('/referral-code')}
          />
        </View>
        <Text style={styles.hint}>
          {referral?.bound
            ? `You're in ${referral.partnerName ?? 'a partner'}'s fleet — your fares never change because of it.`
            : 'Got a 5-digit code from a Velocity partner? Riders and drivers enter the same code here.'}
        </Text>

        <Text style={styles.sectionLabel}>PREFERENCES</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowIcon}>🔔</Text>
            <Text style={styles.rowLabel}>Push notifications</Text>
            <Switch
              value={push}
              onValueChange={setPush}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowIcon}>🌙</Text>
            <Text style={styles.rowLabel}>Dark mode</Text>
            <Switch
              value={dark}
              onValueChange={handleThemeToggle}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.divider} />
          <Row
            icon="🌐"
            label="Language"
            value={getLanguage() === 'ur' ? 'اردو' : 'English'}
            onPress={() => setLangOpen(true)}
          />
        </View>

        <Text style={styles.sectionLabel}>SUPPORT</Text>
        <View style={styles.card}>
          <Row icon="🎧" label="Contact support" onPress={() => router.push('/passenger/support-chat')} />
          <View style={styles.divider} />
          <Row icon="📄" label="Terms & Privacy" onPress={() => comingSoon('Terms & Privacy')} />
        </View>

        <View style={[styles.card, { marginTop: 16 }]}>
          <Row icon="🚪" label="Sign out" danger onPress={signOut} />
        </View>

        <Text style={styles.version}>
          Velocity v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </ScrollView>

      {/* Language selector — switches live; the root layout re-keys the tree on
          setLanguage, so this screen and every other repaint immediately. */}
      <Modal
        visible={langOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLangOpen(false)}
      >
        <Pressable style={styles.langBackdrop} onPress={() => setLangOpen(false)}>
          <Pressable style={styles.langSheet} onPress={() => {}}>
            <Text style={styles.langTitle}>Language / زبان</Text>
            <LanguageOption
              label="English"
              note="Default"
              active={getLanguage() === 'en'}
              onPress={() => {
                setLangOpen(false);
                setLanguage('en').catch(() => {});
              }}
            />
            <LanguageOption
              label="اردو"
              note="Urdu"
              active={getLanguage() === 'ur'}
              onPress={() => {
                setLangOpen(false);
                setLanguage('ur').catch(() => {});
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function LanguageOption({
  label,
  note,
  active,
  onPress,
}: {
  label: string;
  note: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.langRow, active && styles.langRowActive]} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.langLabel}>{label}</Text>
        <Text style={styles.langNote}>{note}</Text>
      </View>
      {active ? <Text style={styles.langCheck}>✓</Text> : null}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 32 },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  container: { padding: 16, gap: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '800', color: colors.muted, marginTop: 12, marginLeft: 4, letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 15 },
  rowIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  rowValue: { fontSize: 14, color: colors.muted },
  chevron: { fontSize: 22, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 52 },
  hint: { fontSize: 11, color: colors.muted, lineHeight: 16, marginLeft: 4, marginTop: -2 },
  version: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 20 },

  /* ── Language selector sheet ── */
  langBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  langSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    gap: 10,
  },
  langTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 4 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langRowActive: { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
  langLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  langNote: { fontSize: 12, color: colors.muted, marginTop: 2 },
  langCheck: { fontSize: 18, fontWeight: '800', color: colors.primary },
}));
