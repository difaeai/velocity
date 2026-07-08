/**
 * Travel Mate — group invite link screen (deep-link target).
 *
 * velocity://passenger/travel-mate/group-invite/{groupId}
 *
 * Shows a preview of the group (previewTravelMateGroup) and lets eligible
 * users join (joinTravelMateGroup — server enforces you must be matched with
 * at least one current member). Everyone else gets an explanation + CTA.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { api, type TravelMateGroupPreview } from '../../../../src/api/client';
import { colors } from '../../../../src/config';
import { Card, PrimaryButton } from '../../../../src/ui/components';

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

export default function GroupInviteScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const router = useRouter();

  const [preview, setPreview] = useState<TravelMateGroupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) return;
    try {
      const res = await api.previewTravelMateGroup({ groupId });
      setPreview(res);
      setError(null);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/not-found') {
        setError('This group link is invalid or the group no longer exists.');
      } else {
        setError(e instanceof Error ? e.message : 'Could not load this group.');
      }
    }
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  async function join() {
    if (!groupId) return;
    setJoining(true);
    try {
      await api.joinTravelMateGroup({ groupId });
      router.replace(`/passenger/travel-mate/group/${groupId}` as Parameters<typeof router.replace>[0]);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/permission-denied') {
        Alert.alert('Travel partners only', "You can only join a group you've matched into. Match with a member first.");
      } else if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Cannot join', e.message);
      } else {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not join the group.');
      }
      await load();
    } finally {
      setJoining(false);
    }
  }

  const g = preview?.group;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/passenger/home')} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </Pressable>
        <Text style={s.title}>Group invite</Text>
        <View style={{ width: 36 }} />
      </View>

      {!preview && !error && (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      )}

      {error && (
        <View style={s.center}>
          <Text style={s.bigEmoji}>🔗</Text>
          <Text style={s.lockTitle}>Link problem</Text>
          <Text style={s.lockSub}>{error}</Text>
        </View>
      )}

      {g && preview && (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Card>
            <Text style={s.bigEmoji}>🤝</Text>
            <Text style={s.groupName}>{g.name}</Text>
            {!!g.destinationName && <Text style={s.groupDest}>→ {g.destinationName}</Text>}
            {g.schedule && (
              <Text style={s.groupSched}>
                {g.schedule.days.map(d => DAY_LABELS[d] ?? d).join(', ')} · departs {g.schedule.departTime}
              </Text>
            )}
            <Text style={s.groupMembers}>
              {g.memberCount}/{g.maxSize} members: {g.memberNames.join(', ')}
            </Text>
          </Card>

          {preview.alreadyMember ? (
            <PrimaryButton
              label="Open group"
              onPress={() => router.replace(`/passenger/travel-mate/group/${groupId}` as Parameters<typeof router.replace>[0])}
            />
          ) : preview.canJoin ? (
            <PrimaryButton
              label={joining ? 'Joining…' : 'Join group'}
              disabled={joining}
              onPress={join}
            />
          ) : preview.reason === 'no_profile' ? (
            <Card>
              <Text style={s.lockTitle}>Travel Mates only</Text>
              <Text style={s.lockSub}>
                Commute groups are a Travel Mate feature. Set up your profile and match with a group member to join.
              </Text>
              <PrimaryButton
                label="Become a Travel Mate"
                onPress={() => router.replace('/passenger/travel-mate/setup' as Parameters<typeof router.replace>[0])}
              />
            </Card>
          ) : preview.reason === 'not_partner' ? (
            <Card>
              <Text style={s.lockTitle}>Match with a member first</Text>
              <Text style={s.lockSub}>
                {"You can only join a group you've matched into. Find one of its members in Discover and match with them."}
              </Text>
              <PrimaryButton
                label="Open Discover"
                onPress={() => router.replace('/passenger/travel-mate/discover' as Parameters<typeof router.replace>[0])}
              />
            </Card>
          ) : (
            <Card>
              <Text style={s.lockTitle}>Group unavailable</Text>
              <Text style={s.lockSub}>This group is full or no longer open to new members.</Text>
            </Card>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:{ color: colors.text, fontSize: 18, fontWeight: '700' },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  scroll:  { padding: 20, gap: 14 },

  bigEmoji:     { fontSize: 44, textAlign: 'center' },
  groupName:    { fontSize: 22, fontWeight: '900', color: colors.text, textAlign: 'center', marginTop: 8 },
  groupDest:    { fontSize: 14, fontWeight: '700', color: colors.primary, textAlign: 'center', marginTop: 4 },
  groupSched:   { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6 },
  groupMembers: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 19 },

  lockTitle: { fontSize: 18, fontWeight: '900', color: colors.text, textAlign: 'center' },
  lockSub:   { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20, marginVertical: 10 },
});
