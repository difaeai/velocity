import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';

import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { comingSoon } from '../../src/ui/components';

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
          <Row icon="🌐" label="Language" value="English" onPress={() => comingSoon('Language')} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  version: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 20 },
});
