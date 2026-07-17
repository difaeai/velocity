/**
 * Travel Partner — message requests (Instagram-style).
 *
 * When someone you haven't matched with messages you, their opening message
 * lands here instead of in Chats. You can Accept — which opens the thread for
 * both of you and lets them reply again — or Delete, which wipes the message
 * and closes the thread for good.
 *
 * They only ever get one message until you answer, so each row shows the whole
 * request: who it's from and exactly what they said.
 */
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { useTravelMateThreads, type TravelThread } from '../../../src/hooks/travelMateCommunity';
import { MailIcon } from '../../../src/ui/TabBarIcons';

function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - seconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function MessageRequests() {
  const router = useRouter();
  const { requests } = useTravelMateThreads();
  // Which request is mid-flight, so its buttons can't be double-tapped.
  const [busy, setBusy] = useState<string | null>(null);

  async function accept(thread: TravelThread) {
    setBusy(thread.id);
    try {
      await api.acceptTravelMateMessageRequest({ matchId: thread.id });
      router.push(`/passenger/travel-mate/chat/${thread.id}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      Alert.alert('Could not accept', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete(thread: TravelThread) {
    const name = senderOf(thread)?.displayName ?? 'this person';
    Alert.alert(
      'Delete request?',
      `The message from ${name} will be deleted and they won't be able to message you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(thread.id);
            try {
              await api.declineTravelMateMessageRequest({ matchId: thread.id });
            } catch (e: unknown) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>← Chats</Text>
        </Pressable>
        <Text style={s.title}>Requests</Text>
        <View style={{ width: 70 }} />
      </View>

      {requests.length === 0 ? (
        <View style={s.emptyBox}>
          <View style={s.emptyIconWrap}>
            <MailIcon color={colors.primary} size={40} />
          </View>
          <Text style={s.emptyTitle}>No message requests</Text>
          <Text style={s.emptySub}>
            When someone you haven&apos;t matched with messages you, it will land here first.
          </Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListHeaderComponent={
            <Text style={s.blurb}>
              These people aren&apos;t matched with you. They can send one message and nothing more
              until you accept.
            </Text>
          }
          renderItem={({ item }) => {
            const sender = senderOf(item);
            const working = busy === item.id;
            return (
              <View style={s.card}>
                <View style={s.cardTop}>
                  {sender?.photoURL ? (
                    <Image source={{ uri: sender.photoURL }} style={s.avatar} />
                  ) : (
                    <View style={s.avatarFallback}><Text style={{ fontSize: 22 }}>👤</Text></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{sender?.displayName ?? 'Someone'}</Text>
                    {item.lastMessageAt && (
                      <Text style={s.time}>{timeAgo(item.lastMessageAt.seconds)}</Text>
                    )}
                  </View>
                </View>

                <View style={s.messageBubble}>
                  <Text style={s.messageText}>{item.lastMessage ?? 'Sent you a message'}</Text>
                </View>

                <View style={s.actions}>
                  <Pressable
                    style={[s.deleteBtn, working && { opacity: 0.5 }]}
                    disabled={working}
                    onPress={() => confirmDelete(item)}
                  >
                    <Text style={s.deleteText}>Delete</Text>
                  </Pressable>
                  <Pressable
                    style={[s.acceptBtn, working && { opacity: 0.5 }]}
                    disabled={working}
                    onPress={() => accept(item)}
                  >
                    <Text style={s.acceptText}>{working ? '…' : 'Accept'}</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function senderOf(thread: TravelThread) {
  return thread.requestFrom ? thread.userInfo?.[thread.requestFrom] : undefined;
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1.5, borderColor: `${colors.primary}40` },
  backBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },

  blurb: { fontSize: 12, color: colors.muted, lineHeight: 18, marginBottom: 4 },

  emptyBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  emptyIconWrap: {
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: colors.glassLime,
    borderWidth: 1, borderColor: colors.glassLimeBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle:{ fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptySub:  { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 22 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:  { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.glassChip,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 15, fontWeight: '800', color: colors.text },
  time: { fontSize: 11, color: colors.muted, marginTop: 2 },

  messageBubble: {
    backgroundColor: colors.glassChip,
    borderRadius: 14,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  messageText: { fontSize: 14, color: colors.text, lineHeight: 20 },

  actions: { flexDirection: 'row', gap: 10 },
  deleteBtn: {
    flex: 1, height: 44, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  deleteText: { fontSize: 14, fontWeight: '800', color: colors.muted },
  acceptBtn: {
    flex: 1, height: 44, borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  acceptText: { fontSize: 14, fontWeight: '900', color: '#000' },
});
