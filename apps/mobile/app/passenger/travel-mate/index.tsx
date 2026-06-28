/**
 * Travel Mate — swipe deck screen.
 *
 * Shows a stack of candidate commuter cards fetched from getTravelMateFeed.
 * Right swipe / heart button = like (consumes quota).
 * Left swipe / X button     = pass (always free).
 * On mutual like: match celebration overlay.
 * On quota exhaustion: paywall card.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { api, type TravelMateCard } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { PrimaryButton } from '../../../src/ui/components';

const { width } = Dimensions.get('window');
const CARD_W = width - 40;
const SWIPE_THRESHOLD = CARD_W * 0.35;
const ROTATE_DEG = 12;

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
  fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

function Stars({ n }: { n: number }) {
  const full = Math.round(n);
  return (
    <Text style={{ fontSize: 12, color: '#fbbf24' }}>
      {'★'.repeat(full)}{'☆'.repeat(5 - full)}
    </Text>
  );
}

// ── Single swipeable card ─────────────────────────────────────────────────────
function SwipeCard({
  card,
  isTop,
  onLike,
  onPass,
}: {
  card: TravelMateCard;
  isTop: boolean;
  onLike: () => void;
  onPass: () => void;
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
          Animated.timing(pan, {
            toValue: { x: width * 1.5, y: g.dy },
            duration: 250,
            useNativeDriver: true,
          }).start(() => { pan.setValue({ x: 0, y: 0 }); setHint(null); onLike(); });
        } else if (g.dx < -SWIPE_THRESHOLD) {
          Animated.timing(pan, {
            toValue: { x: -width * 1.5, y: g.dy },
            duration: 250,
            useNativeDriver: true,
          }).start(() => { pan.setValue({ x: 0, y: 0 }); setHint(null); onPass(); });
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start(() => setHint(null));
        }
      },
    }),
  ).current;

  const rotate = pan.x.interpolate({
    inputRange: [-width, width],
    outputRange: [`-${ROTATE_DEG}deg`, `${ROTATE_DEG}deg`],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        s.card,
        {
          transform: [
            { translateX: pan.x },
            { translateY: pan.y },
            { rotate: isTop ? rotate : '0deg' },
          ],
          zIndex: isTop ? 10 : 1,
        },
      ]}
      {...(isTop ? panResponder.panHandlers : {})}
    >
      {/* Hint overlays */}
      {hint === 'like' && (
        <View style={[s.hintBadge, s.hintLike]}>
          <Text style={s.hintText}>LIKE ❤️</Text>
        </View>
      )}
      {hint === 'pass' && (
        <View style={[s.hintBadge, s.hintPass]}>
          <Text style={s.hintText}>PASS ✗</Text>
        </View>
      )}

      {/* Avatar placeholder */}
      <View style={s.avatarBox}>
        <Text style={s.avatarEmoji}>👤</Text>
      </View>

      {/* Info */}
      <View style={s.cardBody}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{card.displayName}</Text>
          <Text style={s.dist}>{card.distanceKm} km away</Text>
        </View>
        {card.ratingCount > 0 && (
          <View style={s.starsRow}>
            <Stars n={card.ratingAvg} />
            <Text style={s.ratingCount}>({card.ratingCount})</Text>
          </View>
        )}
        <View style={s.destRow}>
          <Text style={s.destIcon}>🏢</Text>
          <Text style={s.dest} numberOfLines={1}>{card.destinationName}</Text>
        </View>
        <View style={s.schedRow}>
          <Text style={s.schedText}>🕐 Departs {card.departTime}</Text>
          <Text style={s.schedText}>🔄 Returns {card.returnTime}</Text>
        </View>
        <View style={s.daysRow}>
          {card.commonDays.map(d => (
            <View key={d} style={s.dayChip}>
              <Text style={s.dayChipText}>{DAY_LABELS[d]}</Text>
            </View>
          ))}
          <Text style={s.commonLabel}> shared days</Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ── Paywall card ──────────────────────────────────────────────────────────────
