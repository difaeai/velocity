/**
 * Travel Partner — Home hub.
 *
 * The landing screen for Travel Partner. Surfaces every action in one place:
 *   - Find travel partners  → swipe deck (discover)
 *   - Create a group / Join a group (invite code)
 *   - Matches / Chats
 *   - Share a ride link (book a ride, then invite partners to split it)
 *   - My groups (live list)
 *
 * Gated on having a Travel Partner profile — otherwise shows a create-profile CTA.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../../../src/ui/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { collection, doc, getDocs, limit, onSnapshot, query, where } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { useTravelMateThreads } from '../../../src/hooks/travelMateCommunity';
import { api } from '../../../src/api/client';
import { appLink } from '../../../src/share/links';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { useInterstitial } from '../../../src/ads';


interface Group {
  id: string;
  name: string;
  members: string[];
  destinationName?: string;
  maxSize?: number;
}

export default function TravelMateHome() {
  const { user } = useAuth();
  const router = useRouter();
  const pendingRequests = useTravelMateThreads().requests.length;
  // Preloaded while the user reads the hub, so it is ready the moment they tap
  // through to the deck rather than making them wait on a fetch.
  const showAd = useInterstitial('travel-partner-discover');
  // Edge-to-edge Android draws behind the system navigation bar — bottom
  // sheets must pad past it or their last row is hidden behind the OS bar.
  const insets = useSafeAreaInsets();

  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [myName, setMyName] = useState<string>('');
  const [hasTravelPrefs, setHasTravelPrefs] = useState<boolean | null>(null);
  const [travelPrefsDismissed, setTravelPrefsDismissed] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDest, setCreateDest] = useState('');
  const [creating, setCreating] = useState(false);

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  // Profile gate
  useEffect(() => {
    if (!user) { setHasProfile(false); return; }
    return onSnapshot(
      doc(db, 'travelMateProfiles', user.uid),
      snap => {
        setHasProfile(snap.exists());
        setMyName((snap.data()?.displayName as string) ?? '');
        // "Has travel prefs" means at least ONE saved location (home or
        // travel-to) — an empty travelPrefs object doesn't count.
        const prefs = snap.data()?.travelPrefs as
          | { homeLocations?: unknown[]; travelToLocations?: unknown[] }
          | undefined;
        const locationCount =
          (prefs?.homeLocations?.length ?? 0) + (prefs?.travelToLocations?.length ?? 0);
        setHasTravelPrefs(snap.exists() ? locationCount > 0 : null);
      },
      () => setHasProfile(false),
    );
  }, [user?.uid]);

  // Re-arm the prompt every time the user opens the Travel Partner hub: as long
  // as the profile exists with NO saved location at all, they are asked to
  // set at least one on every visit. "Maybe later" only mutes it until the
  // next time the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      setTravelPrefsDismissed(false);
    }, []),
  );

  const showTravelPrefsDialog =
    hasProfile === true && hasTravelPrefs === false && !travelPrefsDismissed;

  /**
   * Opening the swipe deck is where the section's full-screen ad fires.
   *
   * Deliberately NOT on opening Travel Partner itself. An interstitial thrown up
   * the instant a screen mounts is the placement Google's own guidance warns
   * against — the user asked for the feature and got an ad instead, which is
   * both the top cause of ad-serving limits and a reason people stop opening
   * the tab. Here the user has finished with the hub and is moving on to a
   * self-paced browsing session, which is a genuine break point.
   *
   * The ad is shown BEFORE navigating, and never blocks: if none is preloaded,
   * or the session cap has already fired, `showAd` resolves immediately and the
   * deck opens exactly as it does today.
   */
  async function openDiscover() {
    await showAd();
    router.push('/passenger/travel-mate/discover');
  }

  function shareProfile() {
    if (!user) return;
    if (!hasProfile) {
      Alert.alert(
        'No profile yet',
        'Create your Travel Partner profile first, then share your link with other riders.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Create profile', onPress: () => router.push('/passenger/travel-mate/setup') },
        ],
      );
      return;
    }
    const link = appLink(`/passenger/travel-mate/mate/${user.uid}`);
    Share.share({
      message:
        `👋 I'm ${myName ? `${myName} ` : ''}on Velocity Travel Partner.\n\n` +
        `Check out my profile and match with me to share rides:\n${link}`,
      title: 'Share my Travel Partner profile',
    }).catch(() => {});
  }

  // My groups (live)
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'travelMateGroups'), where('members', 'array-contains', user.uid)),
      snap => setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Group)),
      () => {},
    );
  }, [user?.uid]);

  async function createGroup() {
    if (creating) return;
    setCreating(true);
    try {
      const { groupId } = await api.createTravelMateGroup({
        name: createName.trim() || undefined,
        destinationName: createDest.trim() || undefined,
      });
      setCreateOpen(false);
      setCreateName('');
      setCreateDest('');
      router.push(`/passenger/travel-mate/group/${groupId}` as Parameters<typeof router.push>[0]);
      // Surface the invite code immediately — people kept creating groups and
      // never finding the code others need to join.
      Alert.alert(
        'Group created 🎉',
        `Invite code:\n\n${groupId}\n\nShare it with matched travel partners — they join via "Join a group", or by opening your invite link. The code also stays visible on the group screen.`,
        [
          {
            text: 'Share invite',
            onPress: () => {
              const link = appLink(`/passenger/travel-mate/group-invite/${groupId}`);
              Share.share({
                message:
                  `Join my Travel Partner commute group on Velocity!\n\n${link}\n\n` +
                  `Or open the app → Travel Partner → "Join a group" and paste this invite code:\n${groupId}`,
                title: 'Join my Travel Partner group',
              }).catch(() => {});
            },
          },
          { text: 'Done' },
        ],
      );
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Profile needed', 'Set up your Travel Partner profile first, then create a group.');
      } else {
        Alert.alert('Could not create group', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setCreating(false);
    }
  }

  async function joinGroup() {
    const code = joinCode.trim();
    if (!code || joining) return;
    setJoining(true);
    try {
      await api.joinTravelMateGroup({ groupId: code });
      setJoinOpen(false);
      setJoinCode('');
      router.push(`/passenger/travel-mate/group/${code}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please check the invite code and try again.');
    } finally {
      setJoining(false);
    }
  }

  // "Share a ride link" used to dead-end on the booking screen with no
  // explanation. Now: an active ride jumps straight to its trip screen (where
  // the share button lives); otherwise explain the flow first.
  async function openShareRide() {
    if (!user) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'trips'),
        where('passengerId', '==', user.uid),
        where('status', 'in', ['requested', 'accepted', 'arriving', 'arrived', 'in_progress']),
        limit(1),
      ));
      const active = snap.docs[0];
      if (active) {
        router.push(`/passenger/trip/${active.id}` as Parameters<typeof router.push>[0]);
        return;
      }
    } catch { /* query unavailable — fall through to the explainer */ }
    Alert.alert(
      'Share a ride link',
      'Ride links come from a booked ride:\n\n1. Book a ride as usual.\n2. On the trip screen, tap "🤝 Share ride link with Travel Partners".\n3. Matched partners open your link, join the same ride, and you split the fare.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Book a ride', onPress: () => router.push('/passenger/booking') },
      ],
    );
  }

  // ── Top bar ─────────────────────────────────────────────────────────────────
  const TopBar = () => (
    <View style={s.topBar}>
      <Pressable onPress={() => router.push('/passenger/home')} style={s.backBtn}>
        <Text style={s.backBtnText}>← Book Ride</Text>
      </Pressable>
      <Text style={s.screenTitle}>Travel Partner</Text>
      <Pressable onPress={() => router.push('/passenger/travel-mate/setup')} style={s.gearBtn}>
        <Text style={s.gearText}>⚙️</Text>
      </Pressable>
    </View>
  );

  // ── No profile → create-profile CTA ───────────────────────────────────────────
  if (hasProfile === false) {
    return (
      <SafeAreaView style={s.safe}>
        <TopBar />
        <View style={s.gateBox}>
          <Text style={s.gateEmoji}>💛</Text>
          <Text style={s.gateTitle}>Welcome to Travel Partner</Text>
          <Text style={s.gateSub}>
            Find travel partners heading your way, form commute groups, and split the fare.
            Set up your profile to get started.
          </Text>
          <Pressable style={s.gateBtn} onPress={() => router.push('/passenger/travel-mate/setup')}>
            <Text style={s.gateBtnText}>Create my profile</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <TopBar />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero — Find travel partners */}
        <Pressable
          style={({ pressed }) => [s.hero, pressed && s.heroPressed]}
          onPress={openDiscover}
          accessibilityRole="button"
          accessibilityLabel="Find travel partners"
          accessibilityHint="Opens the swipe deck to discover riders going your way"
        >
          <View style={{ flex: 1 }}>
            <Text style={s.heroKicker}>DISCOVER</Text>
            <Text style={s.heroTitle}>Find travel partners</Text>
            <Text style={s.heroSub}>Swipe to match with riders going your way</Text>
            <TapToExplore />
          </View>
          <View style={s.heroIconWrap}>
            <Text style={s.heroIcon}>🔍</Text>
          </View>
        </Pressable>

        {/* Quick actions grid */}
        <View style={s.grid}>
          <ActionTile
            emoji="🤝"
            label="Create a group"
            sub="Start a commute group"
            onPress={() => setCreateOpen(true)}
          />
          <ActionTile
            emoji="➕"
            label="Join a group"
            sub="Use an invite code"
            onPress={() => setJoinOpen(true)}
          />
          <ActionTile
            emoji="❤️"
            label="Matches"
            sub="You both swiped right"
            onPress={() => router.push('/passenger/travel-mate/matches')}
          />
          <ActionTile
            emoji="💬"
            label="Chats"
            sub={
              pendingRequests > 0
                ? `${pendingRequests} message request${pendingRequests === 1 ? '' : 's'}`
                : 'Your conversations'
            }
            onPress={() => router.push('/passenger/travel-mate/chats')}
          />
        </View>

        {/* Share a ride link */}
        <Pressable style={s.shareCard} onPress={openShareRide}>
          <Text style={s.shareIcon}>🚗</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.shareTitle}>Share a ride link</Text>
            <Text style={s.shareSub}>Share your active ride so partners join it and split the fare</Text>
          </View>
          <Text style={s.chevron}>›</Text>
        </Pressable>

        {/* Share my profile */}
        <Pressable style={s.shareCard} onPress={shareProfile}>
          <Text style={s.shareIcon}>📤</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.shareTitle}>Share my profile</Text>
            <Text style={s.shareSub}>Send your profile link so other riders can view and match with you</Text>
          </View>
          <Text style={s.chevron}>›</Text>
        </Pressable>

        {/* My groups */}
        <View style={s.sectionRow}>
          <Text style={s.sectionHead}>My groups</Text>
          {groups.length > 0 && (
            <Pressable onPress={() => setJoinOpen(true)}>
              <Text style={s.sectionAction}>+ Join</Text>
            </Pressable>
          )}
        </View>

        {groups.length === 0 ? (
          <Pressable style={s.emptyGroups} onPress={() => setCreateOpen(true)}>
            <Text style={s.emptyGroupsEmoji}>🤝</Text>
            <Text style={s.emptyGroupsTitle}>No groups yet</Text>
            <Text style={s.emptyGroupsSub}>Create a commute group and invite your matches to share rides.</Text>
            <View style={s.emptyGroupsBtn}><Text style={s.emptyGroupsBtnText}>Create a group</Text></View>
          </Pressable>
        ) : (
          groups.map(g => (
            <Pressable
              key={g.id}
              style={s.groupRow}
              onPress={() => router.push(`/passenger/travel-mate/group/${g.id}` as Parameters<typeof router.push>[0])}
            >
              <View style={s.groupIcon}><Text style={{ fontSize: 22 }}>🤝</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.groupName} numberOfLines={1}>{g.name}</Text>
                <Text style={s.groupSub} numberOfLines={1}>
                  {g.members.length}/{g.maxSize ?? 4} members{g.destinationName ? ` · ${g.destinationName}` : ''}
                </Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
          ))
        )}

        {/* Profile shortcut */}
        <Pressable style={s.profileRow} onPress={() => router.push('/passenger/travel-mate/profile')}>
          <Text style={{ fontSize: 20 }}>👤</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.profileTitle}>My profile</Text>
            <Text style={s.profileSub}>Edit photo, bio, interests and visibility</Text>
          </View>
          <Text style={s.chevron}>›</Text>
        </Pressable>

        {/* Travel locations shortcut */}
        <Pressable
          style={s.profileRow}
          onPress={() => router.push('/passenger/travel-mate/travel-locations' as Parameters<typeof router.push>[0])}
        >
          <Text style={{ fontSize: 20 }}>🗺️</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.profileTitle}>My travel locations</Text>
            <Text style={s.profileSub}>
              {hasTravelPrefs
                ? 'Where you usually start rides from and travel to'
                : 'Set where you usually start rides from and travel to'}
            </Text>
          </View>
          <Text style={s.chevron}>›</Text>
        </Pressable>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Create group modal */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: 28 + insets.bottom }]}>
            <Text style={s.modalTitle}>Create a group</Text>
            <Text style={s.modalSub}>Name your commute group. You can invite matched partners once it's created.</Text>
            <TextInput
              style={s.input}
              value={createName}
              onChangeText={setCreateName}
              placeholder="Group name (e.g. Office Commute)"
              placeholderTextColor={colors.muted}
              maxLength={40}
            />
            <TextInput
              style={s.input}
              value={createDest}
              onChangeText={setCreateDest}
              placeholder="Destination (optional)"
              placeholderTextColor={colors.muted}
              maxLength={60}
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => { setCreateOpen(false); setCreateName(''); setCreateDest(''); }} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={createGroup} disabled={creating} style={[s.confirmBtn, creating && { opacity: 0.5 }]}>
                <Text style={s.confirmBtnText}>{creating ? 'Creating…' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Post-profile travel-locations dialog */}
      <Modal
        visible={showTravelPrefsDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setTravelPrefsDismissed(true)}
      >
        <View style={s.dialogOverlay}>
          <View style={s.dialogBox}>
            <Text style={s.dialogEmoji}>🗺️</Text>
            <Text style={s.dialogTitle}>Set your travel locations</Text>
            <Text style={s.dialogText}>
              First, drop the pin you usually <Text style={s.dialogBold}>start rides from</Text> —
              it's wherever you are when you book (a coffee shop counts!), not a permanent home
              address. Then add the places you usually <Text style={s.dialogBold}>travel to</Text>.
              You can save more than one of each.
            </Text>
            <Text style={s.dialogText}>
              This helps other Travel Partner users guess your routes and find you as a partner —
              and helps riders see where you usually go.
            </Text>
            <Text style={[s.dialogText, s.dialogBold]}>
              Please set at least one location — we'll keep reminding you here until you do.
            </Text>
            <Pressable
              style={s.dialogPrimaryBtn}
              onPress={() => {
                setTravelPrefsDismissed(true);
                router.push('/passenger/travel-mate/travel-locations' as Parameters<typeof router.push>[0]);
              }}
            >
              <Text style={s.dialogPrimaryText}>Set up now</Text>
            </Pressable>
            <Pressable style={s.dialogSkipBtn} onPress={() => setTravelPrefsDismissed(true)}>
              <Text style={s.dialogSkipText}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Join group modal */}
      <Modal visible={joinOpen} transparent animationType="slide" onRequestClose={() => setJoinOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: 28 + insets.bottom }]}>
            <Text style={s.modalTitle}>Join a group</Text>
            <Text style={s.modalSub}>Ask the group creator to share their invite code with you.</Text>
            <TextInput
              style={s.input}
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="Paste invite code…"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => { setJoinOpen(false); setJoinCode(''); }} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={joinGroup} disabled={joining || !joinCode.trim()} style={[s.confirmBtn, (!joinCode.trim() || joining) && { opacity: 0.5 }]}>
                <Text style={s.confirmBtnText}>{joining ? 'Joining…' : 'Join'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Quick-action tile ──────────────────────────────────────────────────────────
function ActionTile({
  emoji, label, sub, onPress,
}: { emoji: string; label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable style={s.tile} onPress={onPress}>
      <Text style={s.tileEmoji}>{emoji}</Text>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.tileSub}>{sub}</Text>
    </Pressable>
  );
}

/**
 * "Tap to explore" cue for the Discover hero.
 *
 * The hero was already a Pressable, but nothing on it said so: it reads as a
 * banner, and the quick-action tiles below it look far more like buttons because
 * they are visibly separate cards. Users were scrolling straight past the one
 * entry point to the swipe deck.
 *
 * The pill is the label; the slow breathing loop is what pulls the eye to it.
 * Kept to opacity + scale so it runs on the native driver — no layout work per
 * frame, and nothing below it moves.
 */
function TapToExplore() {
  // Lazy initialiser rather than `useRef(new Animated.Value(…))`, matching
  // DraggableSheet: the ref form constructs a throwaway Value on every render,
  // and reading `.current` during render trips the refs lint rule.
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    // Animations survive unmount otherwise, and keep a retained frame callback
    // running behind whatever screen the user moved on to.
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        s.heroCta,
        {
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }),
          transform: [
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] }) },
          ],
        },
      ]}
    >
      <Text style={s.heroCtaText}>👆 Tap to explore partners</Text>
    </Animated.View>
  );
}

const s = themed(() => StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  topBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1.5, borderColor: `${colors.primary}40` },
  backBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  screenTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  gearBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  gearText:    { fontSize: 16 },

  scroll: { padding: 16, gap: 14 },

  // Hero
  hero:        { flexDirection: 'row', alignItems: 'center', borderRadius: 20, padding: 20, backgroundColor: colors.primary, gap: 14 },
  heroKicker:  { fontSize: 11, fontWeight: '900', color: 'rgba(0,0,0,0.65)', letterSpacing: 1.2 },
  heroTitle:   { fontSize: 22, fontWeight: '900', color: '#000', marginTop: 4 },
  heroSub:     { fontSize: 13, color: 'rgba(0,0,0,0.75)', marginTop: 4, lineHeight: 18 },
  heroIconWrap:{ width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  heroIcon:    { fontSize: 30 },
  heroPressed: { opacity: 0.85 },
  // Dark pill on the lime hero — the one high-contrast element on the card, so
  // the eye lands on it. alignSelf keeps it hugging its text instead of
  // stretching the full width like a second banner.
  heroCta:     { alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: 'rgba(0,0,0,0.82)' },
  heroCtaText: { fontSize: 12.5, fontWeight: '900', color: '#ffffff', letterSpacing: 0.2 },

  // Quick actions grid
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile:      { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 3 },
  tileEmoji: { fontSize: 26, marginBottom: 4 },
  tileLabel: { fontSize: 15, fontWeight: '800', color: colors.text },
  tileSub:   { fontSize: 12, color: colors.muted },

  // Community feed
  communityCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: `${colors.primary}18`, borderRadius: 16, borderWidth: 1.5, borderColor: `${colors.primary}55`, padding: 16 },

  // Share a ride
  shareCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 },
  shareIcon: { fontSize: 26 },
  shareTitle:{ fontSize: 15, fontWeight: '800', color: colors.text },
  shareSub:  { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },

  // Sections
  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sectionHead:  { fontSize: 13, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
  sectionAction:{ fontSize: 13, fontWeight: '800', color: colors.primary },

  // Group rows
  groupRow:  { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 14 },
  groupIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.primary}22`, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 15, fontWeight: '800', color: colors.text },
  groupSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },
  chevron:   { fontSize: 22, color: colors.muted },

  // Empty groups
  emptyGroups:     { alignItems: 'center', padding: 24, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6 },
  emptyGroupsEmoji:{ fontSize: 30 },
  emptyGroupsTitle:{ fontSize: 15, fontWeight: '900', color: colors.text },
  emptyGroupsSub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 18 },
  emptyGroupsBtn:  { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary },
  emptyGroupsBtnText: { fontSize: 14, fontWeight: '800', color: '#000' },

  // Profile shortcut
  profileRow:  { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 6 },
  profileTitle:{ fontSize: 15, fontWeight: '800', color: colors.text },
  profileSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },

  // Profile gate
  gateBox:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  gateEmoji: { fontSize: 60 },
  gateTitle: { fontSize: 24, fontWeight: '900', color: colors.text, textAlign: 'center' },
  gateSub:   { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  gateBtn:   { width: '100%', height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  gateBtnText: { fontSize: 16, fontWeight: '900', color: '#000' },

  // Travel-locations dialog
  dialogOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialogBox:        { width: '100%', backgroundColor: colors.surface, borderRadius: 24, padding: 26, gap: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  dialogEmoji:      { fontSize: 44 },
  dialogTitle:      { fontSize: 19, fontWeight: '900', color: colors.text, textAlign: 'center' },
  dialogText:       { fontSize: 13, color: colors.muted, lineHeight: 19, textAlign: 'center' },
  dialogBold:       { fontWeight: '900', color: colors.text },
  dialogPrimaryBtn: { width: '100%', height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  dialogPrimaryText:{ fontSize: 15, fontWeight: '900', color: '#000' },
  dialogSkipBtn:    { paddingVertical: 6 },
  dialogSkipText:   { fontSize: 13, fontWeight: '700', color: colors.muted },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 14 },
  modalTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub:     { fontSize: 13, color: colors.muted, lineHeight: 18 },
  input:        { height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn:    { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:{ fontSize: 14, fontWeight: '700', color: colors.muted },
  confirmBtn:   { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText:{ fontSize: 14, fontWeight: '800', color: '#000' },
}));
