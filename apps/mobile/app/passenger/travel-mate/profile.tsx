import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';

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
}

const GENDER_LABEL: Record<string, string> = { male: 'Male', female: 'Female' };
const PREF_LABEL: Record<string, string> = { male: 'Men', female: 'Women', any: 'Everyone' };

export default function TravelMateProfile() {
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<TMProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    getDoc(doc(db, 'travelMateProfiles', user.uid))
      .then(snap => {
        if (snap.exists()) setProfile({ uid: user.uid, ...snap.data() } as TMProfile);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.uid]);

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
          <Text style={s.emptySub}>Create your TravelMate profile to start matching with other riders.</Text>
          <Pressable style={s.editBtn} onPress={() => router.push('/passenger/travel-mate/setup')}>
            <Text style={s.editBtnText}>Create profile</Text>
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

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
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

const s = StyleSheet.create({
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
  dotGreen:  { backgroundColor: '#4ade80' },
  dotGrey:   { backgroundColor: colors.muted },
  statusText:{ fontSize: 13, color: colors.muted, fontWeight: '600' },

  card:      { width: '100%', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 4 },
  cardLabel: { fontSize: 11, fontWeight: '900', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  cardValue: { fontSize: 15, fontWeight: '700', color: colors.text },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  tag:     { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1, borderColor: `${colors.primary}40` },
  tagText: { fontSize: 13, fontWeight: '700', color: colors.primary },

  editBtn:     { width: '100%', height: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  editBtnText: { fontSize: 16, fontWeight: '900', color: '#000' },
});
