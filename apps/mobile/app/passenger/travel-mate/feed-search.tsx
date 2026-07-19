/**
 * Travel Partner — find people.
 *
 * Prefix search over travelMateProfiles.displayNameLower (set on profile
 * save). Results show avatar, name, bio, a Follow/Following toggle, and tap
 * through to the person's community profile. Blocked users never appear.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  collection,
  deleteDoc,
  doc,
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
import { useBlockedSet, useFollowingSet, useMyTMProfile } from '../../../src/hooks/travelMateCommunity';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';


interface PersonRow {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  bio?: string;
  active?: boolean;
}

export default function FeedSearch() {
  const { user } = useAuth();
  const router = useRouter();
  const blocked = useBlockedSet();
  const following = useFollowingSet();
  const myProfile = useMyTMProfile();

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PersonRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Debounced prefix search
  useEffect(() => {
    const q = term.trim().toLowerCase();
    if (q.length < 2) { setResults([]); setSearched(false); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const snap = await getDocs(query(
          collection(db, 'travelMateProfiles'),
          orderBy('displayNameLower'),
          where('displayNameLower', '>=', q),
          where('displayNameLower', '<=', q + ''),
          limit(25),
        ));
        setResults(snap.docs.map(d => ({ uid: d.id, ...d.data() }) as PersonRow));
        setSearched(true);
      } catch {
        Alert.alert('Error', 'Search failed. Check your connection.');
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [term]);

  const visible = useMemo(
    () => results.filter(p => p.uid !== user?.uid && !blocked.has(p.uid)),
    [results, blocked, user?.uid],
  );

  async function toggleFollow(person: PersonRow) {
    if (!user) return;
    if (!myProfile) {
      Alert.alert('Profile needed', 'Set up your Travel Partner profile first.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Create profile', onPress: () => router.push('/passenger/travel-mate/setup') },
      ]);
      return;
    }
    const followRef = doc(db, 'travelMateFollows', `${user.uid}_${person.uid}`);
    try {
      if (following.has(person.uid)) {
        await deleteDoc(followRef);
      } else {
        await setDoc(followRef, {
          followerId: user.uid,
          followedId: person.uid,
          followerName: myProfile.displayName,
          followerPhotoURL: myProfile.photoURL ?? null,
          followedName: person.displayName,
          followedPhotoURL: person.photoURL ?? null,
          createdAt: serverTimestamp(),
        });
      }
    } catch {
      Alert.alert('Error', 'Could not update follow. Try again.');
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/travel-mate/feed' as Parameters<typeof router.replace>[0]))}
          style={s.backBtn}
        >
          <Text style={s.backText}>←</Text>
        </Pressable>
        <TextInput
          style={s.searchInput}
          value={term}
          onChangeText={setTerm}
          placeholder="Search people by name…"
          placeholderTextColor={colors.muted}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {searching && <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />}

      {!searching && term.trim().length < 2 && (
        <View style={s.hintBox}>
          <Text style={{ fontSize: 44 }}>🔍</Text>
          <Text style={s.hintTitle}>Find people</Text>
          <Text style={s.hintSub}>
            Search travellers by name, follow them to see their posts in your
            Following feed, and message them from their profile.
          </Text>
        </View>
      )}

      {!searching && searched && visible.length === 0 && term.trim().length >= 2 && (
        <View style={s.hintBox}>
          <Text style={{ fontSize: 44 }}>🤷</Text>
          <Text style={s.hintTitle}>No one found</Text>
          <Text style={s.hintSub}>Nobody on Travel Partner matches “{term.trim()}” yet.</Text>
        </View>
      )}

      <FlatList
        data={searching ? [] : visible}
        keyExtractor={p => p.uid}
        contentContainerStyle={s.listContent}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const isFollowing = following.has(item.uid);
          return (
            <Pressable
              style={s.personRow}
              onPress={() => router.push(`/passenger/travel-mate/feed-profile/${item.uid}` as Parameters<typeof router.push>[0])}
            >
              {item.photoURL ? (
                <Image source={{ uri: item.photoURL }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}><Text style={{ fontSize: 20 }}>👤</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.personName} numberOfLines={1}>{item.displayName}</Text>
                {item.bio ? <Text style={s.personBio} numberOfLines={1}>{item.bio}</Text> : null}
              </View>
              <Pressable
                style={[s.followBtn, isFollowing && s.followingBtn]}
                onPress={() => toggleFollow(item)}
                hitSlop={6}
              >
                <Text style={[s.followBtnText, isFollowing && s.followingBtnText]}>
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              </Pressable>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:{ color: colors.text, fontSize: 18, fontWeight: '700' },
  searchInput: { flex: 1, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 18, fontSize: 14 },

  hintBox:  { alignItems: 'center', paddingTop: 60, gap: 10, paddingHorizontal: 40 },
  hintTitle:{ fontSize: 19, fontWeight: '900', color: colors.text },
  hintSub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },

  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  avatar:    { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { backgroundColor: colors.glassChip, alignItems: 'center', justifyContent: 'center' },
  personName:{ fontSize: 15, fontWeight: '800', color: colors.text },
  personBio: { fontSize: 12, color: colors.muted, marginTop: 2 },

  followBtn:     { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, backgroundColor: colors.primary },
  followBtnText: { fontSize: 13, fontWeight: '900', color: '#000' },
  followingBtn:  { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.border },
  followingBtnText: { color: colors.muted },
}));
