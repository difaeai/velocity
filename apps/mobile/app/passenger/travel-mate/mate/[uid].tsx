/**
 * Travel Mate — public profile link screen (deep-link target).
 *
 * velocity://passenger/travel-mate/mate/{uid}
 *
 * Lets anyone with the link view a Travel Mate profile as a visitor:
 *  - visitor has a profile      → profile card + CTA to find them in Discover
 *  - visitor has no profile     → profile card + CTA to create a profile first
 *  - own link                   → profile card + shortcut to My Profile
 *  - profile deleted / bad link → friendly error state
 *
 * Reads travelMateProfiles/{uid} directly — Firestore rules already allow any
 * signed-in user to read profiles (same read the swipe deck uses).
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../../../src/firebase';
import { useAuth } from '../../../../src/auth/AuthContext';
import { areaLabel } from '../../../../src/lib/areaLabel';
import { colors } from '../../../../src/config';
import { PrimaryButton } from '../../../../src/ui/components';

interface TravelPoint { lat: number; lng: number; label: string }

interface TMProfile {
  uid: string;
  displayName: string;
  age?: number;
  gender: 'male' | 'female';
  bio?: string;
  interests?: string[];
  photoURL?: string | null;
  active?: boolean;
  travelPrefs?: {
    homeLocations?: TravelPoint[];
    travelToLocations?: TravelPoint[];
  };
}

const GENDER_LABEL: Record<string, string> = { male: 'Male', female: 'Female' };

export default function TravelMateVisitorProfile() {
  const params = useLocalSearchParams<{ uid: string }>();
  const mateUid = Array.isArray(params.uid) ? params.uid[0] : params.uid;
  const { user } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<TMProfile | null>(null);
  const [iHaveProfile, setIHaveProfile] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!mateUid || !user) { setLoading(false); return; }
    setLoading(true);
    setNotFound(false);
    Promise.all([
      getDoc(doc(db, 'travelMateProfiles', mateUid)),
      getDoc(doc(db, 'travelMateProfiles', user.uid)),
    ])
      .then(([mateSnap, mySnap]) => {
        if (mateSnap.exists()) {
          setProfile({ uid: mateUid, ...mateSnap.data() } as TMProfile);
        } else {
          setNotFound(true);
        }
        setIHaveProfile(mySnap.exists());
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mateUid, user?.uid]);

  const isOwnProfile = !!user && user.uid === mateUid;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/passenger/travel-mate')}
          style={s.backBtn}
        >
          <Text style={s.backText}>←</Text>
        </Pressable>
        <Text style={s.title}>TravelMate profile</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading && (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      )}

      {!loading && (notFound || !profile) && (
        <View style={s.center}>
          <Text style={s.lockEmoji}>🔗</Text>
          <Text style={s.lockTitle}>Profile not found</Text>
          <Text style={s.lockSub}>
            This profile link is invalid, or the profile no longer exists.
          </Text>
          <PrimaryButton
            label="Explore TravelMate"
            onPress={() => router.replace('/passenger/travel-mate' as Parameters<typeof router.replace>[0])}
          />
        </View>
      )}

      {!loading && profile && (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
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
            <Text style={s.statusText}>
              {profile.active ? 'Active on TravelMate' : 'Not currently active'}
            </Text>
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

          {/* Visitors only ever see coarse AREA names (e.g. "F-7", "Bahria
              Town Phase 1") — never a street or house address. */}
          {(profile.travelPrefs?.homeLocations?.length ?? 0) > 0 && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Usually starts rides from</Text>
              <View style={s.tagsRow}>
                {profile.travelPrefs!.homeLocations!.map((p, i) => (
                  <View key={`${p.label}-${i}`} style={s.tag}>
                    <Text style={s.tagText}>📍 {areaLabel(p.label)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {(profile.travelPrefs?.travelToLocations?.length ?? 0) > 0 && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Usually travels to</Text>
              <View style={s.tagsRow}>
                {profile.travelPrefs!.travelToLocations!.map((p, i) => (
                  <View key={`${p.label}-${i}`} style={s.tag}>
                    <Text style={s.tagText}>🧭 {areaLabel(p.label)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {isOwnProfile ? (
            <View style={s.ctaCard}>
              <Text style={s.ctaTitle}>This is your profile</Text>
              <Text style={s.ctaSub}>This is how other riders see you when you share your link.</Text>
              <PrimaryButton
                label="Open My Profile"
                onPress={() => router.replace('/passenger/travel-mate/profile' as Parameters<typeof router.replace>[0])}
              />
            </View>
          ) : iHaveProfile === false ? (
            <View style={s.ctaCard}>
              <Text style={s.lockEmoji}>🔒</Text>
              <Text style={s.ctaTitle}>{"You're browsing as a visitor"}</Text>
              <Text style={s.ctaSub}>
                Want to match and ride with {profile.displayName}? Create your own
                TravelMate profile first — it only takes a minute.
              </Text>
              <PrimaryButton
                label="Create my profile"
                onPress={() => router.replace('/passenger/travel-mate/setup' as Parameters<typeof router.replace>[0])}
              />
            </View>
          ) : (
            <View style={s.ctaCard}>
              <Text style={s.ctaTitle}>Like what you see?</Text>
              <Text style={s.ctaSub}>
                Find {profile.displayName} in Discover and swipe to match — once you
                match, you can chat and share rides together.
              </Text>
              <PrimaryButton
                label="Find them in Discover"
                onPress={() => router.replace('/passenger/travel-mate/discover' as Parameters<typeof router.replace>[0])}
              />
            </View>
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

  scroll: { padding: 20, gap: 16, alignItems: 'center' },

  photoWrap: { width: 140, height: 180, borderRadius: 24, overflow: 'hidden', elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  photo:     { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { width: '100%', height: '100%', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },

  profileName: { fontSize: 26, fontWeight: '900', color: colors.text, marginTop: 8 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotGreen:  { backgroundColor: '#4ade80' },
  dotGrey:   { backgroundColor: colors.muted },
  statusText:{ fontSize: 13, color: colors.muted, fontWeight: '600' },

  card:      { width: '100%', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 4 },
  cardLabel: { fontSize: 11, fontWeight: '900', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  cardValue: { fontSize: 15, fontWeight: '700', color: colors.text },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  tag:     { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1, borderColor: `${colors.primary}40` },
  tagText: { fontSize: 13, fontWeight: '700', color: colors.primary },

  ctaCard:  { width: '100%', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 8, alignItems: 'center', marginTop: 8 },
  ctaTitle: { fontSize: 17, fontWeight: '900', color: colors.text, textAlign: 'center' },
  ctaSub:   { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19, marginBottom: 6 },

  lockEmoji: { fontSize: 40, textAlign: 'center' },
  lockTitle: { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center', marginTop: 6 },
  lockSub:   { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20, marginVertical: 10 },
});
