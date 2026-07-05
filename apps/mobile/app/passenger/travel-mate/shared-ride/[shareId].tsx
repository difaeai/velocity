/**
 * Travel Mate — shared ride link screen (deep-link target).
 *
 * velocity://passenger/travel-mate/shared-ride/{shareId}
 *
 * Resolves the link via getSharedTravelMateRide and renders one of:
 *  - eligible          → ride card + "Book this ride" (bookSharedTravelMateRide)
 *  - already joined    → ride card + confirmation state
 *  - no_profile        → locked: "Travel Mates only" + CTA to set up a profile
 *  - not_partner       → locked: must match with the sharer first + CTA to Discover
 *
 * Regular users can never book from the link — the Cloud Function enforces the
 * same gate server-side; this screen just explains it.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { api, type SharedTravelMateRideResult } from '../../../../src/api/client';
import { colors } from '../../../../src/config';
import { Card, PrimaryButton } from '../../../../src/ui/components';

export default function SharedRideScreen() {
  const params = useLocalSearchParams<{ shareId: string }>();
  const shareId = Array.isArray(params.shareId) ? params.shareId[0] : params.shareId;
  const router = useRouter();

  const [result, setResult] = useState<SharedTravelMateRideResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);

  const load = useCallback(async () => {
    if (!shareId) return;
    try {
      const res = await api.getSharedTravelMateRide({ shareId });
      setResult(res);
      setError(null);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/not-found') {
        setError('This ride link is invalid or has expired.');
      } else {
        setError(e instanceof Error ? e.message : 'Could not load this ride.');
      }
    }
  }, [shareId]);

  useEffect(() => { load(); }, [load]);

  async function book() {
    if (!shareId) return;
    setBooking(true);
    try {
      await api.bookSharedTravelMateRide({ shareId });
      setBooked(true);
      await load();
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Cannot book', e.message);
      } else if (e instanceof FirebaseError && e.code === 'functions/permission-denied') {
        Alert.alert('Travel partners only', e.message);
      } else {
        Alert.alert('Error', e instanceof Error ? e.message : 'Booking failed.');
      }
      await load();
    } finally {
      setBooking(false);
    }
  }

  const ride = result?.ride;
  const joined = booked || (result?.eligible === true && result.alreadyJoined);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/passenger/home')} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </Pressable>
        <Text style={s.title}>Shared ride</Text>
        <View style={{ width: 36 }} />
      </View>

      {!result && !error && (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      )}

      {error && (
        <View style={s.center}>
          <Text style={s.lockEmoji}>🔗</Text>
          <Text style={s.lockTitle}>Link problem</Text>
          <Text style={s.lockSub}>{error}</Text>
        </View>
      )}

      {ride && (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Card>
            <View style={s.sharerRow}>
              <View style={s.avatar}><Text style={{ fontSize: 22 }}>👤</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.sharerName}>{ride.sharerInfo?.displayName ?? 'Travel Mate'}</Text>
                <Text style={s.sharerSub}>shared this ride with their travel partners</Text>
              </View>
            </View>
            <View style={s.routeBox}>
              <View style={s.routeRow}>
                <Text style={s.routeDot}>🟢</Text>
                <Text style={s.routeText} numberOfLines={2}>{ride.pickupAddress || 'Pickup'}</Text>
              </View>
              <View style={s.routeLine} />
              <View style={s.routeRow}>
                <Text style={s.routeDot}>📍</Text>
                <Text style={s.routeText} numberOfLines={2}>{ride.dropoffAddress || 'Destination'}</Text>
              </View>
            </View>
            <View style={s.metaRow}>
              {ride.fare != null && <Text style={s.metaItem}>💰 PKR {ride.fare.toLocaleString()}</Text>}
              <Text style={s.metaItem}>👥 {ride.coRiderCount}/{ride.maxCoRiders} riders</Text>
              {ride.status !== 'open' && <Text style={[s.metaItem, { color: colors.danger }]}>Closed</Text>}
            </View>
            {ride.coRiderNames.length > 0 && (
              <Text style={s.coRiders}>On this ride: {ride.coRiderNames.join(', ')}</Text>
            )}
          </Card>

          {joined ? (
            <Card>
              <Text style={s.joinedEmoji}>✅</Text>
              <Text style={s.joinedTitle}>{"You're on this ride"}</Text>
              <Text style={s.joinedSub}>
                Ride together and split the fare afterwards from your group, or settle in cash.
              </Text>
              {ride.groupId && (
                <PrimaryButton
                  label="Open group"
                  onPress={() => router.replace(`/passenger/travel-mate/group/${ride.groupId}` as Parameters<typeof router.replace>[0])}
                />
              )}
            </Card>
          ) : result?.eligible ? (
            <PrimaryButton
              label={booking ? 'Booking…' : 'Book this ride'}
              disabled={booking || ride.status !== 'open' || ride.coRiderCount >= ride.maxCoRiders}
              onPress={book}
            />
          ) : result && !result.eligible && result.reason === 'no_profile' ? (
            <Card>
              <Text style={s.lockEmoji}>🔒</Text>
              <Text style={s.lockTitle}>Travel Mates only</Text>
              <Text style={s.lockSub}>
                This ride link only works for Travel Mates. Set up your Travel Mate profile,
                find {ride.sharerInfo?.displayName ?? 'the sharer'} and match with them — then you can book this ride.
              </Text>
              <PrimaryButton
                label="Become a Travel Mate"
                onPress={() => router.replace('/passenger/travel-mate/setup' as Parameters<typeof router.replace>[0])}
              />
            </Card>
          ) : (
            <Card>
              <Text style={s.lockEmoji}>🤝</Text>
              <Text style={s.lockTitle}>Travel partners only</Text>
              <Text style={s.lockSub}>
                Only {ride.sharerInfo?.displayName ?? 'the sharer'}{"'s"} travel partners can book this ride.
                Find them in Travel Mate Discover and match with them first.
              </Text>
              <PrimaryButton
                label="Find your travel partner"
                onPress={() => router.replace('/passenger/travel-mate' as Parameters<typeof router.replace>[0])}
              />
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

  sharerRow:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:     { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  sharerName: { fontSize: 16, fontWeight: '900', color: colors.text },
  sharerSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },

  routeBox:  { marginTop: 14, gap: 2 },
  routeRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDot:  { fontSize: 13 },
  routeText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  routeLine: { width: 2, height: 16, backgroundColor: colors.border, marginLeft: 8 },

  metaRow:  { flexDirection: 'row', gap: 16, marginTop: 12 },
  metaItem: { fontSize: 13, fontWeight: '700', color: colors.muted },
  coRiders: { fontSize: 12, color: colors.muted, marginTop: 8 },

  joinedEmoji: { fontSize: 44, textAlign: 'center' },
  joinedTitle: { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center', marginTop: 6 },
  joinedSub:   { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20, marginVertical: 10 },

  lockEmoji: { fontSize: 44, textAlign: 'center' },
  lockTitle: { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center', marginTop: 6 },
  lockSub:   { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20, marginVertical: 10 },
});
