import { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text as RNText,
  View,
} from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';

import { api } from '../../src/api/client';
import type { MyReferral } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { DELETE_ACCOUNT_URL, PRIVACY_URL } from '../../src/share/links';
import { otherLanguageLabel, toggleLanguage } from '../../src/i18n';
import { getThemeMode, toggleTheme, themed } from '../../src/theme';

/**
 * Opens a legal page in the browser. Play requires the privacy policy and the
 * account-deletion instructions to be reachable from inside the app, and both
 * are served from the website rather than duplicated as native screens.
 */
function openLegal(url: string) {
  Linking.openURL(url).catch(() =>
    Alert.alert('Could not open the page', url),
  );
}

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
          {/* Language switch — one tap, no picker. The row names the language
              you'd GET, in that language, so the button explains itself; the
              raw <RNText> keeps "English" out of the translator, which would
              otherwise render it as "انگریزی" for the one user who needs to
              read it in Latin script. */}
          <Pressable
            style={styles.row}
            onPress={() => {
              toggleLanguage().catch(() => {});
            }}
            accessibilityLabel={`Switch to ${otherLanguageLabel()}`}
          >
            <Text style={styles.rowIcon}>🌐</Text>
            <Text style={styles.rowLabel}>Language</Text>
            <RNText style={styles.langValue}>{otherLanguageLabel()}</RNText>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>Tap Language to switch the whole app instantly.</Text>

        <Text style={styles.sectionLabel}>SUPPORT</Text>
        <View style={styles.card}>
          <Row icon="🎧" label="Contact support" onPress={() => router.push('/passenger/support-chat')} />
          <View style={styles.divider} />
          <Row icon="📄" label="Privacy Policy" onPress={() => openLegal(PRIVACY_URL)} />
          <View style={styles.divider} />
          <Row icon="🗑️" label="Delete my account" onPress={() => openLegal(DELETE_ACCOUNT_URL)} />
        </View>

        <View style={[styles.card, { marginTop: 16 }]}>
          <Row icon="🚪" label="Sign out" danger onPress={signOut} />
        </View>

        <Text style={styles.version}>
          Velocity v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </ScrollView>

    </SafeAreaView>
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

  /* The language the switch would take you to — same weight as a row value,
     tinted so it reads as the action rather than the current setting. */
  langValue: { fontSize: 15, fontWeight: '700', color: colors.primary },
}));
