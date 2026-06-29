import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';

interface PoolSettings {
  pickupRadius: number;
  dropoffRadius: number;
  fareMultiplier: number;
  maxRideHoursAhead: number;
}

const DEFAULT_SETTINGS: PoolSettings = {
  pickupRadius: 300,
  dropoffRadius: 300,
  fareMultiplier: 1.33,
  maxRideHoursAhead: 48,
};

interface Stat { label: string; value: string; sub?: string }

function StatCard({ label, value, sub }: Stat) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function StepperField({
  label,
  value,
  step,
  min,
  max,
  format,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          style={styles.stepperBtn}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{format(value)}</Text>
        <Pressable
          style={styles.stepperBtn}
          onPress={() => onChange(Math.min(max, value + step))}
        >
          <Text style={styles.stepperBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [settings, setSettings] = useState<PoolSettings>(DEFAULT_SETTINGS);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ openRides: 0, totalPassengersToday: 0, activeDrivers: 0 });

  // Live pool ride settings
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'poolRideSettings'), (snap) => {
      if (snap.exists()) {
        setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<PoolSettings>) });
      }
      setLoadingSettings(false);
    });
    return unsub;
  }, []);

  // Stats: open pool rides + passengers today
  useEffect(() => {
    async function loadStats() {
      try {
        const [openSnap, driversSnap] = await Promise.all([
          getDocs(query(collection(db, 'poolRides'), where('status', 'in', ['open', 'collecting']))),
          getDocs(query(collection(db, 'drivers'), where('online', '==', true))),
        ]);

        let passengersToday = 0;
        openSnap.docs.forEach((d) => {
          passengersToday += (d.data().takenSeats as number) ?? 0;
        });

        setStats({
          openRides: openSnap.size,
          totalPassengersToday: passengersToday,
          activeDrivers: driversSnap.size,
        });
      } catch {
        // stats are best-effort
      }
    }
    loadStats();
  }, []);

  async function saveSettings() {
    setSaving(true);
    try {
      await setDoc(doc(db, 'config', 'poolRideSettings'), {
        ...settings,
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Saved', 'Pool ride settings updated successfully.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Admin Dashboard</Text>
        <Pressable onPress={signOut} hitSlop={8}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Stats */}
        <Text style={styles.sectionTitle}>LIVE STATS</Text>
        <View style={styles.statsGrid}>
          <StatCard label="Open pool rides" value={String(stats.openRides)} />
          <StatCard label="Passengers booked" value={String(stats.totalPassengersToday)} sub="in open rides" />
          <StatCard label="Drivers online" value={String(stats.activeDrivers)} />
        </View>

        {/* Pool Ride Settings */}
        <Text style={styles.sectionTitle}>POOL RIDE SETTINGS</Text>
        {loadingSettings ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={styles.settingsCard}>
            <StepperField
              label="Pickup radius"
              value={settings.pickupRadius}
              step={50}
              min={100}
              max={1000}
              format={(v) => `${v}m`}
              onChange={(v) => setSettings((s) => ({ ...s, pickupRadius: v }))}
            />
            <View style={styles.settingsDivider} />
            <StepperField
              label="Dropoff radius"
              value={settings.dropoffRadius}
              step={50}
              min={100}
              max={1000}
              format={(v) => `${v}m`}
              onChange={(v) => setSettings((s) => ({ ...s, dropoffRadius: v }))}
            />
            <View style={styles.settingsDivider} />
            <StepperField
              label="Fare multiplier"
              value={Math.round(settings.fareMultiplier * 100)}
              step={5}
              min={110}
              max={200}
              format={(v) => `${v}% of base`}
              onChange={(v) => setSettings((s) => ({ ...s, fareMultiplier: v / 100 }))}
            />
            <View style={styles.settingsDivider} />
            <StepperField
              label="Max ride hours ahead"
              value={settings.maxRideHoursAhead}
              step={6}
              min={6}
              max={168}
              format={(v) => `${v}h`}
              onChange={(v) => setSettings((s) => ({ ...s, maxRideHoursAhead: v }))}
            />

            <View style={styles.formulaBox}>
              <Text style={styles.formulaTitle}>Current Fare Formula</Text>
              <Text style={styles.formulaText}>
                Per seat = ceil(baseFare × {(settings.fareMultiplier * 100).toFixed(0)}% ÷ seats){'\n'}
                Example (1200 PKR, 4 seats): {Math.ceil(1200 * settings.fareMultiplier / 4)} PKR/seat
              </Text>
            </View>

            <Pressable
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={saveSettings}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.saveBtnText}>Save Settings</Text>}
            </Pressable>
          </View>
        )}

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>QUICK ACTIONS</Text>

        {/* Customers */}
        <Pressable style={styles.ridersCard} onPress={() => router.push('/admin/customers')}>
          <View style={styles.ridersCardLeft}>
            <Text style={styles.ridersCardTitle}>👥  Customers</Text>
            <Text style={styles.ridersCardDesc}>
              View, search, edit and delete all registered users.{'\n'}
              Manage roles, profiles and account details.
            </Text>
          </View>
          <Text style={styles.ridersCardArrow}>→</Text>
        </Pressable>

        {/* Ride Categories — full in-app screen */}
        <Pressable style={styles.ridersCard} onPress={() => router.push('/admin/riders')}>
          <View style={styles.ridersCardLeft}>
            <Text style={styles.ridersCardTitle}>🏍️🚗  Ride Categories & Fares</Text>
            <Text style={styles.ridersCardDesc}>
              Set per-km fares, base fares and allowed vehicles for{'\n'}
              Bike · Ride Mini · Ride Regular AC · Ride Regular Comfort
            </Text>
          </View>
          <Text style={styles.ridersCardArrow}>→</Text>
        </Pressable>

        <View style={styles.actionsGrid}>
          {[
            { label: 'View pool rides',   icon: '🚗', desc: 'All open pool rides in Firestore' },
            { label: 'Driver approvals',  icon: '✅', desc: 'Pending driver verifications' },
            { label: 'Support chats',     icon: '💬', desc: 'Active support conversations' },
          ].map((a) => (
            <Pressable
              key={a.label}
              style={styles.actionCard}
              onPress={() => Alert.alert(a.label, 'Full admin web portal coming soon.\nManage via Firebase Console for now.')}
            >
              <Text style={styles.actionIcon}>{a.icon}</Text>
              <Text style={styles.actionLabel}>{a.label}</Text>
              <Text style={styles.actionDesc}>{a.desc}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Full admin web dashboard: manage rides, drivers, fares, and analytics at{'\n'}
            velocity-fe379.web.app/admin
          </Text>
        </View>
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
  backBtn: { width: 40 },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  signOutText: { fontSize: 13, color: colors.danger, fontWeight: '700' },

  container: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginTop: 8 },

  statsGrid: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    alignItems: 'center',
    gap: 3,
  },
  statValue: { fontSize: 26, fontWeight: '900', color: colors.primary },
  statLabel: { fontSize: 10, color: colors.muted, fontWeight: '700', textAlign: 'center' },
  statSub: { fontSize: 9, color: colors.muted, textAlign: 'center' },

  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  stepperLabel: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: { fontSize: 20, color: colors.primary, fontWeight: '900', lineHeight: 24 },
  stepperValue: { fontSize: 15, fontWeight: '800', color: colors.text, minWidth: 72, textAlign: 'center' },
  settingsDivider: { height: 1, backgroundColor: colors.border },
  formulaBox: {
    backgroundColor: '#131c0a',
    margin: 12,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  formulaTitle: { fontSize: 11, fontWeight: '800', color: colors.primary },
  formulaText: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  saveBtn: {
    height: 50,
    backgroundColor: colors.primary,
    margin: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '900', color: '#000' },

  ridersCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131c0a',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.primary + '50',
    padding: 16,
    gap: 12,
  },
  ridersCardLeft: { flex: 1, gap: 6 },
  ridersCardTitle: { fontSize: 15, fontWeight: '800', color: colors.primary },
  ridersCardDesc: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  ridersCardArrow: { fontSize: 22, color: colors.primary },

  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 6,
  },
  actionIcon: { fontSize: 24 },
  actionLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  actionDesc: { fontSize: 10, color: colors.muted, lineHeight: 14 },

  footerNote: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
  },
  footerText: { fontSize: 11, color: colors.muted, textAlign: 'center', lineHeight: 18 },
});
