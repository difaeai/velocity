import { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../../src/auth/AuthContext';
import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';

export default function SpecialRidesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<'none' | 'pending' | 'rejected' | 'active' | 'suspended'>('none');
  const [dashboard, setDashboard] = useState<any>(null);

  useEffect(() => {
    loadDashboard();
    loadListings();
  }, [user?.uid]);

  async function loadDashboard() {
    try {
      const res = await api.getSpecialRidesDashboard({});
      if (res.ok) {
        setStage(res.stage);
        setDashboard(res);
      }
    } catch (e) {
      console.error('Failed to load dashboard:', e);
    }
  }

  async function loadListings() {
    setLoading(true);
    try {
      const res = await api.getSpecialRidesListings({ page: 0 });
      if (res.ok) {
        setListings(res.listings);
      }
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }

  // Host dashboard: show status of their listing application
  if (stage === 'pending') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backButton}>←</Text>
          </Pressable>
          <Text style={styles.title}>Special Rides</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>⏳ Application Pending</Text>
            <Text style={styles.cardDesc}>
              Your car listing is under review. An admin will approve or request changes within 24 hours.
            </Text>
            <Pressable
              style={styles.button}
              onPress={() => router.push('/passenger/special-rides/compose')}
            >
              <Text style={styles.buttonText}>Edit Application</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (stage === 'rejected') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backButton}>←</Text>
          </Pressable>
          <Text style={styles.title}>Special Rides</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, { borderLeftColor: colors.danger, borderLeftWidth: 4 }]}>
            <Text style={styles.cardTitle}>❌ Application Rejected</Text>
            {dashboard?.applications?.[0]?.rejectionReason && (
              <Text style={styles.cardDesc}>
                Reason: {dashboard.applications[0].rejectionReason}
              </Text>
            )}
            <Pressable
              style={styles.button}
              onPress={() => router.push('/passenger/special-rides/compose')}
            >
              <Text style={styles.buttonText}>Resubmit</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (stage === 'active') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backButton}>←</Text>
          </Pressable>
          <Text style={styles.title}>Special Rides</Text>
          <Pressable onPress={() => router.push('/passenger/special-rides/my-cars')}>
            <Text style={styles.headerIcon}>📋</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{dashboard?.totalBookings ?? 0}</Text>
              <Text style={styles.statLabel}>Bookings</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>₨{(dashboard?.totalEarnings ?? 0).toLocaleString()}</Text>
              <Text style={styles.statLabel}>Earnings</Text>
            </View>
          </View>

          <Pressable
            style={styles.button}
            onPress={() => router.push('/passenger/special-rides/my-cars')}
          >
            <Text style={styles.buttonText}>📋 My Posted Cars</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>Browse All Rentals</Text>
          {loading && <ActivityIndicator color={colors.primary} size="large" />}
          {!loading && listings.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No cars available yet</Text>
            </View>
          )}

          {listings.map((listing, idx) => (
            <Pressable
              key={idx}
              style={styles.listingCard}
              onPress={() =>
                router.push({
                  pathname: '/passenger/special-rides/details',
                  params: { hostUid: listing.uid, listingId: listing.listingId },
                })
              }
            >
              <View style={styles.listingImage}>
                <Text style={styles.listingImagePlaceholder}>🚗</Text>
              </View>
              <View style={styles.listingInfo}>
                <Text style={styles.listingTitle}>
                  {listing.carDetails.year} {listing.carDetails.make} {listing.carDetails.model}
                </Text>
                <Text style={styles.listingMeta}>
                  {listing.location.city} • ₨{listing.pricePerDay}/day
                </Text>
                <Text style={styles.listingSeats}>
                  👥 {listing.carDetails.seatsCount} seats
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Regular user: browse listings and option to post
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backButton}>←</Text>
        </Pressable>
        <Text style={styles.title}>Special Rides</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          style={styles.postCarButton}
          onPress={() => router.push('/passenger/special-rides/compose')}
        >
          <Text style={styles.postCarButtonIcon}>➕</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.postCarButtonTitle}>Post Your Car</Text>
            <Text style={styles.postCarButtonSub}>Earn by renting your vehicle</Text>
          </View>
        </Pressable>

        <Text style={styles.sectionLabel}>Available Rentals</Text>
        {loading && <ActivityIndicator color={colors.primary} size="large" />}
        {!loading && listings.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No cars available yet</Text>
          </View>
        )}

        {listings.map((listing, idx) => (
          <Pressable
            key={idx}
            style={styles.listingCard}
            onPress={() =>
              router.push({
                pathname: '/passenger/special-rides/details',
                params: { hostUid: listing.uid, listingId: listing.listingId },
              })
            }
          >
            <View style={styles.listingImage}>
              <Text style={styles.listingImagePlaceholder}>🚗</Text>
            </View>
            <View style={styles.listingInfo}>
              <Text style={styles.listingTitle}>
                {listing.carDetails.year} {listing.carDetails.make} {listing.carDetails.model}
              </Text>
              <Text style={styles.listingMeta}>
                {listing.location.city} • ₨{listing.pricePerDay}/day
              </Text>
              <Text style={styles.listingSeats}>
                👥 {listing.carDetails.seatsCount} seats
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backButton: {
      fontSize: 24,
      color: colors.primary,
    },
    headerIcon: {
      fontSize: 20,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    content: {
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    postCarButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      backgroundColor: colors.glassLime,
      borderRadius: 12,
      marginBottom: 20,
      gap: 12,
    },
    postCarButtonIcon: {
      fontSize: 28,
    },
    postCarButtonTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.primary,
    },
    postCarButtonSub: {
      fontSize: 13,
      color: colors.muted,
      marginTop: 2,
    },
    card: {
      padding: 16,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 16,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
    },
    cardDesc: {
      fontSize: 14,
      color: colors.muted,
      marginBottom: 16,
      lineHeight: 20,
    },
    button: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: colors.primary,
      borderRadius: 8,
      alignItems: 'center',
    },
    buttonText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
    statsRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 20,
    },
    stat: {
      flex: 1,
      padding: 16,
      backgroundColor: colors.surface,
      borderRadius: 12,
      alignItems: 'center',
      gap: 4,
    },
    statNum: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.primary,
    },
    statLabel: {
      fontSize: 12,
      color: colors.muted,
    },
    sectionLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 12,
      marginTop: 16,
    },
    empty: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: colors.muted,
    },
    listingCard: {
      flexDirection: 'row',
      padding: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginBottom: 12,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    listingImage: {
      width: 100,
      height: 100,
      backgroundColor: colors.background,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listingImagePlaceholder: {
      fontSize: 40,
    },
    listingInfo: {
      flex: 1,
      justifyContent: 'center',
      gap: 4,
    },
    listingTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    listingMeta: {
      fontSize: 12,
      color: colors.muted,
    },
    listingSeats: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: '600',
    },
  })
);
