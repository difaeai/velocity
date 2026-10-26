import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { appLink } from '../../../src/share/links';
import { collection, doc, getCountFromServer, getDoc, getDocs, limit, query, where } from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { useTravelMateThreads } from '../../../src/hooks/travelMateCommunity';
import { InboxModeBar } from '../../../src/ui/InboxModeBar';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';

interface TMProfile {
  uid: string;
  displayName: string;
  age?: number;
  gender: 'male' | 'female';
  genderPref: 'male' | 'female' | 'any';
  bio?: string;
  interests?: string[];
  photoURL?: string | null;
  active?: boolean;
  activeMode?: 'today' | 'week';
  travelPrefs?: { homeLocations?: unknown[]; travelToLocations?: unknown[] };
}

const GENDER_LABEL: Record<string, string> = { male: 'Male', female: 'Female' };
const PREF_LABEL: Record<string, string> = { male: 'Men', female: 'Women', any: 'Everyone' };

export default function TravelMateProfile() {
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<TMProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ followers: number; following: number; posts: number } | null>(null);
  const { matches, requests } = useTravelMateThreads();

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    getDoc(doc(db, 'travelMateProfiles', user.uid))
      .then(snap => {
        if (snap.exists()) setProfile({ uid: user.uid, ...snap.data() } as TMProfile);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Community stats (best-effort — counts render as they arrive)
    Promise.all([
      getCountFromServer(query(collection(db, 'travelMateFollows'), where('followedId', '==', user.uid))),
      getCountFromServer(query(collection(db, 'travelMateFollows'), where('followerId', '==', user.uid))),
      getCountFromServer(query(collection(db, 'travelMatePosts'), where('authorId', '==', user.uid))),
    ])
      .then(([f, g, p]) => setStats({
        followers: f.data().count,
        following: g.data().count,
        posts: p.data().count,
      }))
      .catch(() => {});
  }, [user?.uid]);

  function shareProfile() {
    if (!user) return;
    if (!profile) {
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
        `👋 I'm ${profile.displayName} on Velocity Rides Travel Partner.\n\n` +
        `Check out my profile and match with me to share rides:\n${link}`,
      title: 'Share my Travel Partner profile',
    }).catch(() => {});
  }

  // An active ride jumps straight to its trip screen (where the share button
  // lives); otherwise explain where ride links come from.
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

  const locationCount =
    (profile?.travelPrefs?.homeLocations?.length ?? 0) + (profile?.travelPrefs?.travelToLocations?.length ?? 0);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <TopBar router={router} />
        <View style={s.centered}><Text style={s.muted}>Loading…</Text></View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={s.safe}>
        <TopBar router={router} />
        <View style={s.centered}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>👤</Text>
          <Text style={s.emptyTitle}>No profile yet</Text>
          <Text style={s.emptySub}>Create your Travel Partner profile to start matching with other riders.</Text>
          <Pressable style={s.editBtn} onPress={() => router.push('/passenger/travel-mate/setup')}>
            <Text style={s.editBtnText}>Create profile</Text>
          </Pressable>
          <Pressable style={s.shareBtnGhost} onPress={shareProfile}>
            <Text style={s.shareBtnGhostText}>📤 Share my profile</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>← Book Ride</Text>
        </Pressable>
        <Text style={s.title}>My Profile</Text>
        <Pressable onPress={() => router.push('/passenger/travel-mate/setup')} style={s.editBtnSmall}>
          <Text style={s.editBtnSmallText}>Edit</Text>
        </Pressable>
      </View>
      <InboxModeBar />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Photo + basic info */}
        <View style={s.photoWrap}>
          {profile.photoURL ? (
            <Image source={{ uri: profile.photoURL }} style={s.photo} />
          ) : (
            <View style={s.photoPlaceholder}>
              <Text style={{ fontSize: 56 }}>👤</Text>
            </View>
          )}
        </View>

        <Text style={s.profileName}>{profile.displayName}{profile.age ? `, ${profile.age}` : ''}</Text>

        <View style={s.statusRow}>
          <View style={[s.statusDot, profile.active ? s.dotGreen : s.dotGrey]} />
          <Text style={s.statusText}>{profile.active ? 'Visible to others' : 'Hidden — paused'}</Text>
        </View>

        {/* Community stats — one profile powers rides, discovery and the feed */}
        <Pressable
          style={s.statsCard}
          onPress={() => user && router.push(`/passenger/travel-mate/feed-profile/${user.uid}` as Parameters<typeof router.push>[0])}
        >
          <View style={s.statCol}>
            <Text style={s.statNum}>{stats?.followers ?? '–'}</Text>
            <Text style={s.statLabel}>Followers</Text>
          </View>
          <View style={s.statDividerV} />
          <View style={s.statCol}>
            <Text style={s.statNum}>{stats?.following ?? '–'}</Text>
            <Text style={s.statLabel}>Following</Text>
          </View>
          <View style={s.statDividerV} />
          <View style={s.statCol}>
            <Text style={s.statNum}>{stats?.posts ?? '–'}</Text>
            <Text style={s.statLabel}>Posts</Text>
          </View>
        </Pressable>

        {/* Everything that used to crowd the Home hub lives here now. */}
        <View style={s.menu}>
          <MenuRow
            emoji="❤️"
            title="Matches"
            sub={matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'You both swiped right'}
            onPress={() => router.push('/passenger/travel-mate/matches')}
          />
          <MenuRow
            emoji="💬"
            title="Chats"
            sub={requests.length
              ? `${requests.length} message request${requests.length === 1 ? '' : 's'}`
              : 'Your conversations'}
            onPress={() => router.push('/passenger/travel-mate/chats')}
          />
          <MenuRow
            emoji="🚗"
            title="Share a ride link"
            sub="Partners join your ride and split the fare"
            onPress={openShareRide}
          />
          <MenuRow
            emoji="🗺️"
            title="My travel locations"
            sub={locationCount
              ? 'Where you usually start rides from and travel to'
              : 'Not set — add where you usually travel'}
            onPress={() => router.push('/passenger/travel-mate/travel-locations' as Parameters<typeof router.push>[0])}
          />
        </View>

        {profile.bio ? (
          <View style={s.card}>
            <Text style={s.cardLabel}>About</Text>
            <Text style={s.cardValue}>{profile.bio}</Text>
          </View>
        ) : null}

        <View style={s.card}>
          <Text style={s.cardLabel}>Gender</Text>
          <Text style={s.cardValue}>{GENDER_LABEL[profile.gender] ?? profile.gender}</Text>
          <Text style={[s.cardLabel, { marginTop: 10 }]}>Show me</Text>
          <Text style={s.cardValue}>{PREF_LABEL[profile.genderPref] ?? profile.genderPref}</Text>
        </View>

        {profile.interests && profile.interests.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardLabel}>Interests</Text>
            <View style={s.tagsRow}>
              {profile.interests.map(tag => (
                <View key={tag} style={s.tag}>
                  <Text style={s.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Pressable style={s.editBtn} onPress={() => router.push('/passenger/travel-mate/setup')}>
          <Text style={s.editBtnText}>Edit profile</Text>
        </Pressable>

        <Pressable style={s.shareBtnGhost} onPress={shareProfile}>
          <Text style={s.shareBtnGhostText}>📤 Share my profile</Text>
        </Pressable>

        <Pressable
          style={s.shareBtnGhost}
          onPress={() => user && router.push(`/passenger/travel-mate/feed-profile/${user.uid}` as Parameters<typeof router.push>[0])}
        >
          <Text style={s.shareBtnGhostText}>🌍 My community profile</Text>
        </Pressable>

        <Pressable
          style={s.shareBtnGhost}
          onPress={() => router.push('/passenger/travel-mate/blocked-users' as Parameters<typeof router.push>[0])}
        >
          <Text style={s.shareBtnGhostText}>🚫 Blocked users</Text>
        </Pressable>

        <Pressable style={s.shareBtnGhost} onPress={() => router.push('/referral-code')}>
          <Text style={s.shareBtnGhostText}>🎁 Partner referral code</Text>
        </Pressable>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({
  emoji, title, sub, onPress,
}: { emoji: string; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable style={s.menuRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <Text style={{ fontSize: 20 }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.menuTitle}>{title}</Text>
        <Text style={s.menuSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

function TopBar({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={s.topBar}>
      <Pressable onPress={() => router.back()} style={s.backBtn}>
        <Text style={s.backBtnText}>← Book Ride</Text>
      </Pressable>
      <Text style={s.title}>My Profile</Text>
      <View style={{ width: 60 }} />
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1.5, borderColor: `${colors.primary}40` },
  backBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },
  editBtnSmall: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  editBtnSmallText: { fontSize: 13, fontWeight: '800', color: colors.text },

  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle:{ fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptySub:  { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  muted:     { color: colors.muted, fontSize: 14 },

  scroll: { padding: 20, gap: 16, alignItems: 'center' },

  photoWrap: { width: 140, height: 180, borderRadius: 24, overflow: 'hidden', elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  photo:     { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { width: '100%', height: '100%', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },

  profileName: { fontSize: 26, fontWeight: '900', color: colors.text, marginTop: 8 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotGreen:  { backgroundColor: colors.primary },
  dotGrey:   { backgroundColor: colors.muted },
  statusText:{ fontSize: 13, color: colors.muted, fontWeight: '600' },

  statsCard:   { width: '100%', flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingVertical: 14 },
  statCol:     { flex: 1, alignItems: 'center', gap: 2 },
  statNum:     { fontSize: 18, fontWeight: '900', color: colors.text },
  statLabel:   { fontSize: 11, color: colors.muted, fontWeight: '700' },
  statDividerV:{ width: 1, backgroundColor: colors.border },

  menu:      { width: '100%', gap: 10 },
  menuRow:   { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  menuTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  menuSub:   { fontSize: 12, color: colors.muted, marginTop: 2 },
  chevron:   { fontSize: 22, color: colors.muted },

  card:      { width: '100%', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 4 },
  cardLabel: { fontSize: 11, fontWeight: '900', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  cardValue: { fontSize: 15, fontWeight: '700', color: colors.text },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  tag:     { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1, borderColor: `${colors.primary}40` },
  tagText: { fontSize: 13, fontWeight: '700', color: colors.primary },

  editBtn:     { width: '100%', height: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  editBtnText: { fontSize: 16, fontWeight: '900', color: '#000' },

  shareBtnGhost:     { width: '100%', height: 52, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  shareBtnGhostText: { fontSize: 15, fontWeight: '800', color: colors.text },
}));
