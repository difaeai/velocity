/**
 * Travel Partner — group invite link screen (deep-link target).
 *
 * velocity://passenger/travel-mate/group-invite/{groupId}
 *
 * Shows a preview of the group (previewTravelMateGroup) and lets eligible
 * users join (joinTravelMateGroup — server enforces you must be matched with
 * at least one current member). Everyone else gets an explanation + CTA.
 *
 * Robustness: the preview call is retried a few times on transient/cold-start
 * failures (deadline-exceeded, unavailable, internal) and the error state
 * always offers a way forward — retry, paste a different code, or go home —
 * so a slow first response never dead-ends the invite.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { api, type TravelMateGroupPreview } from '../../../../src/api/client';
import { useAuth } from '../../../../src/auth/AuthContext';
import { colors } from '../../../../src/config';
import { themed } from '../../../../src/theme';
import { Card, PrimaryButton } from '../../../../src/ui/components';

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

// Firebase error codes worth retrying — a cold-start / flaky-network hiccup,
// not a real "this group doesn't exist" answer.
const TRANSIENT = new Set([
  'functions/deadline-exceeded',
  'functions/unavailable',
  'functions/internal',
  'functions/cancelled',
  'functions/aborted',
  'functions/resource-exhausted',
]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function GroupInviteScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const router = useRouter();
  const { initializing } = useAuth();

  const [preview, setPreview] = useState<TravelMateGroupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!groupId) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);

    // Retry transient failures with a short backoff (cold starts, brief network
    // drops). Real answers — not-found, permission — surface immediately.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await api.previewTravelMateGroup({ groupId });
        if (seq !== loadSeq.current) return; // a newer load superseded us
        setPreview(res);
        setError(null);
        setLoading(false);
        return;
      } catch (e: unknown) {
        if (seq !== loadSeq.current) return;
        const code = e instanceof FirebaseError ? e.code : '';
        if (code === 'functions/not-found') {
          setError('This group link is invalid or the group no longer exists.');
          setLoading(false);
          return;
        }
        if (TRANSIENT.has(code) && attempt < 2) {
          await sleep(1200 * (attempt + 1));
          continue;
        }
        setError(
          TRANSIENT.has(code)
            ? "We couldn't reach Velocity just now. Check your connection and try again."
            : e instanceof Error ? e.message : 'Could not load this group.',
        );
        setLoading(false);
        return;
      }
    }
  }, [groupId]);

  // Wait for auth to settle before calling — the callable needs the ID token,
  // and a cold deep-link launch can mount this screen before auth is ready.
  useEffect(() => {
    if (initializing) return;
    load();
  }, [initializing, load]);

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

  function openCode() {
    const code = codeInput.trim();
    if (!code) return;
    setCodeInput('');
    router.replace(`/passenger/travel-mate/group-invite/${code}` as Parameters<typeof router.replace>[0]);
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

      {loading && !preview && (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>Loading group…</Text>
        </View>
      )}

      {error && !loading && (
        <ScrollView contentContainerStyle={s.center}>
          <Text style={s.bigEmoji}>🔗</Text>
          <Text style={s.lockTitle}>Couldn&apos;t open this invite</Text>
          <Text style={s.lockSub}>{error}</Text>

          <PrimaryButton label="Try again" onPress={load} />

          <Text style={s.orLabel}>OR PASTE AN INVITE CODE</Text>
          <View style={s.codeRow}>
            <TextInput
              value={codeInput}
              onChangeText={setCodeInput}
              placeholder="Invite code"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={s.codeInput}
            />
            <Pressable
              style={[s.codeGoBtn, !codeInput.trim() && { opacity: 0.4 }]}
              disabled={!codeInput.trim()}
              onPress={openCode}
            >
              <Text style={s.codeGoText}>Open</Text>
            </Pressable>
          </View>

          <Pressable style={s.homeLink} onPress={() => router.replace('/passenger/home')}>
            <Text style={s.homeLinkText}>Back to home</Text>
          </Pressable>
        </ScrollView>
      )}

      {g && preview && !error && (
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
              <Text style={s.lockTitle}>Travel Partners only</Text>
              <Text style={s.lockSub}>
                Commute groups are a Travel Partner feature. Set up your profile and match with a group member to join.
              </Text>
              <PrimaryButton
                label="Become a Travel Partner"
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

const s = themed(() => StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:{ color: colors.text, fontSize: 18, fontWeight: '700' },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },
  center:  { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  scroll:  { padding: 20, gap: 14 },
  loadingText: { fontSize: 13, color: colors.muted, marginTop: 4 },

  bigEmoji:     { fontSize: 44, textAlign: 'center' },
  groupName:    { fontSize: 22, fontWeight: '900', color: colors.text, textAlign: 'center', marginTop: 8 },
  groupDest:    { fontSize: 14, fontWeight: '700', color: colors.primary, textAlign: 'center', marginTop: 4 },
  groupSched:   { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6 },
  groupMembers: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 19 },

  lockTitle: { fontSize: 18, fontWeight: '900', color: colors.text, textAlign: 'center' },
  lockSub:   { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20, marginVertical: 10 },

  orLabel:   { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 1, marginTop: 22, marginBottom: 4 },
  codeRow:   { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  codeInput: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, color: colors.text, fontSize: 14, backgroundColor: colors.surface },
  codeGoBtn: { height: 46, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.glassLime, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  codeGoText:{ fontSize: 14, fontWeight: '900', color: colors.primary },
  homeLink:  { marginTop: 20, paddingVertical: 8 },
  homeLinkText: { fontSize: 14, fontWeight: '700', color: colors.muted },
}));
