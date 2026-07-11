import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { useBlockedSet } from '../../../src/hooks/travelMateCommunity';
import { colors } from '../../../src/config';

const { width, height } = Dimensions.get('window');
const CARD_W = width - 40;
const CARD_H = height * 0.60;
const SWIPE_THRESHOLD = CARD_W * 0.35;
const ROTATE_DEG = 12;

interface TMProfile {
  uid: string;
  displayName: string;
  age?: number;
  gender: 'male' | 'female';
  genderPref: 'male' | 'female' | 'any';
  bio?: string;
  interests?: string[];
  photoURL?: string | null;
  lastActive?: { seconds: number };
  location?: { lat: number; lng: number } | null;
  searchRadiusKm?: number | null;
  travelPrefs?: {
    homeLocations?: { lat: number; lng: number; label: string }[];
    travelToLocations?: { lat: number; lng: number; label: string }[];
  };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function activityLabel(p: TMProfile): string | null {
  if (!p.lastActive) return null;
  const diffSecs = Date.now() / 1000 - p.lastActive.seconds;
  if (diffSecs < 86400) return 'Active today';
  if (diffSecs < 7 * 86400) return 'Active this week';
  return null;
}

// ── Single photo-first swipeable card ─────────────────────────────────────────
function SwipeCard({
  card, isTop, onLike, onPass,
}: {
  card: TMProfile; isTop: boolean; onLike: () => void; onPass: () => void;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const [hint, setHint] = useState<'like' | 'pass' | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isTop,
      onPanResponderMove: (_, g) => {
        pan.setValue({ x: g.dx, y: g.dy });
        setHint(g.dx > 20 ? 'like' : g.dx < -20 ? 'pass' : null);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx > SWIPE_THRESHOLD) {
          Animated.timing(pan, { toValue: { x: width * 1.5, y: g.dy }, duration: 250, useNativeDriver: true })
            .start(() => { pan.setValue({ x: 0, y: 0 }); setHint(null); onLike(); });
        } else if (g.dx < -SWIPE_THRESHOLD) {
          Animated.timing(pan, { toValue: { x: -width * 1.5, y: g.dy }, duration: 250, useNativeDriver: true })
            .start(() => { pan.setValue({ x: 0, y: 0 }); setHint(null); onPass(); });
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start(() => setHint(null));
        }
      },
    }),
  ).current;

  const rotate = pan.x.interpolate({
    inputRange: [-width, width],
    outputRange: [`-${ROTATE_DEG}deg`, `${ROTATE_DEG}deg`],
    extrapolate: 'clamp',
  });

  const actLabel = activityLabel(card);

  return (
    <Animated.View
      style={[s.card, {
        transform: [
          { translateX: pan.x },
          { translateY: pan.y },
          { rotate: isTop ? rotate : '0deg' },
        ],
        zIndex: isTop ? 10 : 1,
      }]}
      {...(isTop ? panResponder.panHandlers : {})}
    >
      {/* Photo fills the card */}
      {card.photoURL ? (
        <Image source={{ uri: card.photoURL }} style={s.cardPhoto} />
      ) : (
        <View style={s.cardPhotoPlaceholder}>
          <Text style={s.cardAvatarEmoji}>👤</Text>
        </View>
      )}

      {/* Hint labels */}
      {hint === 'like' && (
        <View style={[s.hintBadge, s.hintLike]}><Text style={s.hintText}>LIKE ❤️</Text></View>
      )}
      {hint === 'pass' && (
        <View style={[s.hintBadge, s.hintPass]}><Text style={s.hintText}>PASS ✗</Text></View>
      )}

      {/* Info overlay at the bottom */}
      <View style={s.cardOverlay}>
        {actLabel && (
          <View style={s.activeBadge}>
            <Text style={s.activeBadgeTxt}>{actLabel}</Text>
          </View>
        )}
        <Text style={s.cardName}>
          {card.displayName}{card.age ? `, ${card.age}` : ''}
        </Text>
        {card.bio ? (
          <Text style={s.cardBio} numberOfLines={2}>{card.bio}</Text>
        ) : null}
        {card.interests && card.interests.length > 0 && (
          <View style={s.cardTags}>
            {card.interests.slice(0, 4).map(tag => (
              <View key={tag} style={s.cardTag}>
                <Text style={s.cardTagTxt}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
        {/* FROM / TO — helps decide whether their routes match yours */}
        {(card.travelPrefs?.homeLocations?.length ?? 0) > 0 && (
          <Text style={s.cardTravelsTo} numberOfLines={1}>
            📍 From: {card.travelPrefs!.homeLocations!.map(p => p.label.split(',')[0]).slice(0, 2).join(' · ')}
          </Text>
        )}
        {(card.travelPrefs?.travelToLocations?.length ?? 0) > 0 && (
          <Text style={s.cardTravelsTo} numberOfLines={1}>
            🧭 To: {card.travelPrefs!.travelToLocations!.map(p => p.label.split(',')[0]).slice(0, 2).join(' · ')}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function TravelMateDiscover() {
  const router = useRouter();
  const { user } = useAuth();
  const blocked = useBlockedSet();

  const [myProfile, setMyProfile]   = useState<TMProfile | null>(null);
  const [cards, setCards]           = useState<TMProfile[]>([]);
  const [loading, setLoading]       = useState(true);
  const [noProfile, setNoProfile]   = useState(false);
  const [outOfCards, setOutOfCards] = useState(false);
  const [swiping, setSwiping]       = useState(false);
  const [matchInfo, setMatchInfo]   = useState<{ name: string; matchId: string } | null>(null);

  const loadFeed = useCallback(async (
    me: TMProfile,
    excludeUids: string[],
  ) => {
    setLoading(true);
    try {
      const cutoff = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const snap = await getDocs(query(
        collection(db, 'travelMateProfiles'),
        where('active', '==', true),
        where('lastActive', '>', cutoff),
        orderBy('lastActive', 'desc'),
        limit(60),
      ));

      // Blocked users never appear in the deck.
      const excludeSet = new Set([me.uid, ...excludeUids, ...blocked]);
      let profiles = snap.docs
        .map(d => ({ uid: d.id, ...d.data() }) as TMProfile)
        .filter(p => !excludeSet.has(p.uid))
        .filter(p => me.genderPref === 'any' || p.gender === me.genderPref);

      // Radius preference: when set (and my location is known), only show
      // people whose saved location falls inside my chosen radius.
      if (me.searchRadiusKm && me.location) {
        profiles = profiles.filter(
          p => p.location && haversineKm(me.location!, p.location) <= me.searchRadiusKm!,
        );
      }

      setCards(profiles);
      setOutOfCards(profiles.length === 0);
    } catch {
      Alert.alert('Error', 'Could not load profiles. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [blocked]);

  // On every focus: re-read profile (catches returning from setup with new profile)
  // then load the feed. Cancellation flag prevents state updates after unmount.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      setLoading(true);

      (async () => {
        try {
          const profileSnap = await getDoc(doc(db, 'travelMateProfiles', user.uid));
          if (cancelled) return;

          if (!profileSnap.exists()) {
            setNoProfile(true);
            setLoading(false);
            return;
          }

          setNoProfile(false);
          const p = { uid: user.uid, ...profileSnap.data() } as TMProfile;
          setMyProfile(p);
          setDoc(doc(db, 'travelMateProfiles', user.uid), { lastActive: serverTimestamp() }, { merge: true }).catch(() => {});

          const swipedSnap = await getDocs(
            query(collection(db, 'travelMateSwipes'), where('swiperId', '==', user.uid)),
          );
          if (cancelled) return;
          const swipedUids = swipedSnap.docs.map(d => d.data().swipedId as string);
          await loadFeed(p, swipedUids);
        } catch {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => { cancelled = true; };
    }, [user?.uid, loadFeed]),
  );

  async function swipe(direction: 'like' | 'pass') {
    if (cards.length === 0 || swiping || !user || !myProfile) return;
    const top = cards[0]!;
    setSwiping(true);
    try {
      await setDoc(doc(db, 'travelMateSwipes', `${user.uid}_${top.uid}`), {
        swiperId: user.uid,
        swipedId: top.uid,
        direction,
        createdAt: serverTimestamp(),
      });

      if (direction === 'like') {
        const theirSwipe = await getDoc(doc(db, 'travelMateSwipes', `${top.uid}_${user.uid}`));
        if (theirSwipe.exists() && theirSwipe.data().direction === 'like') {
          // Mutual like → create match. Security rules verify both swipe docs
          // and require users == the sorted pair that forms the match ID.
          const matchId = [user.uid, top.uid].sort().join('_');
          await setDoc(doc(db, 'travelMateMatches', matchId), {
            users: [user.uid, top.uid].sort(),
            userInfo: {
              [user.uid]: { displayName: myProfile.displayName, photoURL: myProfile.photoURL ?? null },
              [top.uid]: { displayName: top.displayName, photoURL: top.photoURL ?? null },
            },
            status: 'active',
            createdAt: serverTimestamp(),
            lastMessage: null,
            lastMessageAt: null,
          });
          setMatchInfo({ name: top.displayName, matchId });
        }
      }

      const next = cards.slice(1);
      setCards(next);
      if (next.length <= 2) {
        // Preload next batch
        const allSwiped = await getDocs(
          query(collection(db, 'travelMateSwipes'), where('swiperId', '==', user.uid)),
        ).then(s => s.docs.map(d => d.data().swipedId as string));
        loadFeed(myProfile, allSwiped);
      }
      if (next.length === 0) setOutOfCards(true);
    } catch {
      setCards(prev => prev.slice(1));
    } finally {
      setSwiping(false);
    }
  }

  const TopBar = () => (
    <View style={s.topBar}>
      <Pressable onPress={() => router.back()} style={s.backBtn}>
        <Text style={s.backBtnText}>← Back</Text>
      </Pressable>
      <Text style={s.screenTitle}>Find Partners</Text>
      <Pressable onPress={() => router.push('/passenger/travel-mate/setup')} style={s.gearBtn}>
        <Text style={s.gearText}>⚙️</Text>
      </Pressable>
    </View>
  );

  // ── Empty states ──────────────────────────────────────────────────────────────
  if (noProfile) {
    return (
      <SafeAreaView style={s.safe}>
        <TopBar />
        <View style={s.emptyBox}>
          <Text style={s.emptyEmoji}>💛</Text>
          <Text style={s.emptyTitle}>Set up your profile</Text>
          <Text style={s.emptySub}>Add a photo and tell people about yourself to start connecting.</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.push('/passenger/travel-mate/setup')}>
            <Text style={s.primaryBtnText}>Create profile</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <TopBar />
        <View style={s.emptyBox}>
          <Text style={s.emptyEmoji}>💛</Text>
          <Text style={s.emptyTitle}>Finding people…</Text>
          <Text style={s.emptySub}>Looking for active profiles near you.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <TopBar />

      {/* Card deck */}
      <View style={s.deck}>
        {outOfCards ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyEmoji}>✨</Text>
            <Text style={s.emptyTitle}>You're all caught up!</Text>
            <Text style={s.emptySub}>No new people right now. Try the other filter or check back later.</Text>
            <Pressable
              onPress={() => {
                setOutOfCards(false);
                if (user && myProfile) {
                  getDocs(query(collection(db, 'travelMateSwipes'), where('swiperId', '==', user.uid)))
                    .then(s => {
                      const uids = s.docs.map(d => d.data().swipedId as string);
                      loadFeed(myProfile, uids);
                    });
                }
              }}
              style={s.refreshBtn}
            >
              <Text style={s.refreshText}>Refresh</Text>
            </Pressable>
          </View>
        ) : (
          [...cards].slice(0, 3).reverse().map((card, idx, arr) => (
            <SwipeCard
              key={card.uid}
              card={card}
              isTop={idx === arr.length - 1}
              onLike={() => swipe('like')}
              onPass={() => swipe('pass')}
            />
          ))
        )}
      </View>

      {/* Like / Pass buttons */}
      {!outOfCards && cards.length > 0 && (
        <View style={s.actions}>
          <Pressable style={s.actionBtn} onPress={() => swipe('pass')} disabled={swiping}>
            <Text style={s.passIcon}>✕</Text>
          </Pressable>
          <Pressable style={[s.actionBtn, s.likeBtn]} onPress={() => swipe('like')} disabled={swiping}>
            <Text style={s.likeIcon}>❤️</Text>
          </Pressable>
        </View>
      )}

      {/* Match celebration modal */}
      <Modal visible={!!matchInfo} transparent animationType="fade">
        <View style={s.matchOverlay}>
          <View style={s.matchBox}>
            <Text style={{ fontSize: 64 }}>🎉</Text>
            <Text style={s.matchTitle}>It's a match!</Text>
            <Text style={s.matchSub}>
              You and {matchInfo?.name} both liked each other.
            </Text>
            <Pressable
              style={s.primaryBtn}
              onPress={() => {
                const id = matchInfo?.matchId;
                setMatchInfo(null);
                if (id) router.push(`/passenger/travel-mate/chat/${id}` as Parameters<typeof router.push>[0]);
              }}
            >
              <Text style={s.primaryBtnText}>Say hello 👋</Text>
            </Pressable>
            <Pressable onPress={() => setMatchInfo(null)} style={s.keepSwiping}>
              <Text style={s.keepSwipingText}>Keep swiping</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  topBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1.5, borderColor: `${colors.primary}40` },
  backBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  screenTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  gearBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  gearText:    { fontSize: 16 },

  deck: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Cards
  card:               { position: 'absolute', width: CARD_W, height: CARD_H, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surface, elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  cardPhoto:          { width: '100%', height: '100%', resizeMode: 'cover' },
  cardPhotoPlaceholder: { width: '100%', height: '100%', backgroundColor: '#2a2c2c', alignItems: 'center', justifyContent: 'center' },
  cardAvatarEmoji:    { fontSize: 80 },
  cardOverlay:        { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.65)', padding: 20, paddingBottom: 22, gap: 6 },
  activeBadge:        { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 2 },
  activeBadgeTxt:     { fontSize: 11, fontWeight: '900', color: '#000' },
  cardName:           { fontSize: 26, fontWeight: '900', color: '#fff' },
  cardBio:            { fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },
  cardTags:           { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  cardTag:            { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  cardTagTxt:         { fontSize: 11, fontWeight: '700', color: '#fff' },
  cardTravelsTo:      { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.92)', marginTop: 4 },

  hintBadge: { position: 'absolute', top: 24, zIndex: 20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 2 },
  hintLike:  { right: 16, borderColor: '#4ade80', backgroundColor: '#4ade8030' },
  hintPass:  { left: 16, borderColor: colors.danger, backgroundColor: `${colors.danger}30` },
  hintText:  { fontSize: 18, fontWeight: '900', color: '#fff' },

  actions:   { flexDirection: 'row', justifyContent: 'center', gap: 28, paddingVertical: 18 },
  actionBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  likeBtn:   { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  passIcon:  { fontSize: 28, color: colors.danger, fontWeight: '900' },
  likeIcon:  { fontSize: 28 },

  emptyBox:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  emptyCard:   { alignItems: 'center', padding: 32, gap: 12 },
  emptyEmoji:  { fontSize: 56 },
  emptyTitle:  { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptySub:    { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  refreshBtn:  { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary },
  refreshText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  primaryBtn:  { width: '100%', height: 52, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryBtnText: { fontSize: 16, fontWeight: '900', color: '#000' },

  matchOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  matchBox:       { backgroundColor: colors.surface, borderRadius: 28, padding: 36, alignItems: 'center', gap: 12, width: '100%', borderWidth: 1.5, borderColor: colors.primary },
  matchTitle:     { fontSize: 28, fontWeight: '900', color: colors.primary },
  matchSub:       { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  keepSwiping:    { paddingVertical: 12 },
  keepSwipingText:{ fontSize: 14, fontWeight: '700', color: colors.muted },
});
