import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';

type NotifType = 'ride' | 'promo' | 'system' | 'wallet';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: NotifType;
  timestamp: Timestamp | null;
  read: boolean;
}

const TYPE_META: Record<NotifType, { icon: string; color: string }> = {
  ride:   { icon: '🚗', color: '#3b82f6' },
  promo:  { icon: '🎁', color: '#f59e0b' },
  system: { icon: 'ℹ️', color: '#8b5cf6' },
  wallet: { icon: '💳', color: '#10b981' },
};

function formatRelativeTime(ts: Timestamp | null): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts.toDate().getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return ts.toDate().toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications', user.uid, 'items'),
      orderBy('timestamp', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(
        snap.docs.map((d) => ({
          id: d.id,
          title: d.data().title as string,
          body: d.data().body as string,
          type: (d.data().type as NotifType) ?? 'system',
          timestamp: d.data().timestamp as Timestamp | null,
          read: (d.data().read as boolean) ?? false,
        })),
      );
      setLoading(false);
    });
    return unsub;
  }, [user]);

  async function markRead(id: string) {
    if (!user) return;
    await updateDoc(doc(db, 'notifications', user.uid, 'items', id), { read: true });
  }

  async function markAllRead() {
    if (!user) return;
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((n) =>
      batch.update(doc(db, 'notifications', user.uid, 'items', n.id), { read: true }),
    );
    await batch.commit();
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

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
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 ? (
          <Pressable onPress={markAllRead} hitSlop={8}>
            <Text style={styles.markAllBtn}>Mark all read</Text>
          </Pressable>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptySub}>
            We'll notify you about your rides, promotions, and account updates here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {notifications.map((notif) => {
            const meta = TYPE_META[notif.type] ?? TYPE_META.system;
            return (
              <Pressable
                key={notif.id}
                style={[styles.card, !notif.read && styles.cardUnread]}
                onPress={() => { if (!notif.read) markRead(notif.id); }}
              >
                <View style={[styles.iconWrap, { backgroundColor: `${meta.color}25`, borderColor: `${meta.color}50` }]}>
                  <Text style={styles.icon}>{meta.icon}</Text>
                </View>
                <View style={styles.content}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title} numberOfLines={1}>{notif.title}</Text>
                    {!notif.read && <View style={styles.dot} />}
                  </View>
                  <Text style={styles.body} numberOfLines={2}>{notif.body}</Text>
                  <Text style={styles.time}>{formatRelativeTime(notif.timestamp)}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
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
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  markAllBtn: { fontSize: 13, fontWeight: '700', color: colors.primary },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyIcon: { fontSize: 52, marginBottom: 4 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  emptySub: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  list: { padding: 14, gap: 10 },

  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  cardUnread: {
    borderColor: `${colors.primary}50`,
    backgroundColor: '#1c2010',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: { fontSize: 20 },
  content: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '800', color: colors.text, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, flexShrink: 0 },
  body: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  time: { fontSize: 11, color: `${colors.muted}99`, marginTop: 2 },
});