function PaywallCard({ resetAt, tier }: { resetAt?: string; tier?: string }) {
  const resetLabel = resetAt
    ? new Date(resetAt).toLocaleDateString('en-PK', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : undefined;
  return (
    <View style={[s.card, s.paywallCard]}>
      <Text style={s.paywallEmoji}>💛</Text>
      <Text style={s.paywallTitle}>You've used all your likes</Text>
      <Text style={s.paywallSub}>
        {tier === 'subscribed'
          ? `Daily likes reset at ${resetLabel ?? 'midnight'}.`
          : `Free plan includes 4 likes per month. Resets ${resetLabel ? `on ${resetLabel}` : 'next month'}.`}
      </Text>
      <Text style={s.paywallUpgrade}>
        Subscribe for unlimited daily likes — coming soon.
      </Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function TravelMateDeck() {
  const router = useRouter();
  const [cards, setCards] = useState<TravelMateCard[]>([]);
  const [seenUids, setSeenUids] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [outOfCards, setOutOfCards] = useState(false);
  const [paywallData, setPaywallData] = useState<{ resetAt?: string; tier?: string } | null>(null);
  const [matchInfo, setMatchInfo] = useState<{ name: string; matchId: string } | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [swiping, setSwiping] = useState(false);

  const loadFeed = useCallback(async (exclude: string[]) => {
    setLoading(true);
    try {
      const { candidates } = await api.getTravelMateFeed({ limit: 10, excludeUids: exclude });
      if (candidates.length === 0) setOutOfCards(true);
      else setCards(candidates);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        setNoProfile(true);
      } else {
        Alert.alert('Error', 'Could not load commuters. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed([]); }, [loadFeed]);

  async function swipe(direction: 'like' | 'pass') {
    if (cards.length === 0 || swiping) return;
    const top = cards[0];
    if (!top) return;
    setSwiping(true);
    try {
      const res = await api.travelMateSwipe({ targetUid: top.uid, direction });
      if (direction === 'like') {
        if (res.remaining !== undefined) setRemaining(res.remaining);
        if (res.matched && res.matchId) {
          setMatchInfo({ name: top.displayName, matchId: res.matchId });
        }
      }
      const newSeen = [...seenUids, top.uid];
      setSeenUids(newSeen);
      const next = cards.slice(1);
      if (next.length <= 2) {
        // Fetch more before the deck empties.
        api.getTravelMateFeed({ limit: 10, excludeUids: newSeen })
          .then(({ candidates }) => {
            const merged = [...next, ...candidates];
            setCards(merged);
            if (merged.length === 0) setOutOfCards(true);
          })
          .catch(() => {
            setCards(next);
            if (next.length === 0) setOutOfCards(true);
          });
      } else {
        setCards(next);
      }
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/resource-exhausted') {
        const detail = (e as { details?: { resetAt?: string; tier?: string } }).details;
        setPaywallData({ resetAt: detail?.resetAt, tier: detail?.tier });
        setCards(prev => prev.slice(1));
      } else if (e instanceof FirebaseError && e.code === 'functions/already-exists') {
        // Edge case: already swiped (deck stale) — just advance.
        setCards(prev => prev.slice(1));
      }
    } finally {
      setSwiping(false);
    }
  }

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (noProfile) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backText}>←</Text>
          </Pressable>
          <Text style={s.screenTitle}>Travel Mate</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.emptyBox}>
          <Text style={s.emptyEmoji}>🤝</Text>
          <Text style={s.emptyTitle}>Set up your profile</Text>
          <Text style={s.emptySub}>Tell us about your commute to start finding compatible travel mates.</Text>
          <PrimaryButton label="Set up profile" onPress={() => router.push('/passenger/travel-mate/setup')} />
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backText}>←</Text>
          </Pressable>
          <Text style={s.screenTitle}>Travel Mate</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.emptyBox}>
          <Text style={s.emptyEmoji}>🔍</Text>
          <Text style={s.emptyTitle}>Finding commuters near you…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Top bar */}
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </Pressable>
        <Text style={s.screenTitle}>Travel Mate</Text>
        <Pressable onPress={() => router.push('/passenger/travel-mate/setup')} style={s.gearBtn}>
          <Text style={s.gearText}>⚙️</Text>
        </Pressable>
      </View>

      {/* Quota pill */}
      {remaining !== null && (
        <View style={s.quotaRow}>
          <View style={s.quotaPill}>
            <Text style={s.quotaText}>❤️ {remaining} likes left this month</Text>
          </View>
        </View>
      )}

      {/* Card deck */}
      <View style={s.deck}>
        {paywallData ? (
          <PaywallCard resetAt={paywallData.resetAt} tier={paywallData.tier} />
        ) : outOfCards || cards.length === 0 ? (
          <View style={[s.card, s.emptyCard]}>
            <Text style={s.emptyEmoji}>✨</Text>
            <Text style={s.emptyTitle}>You're all caught up!</Text>
            <Text style={s.emptySub}>No new commuters nearby right now. Check back tomorrow.</Text>
            <Pressable onPress={() => { setOutOfCards(false); loadFeed(seenUids); }} style={s.refreshBtn}>
              <Text style={s.refreshText}>Refresh</Text>
            </Pressable>
          </View>
        ) : (
          // Render top 3 cards (bottom two are visually offset for depth)
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

      {/* Action buttons */}
      {!paywallData && !outOfCards && cards.length > 0 && (
        <View style={s.actions}>
          <Pressable style={s.actionBtn} onPress={() => swipe('pass')} disabled={swiping}>
            <Text style={s.passIcon}>✗</Text>
          </Pressable>
          <Pressable style={[s.actionBtn, s.likeBtn]} onPress={() => swipe('like')} disabled={swiping}>
            <Text style={s.likeIcon}>❤️</Text>
          </Pressable>
        </View>
      )}

      {/* Match modal */}
      <Modal visible={!!matchInfo} transparent animationType="fade">
        <View style={s.matchOverlay}>
          <View style={s.matchBox}>
            <Text style={s.matchEmoji}>🎉</Text>
            <Text style={s.matchTitle}>It's a match!</Text>
            <Text style={s.matchSub}>
              You and {matchInfo?.name} both want to commute together.
            </Text>
            <ScrollView style={{ width: '100%' }}>
              <PrimaryButton
                label="Say hello 💬"
                onPress={() => {
                  setMatchInfo(null);
                  // Phase 2: navigate to match chat
                  Alert.alert('Coming soon', 'In-app Travel Mate chat launches in Phase 2!');
                }}
              />
              <Pressable onPress={() => setMatchInfo(null)} style={s.keepSwiping}>
                <Text style={s.keepSwipingText}>Keep swiping</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.background },
  topBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:       { color: colors.text, fontSize: 18, fontWeight: '700' },
  screenTitle:    { fontSize: 18, fontWeight: '900', color: colors.text },
  gearBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  gearText:       { fontSize: 16 },
  quotaRow:       { alignItems: 'center', marginBottom: 8 },
  quotaPill:      { backgroundColor: colors.surface, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 5, borderWidth: 1, borderColor: colors.border },
  quotaText:      { fontSize: 12, fontWeight: '700', color: colors.muted },
  deck:           { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Cards
  card: {
    position: 'absolute',
    width: CARD_W,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  emptyCard:      { position: 'relative', alignItems: 'center', padding: 32, gap: 12 },
  paywallCard:    { position: 'relative', alignItems: 'center', padding: 32, gap: 12 },

  avatarBox:      { height: 220, backgroundColor: '#2a2c2c', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji:    { fontSize: 80 },
  cardBody:       { padding: 18, gap: 10 },
  nameRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name:           { fontSize: 20, fontWeight: '900', color: colors.text, flex: 1 },
  dist:           { fontSize: 12, color: colors.muted, fontWeight: '600' },
  starsRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingCount:    { fontSize: 11, color: colors.muted },
  destRow:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  destIcon:       { fontSize: 14 },
  dest:           { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  schedRow:       { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  schedText:      { fontSize: 12, color: colors.muted, fontWeight: '600' },
  daysRow:        { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  dayChip:        { backgroundColor: `${colors.primary}20`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  dayChipText:    { fontSize: 11, fontWeight: '800', color: colors.primary },
  commonLabel:    { fontSize: 11, color: colors.muted },

  // Hint badges
  hintBadge:      { position: 'absolute', top: 24, zIndex: 20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 2 },
  hintLike:       { right: 16, borderColor: '#4ade80', backgroundColor: '#4ade8030' },
  hintPass:       { left: 16, borderColor: colors.danger, backgroundColor: `${colors.danger}30` },
  hintText:       { fontSize: 18, fontWeight: '900', color: colors.text },

  // Action buttons
  actions:        { flexDirection: 'row', justifyContent: 'center', gap: 28, paddingVertical: 24 },
  actionBtn:      { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  likeBtn:        { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  passIcon:       { fontSize: 26, color: colors.danger, fontWeight: '900' },
  likeIcon:       { fontSize: 26 },

  // Empty / out-of-cards
  emptyBox:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  emptyEmoji:     { fontSize: 56 },
  emptyTitle:     { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptySub:       { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  refreshBtn:     { marginTop: 12, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary },
  refreshText:    { fontSize: 14, fontWeight: '700', color: colors.primary },

  // Paywall
  paywallEmoji:   { fontSize: 56 },
  paywallTitle:   { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  paywallSub:     { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  paywallUpgrade: { fontSize: 13, color: colors.primary, textAlign: 'center', fontWeight: '700' },

  // Match modal
  matchOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  matchBox:       { backgroundColor: colors.surface, borderRadius: 24, padding: 32, alignItems: 'center', gap: 12, width: '100%', borderWidth: 1, borderColor: colors.primary },
  matchEmoji:     { fontSize: 64 },
  matchTitle:     { fontSize: 26, fontWeight: '900', color: colors.primary },
  matchSub:       { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  keepSwiping:    { alignItems: 'center', paddingVertical: 14 },
  keepSwipingText:{ fontSize: 14, fontWeight: '700', color: colors.muted },
});
