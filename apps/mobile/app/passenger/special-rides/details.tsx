import { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';

export default function SpecialRidesDetailsScreen() {
  const router = useRouter();
  const { hostUid, listingId } = useLocalSearchParams<{
    hostUid: string;
    listingId: string;
  }>();

  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [pickupDate, setPickupDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);
  const [includeDriver, setIncludeDriver] = useState(false);

  useEffect(() => {
    loadListing();
  }, [hostUid, listingId]);

  async function loadListing() {
    setLoading(true);
    try {
      const res = await api.getSpecialRidesListingDetails({
        listingId,
        hostUid,
      });
      if (res.ok) {
        setListing(res.listing);
      } else {
        Alert.alert('Error', 'Listing not found');
        router.back();
      }
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to load listing');
      router.back();
    } finally {
      setLoading(false);
    }
  }

  async function submitBooking() {
    if (!pickupDate || !returnDate) {
      Alert.alert('Missing', 'Select pickup and return dates');
      return;
    }
    if (pickupDate >= returnDate) {
      Alert.alert('Invalid', 'Return date must be after pickup date');
      return;
    }

    setBooking(true);
    try {
      const res = await api.bookSpecialRidesCar({
        listingId,
        hostUid,
        pickupDate: pickupDate.getTime(),
        returnDate: returnDate.getTime(),
        includeDriver,
      });

      if (res.ok) {
        Alert.alert('Booking Submitted ✅', res.message || 'Awaiting host confirmation');
        router.replace({
          pathname: '/passenger/special-rides/booking-confirmation',
          params: { bookingId: res.bookingId, totalPrice: res.totalPrice },
        });
      }
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to book');
    } finally {
      setBooking(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!listing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyText}>Listing not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const days = pickupDate && returnDate
    ? Math.ceil((returnDate.getTime() - pickupDate.getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  let totalPrice = days * listing.pricePerDay;
  if (includeDriver) {
    totalPrice += days * 1000;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backButton}>←</Text>
        </Pressable>
        <Text style={styles.title}>Car Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Car Image & Title */}
        <View style={styles.imageContainer}>
          <Text style={styles.imagePlaceholder}>🚗</Text>
        </View>

        <View style={styles.carHeader}>
          <View>
            <Text style={styles.carTitle}>
              {listing.carDetails.year} {listing.carDetails.make} {listing.carDetails.model}
            </Text>
            <Text style={styles.carPlate}>{listing.carDetails.licensePlate}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>₨{listing.pricePerDay}/day</Text>
          </View>
        </View>

        {/* Details Grid */}
        <View style={styles.detailsGrid}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Seats</Text>
            <Text style={styles.detailValue}>{listing.carDetails.seatsCount}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Transmission</Text>
            <Text style={styles.detailValue}>{listing.carDetails.transmissionType}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Mileage</Text>
            <Text style={styles.detailValue}>{listing.carDetails.mileage} km</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Color</Text>
            <Text style={styles.detailValue}>{listing.carDetails.color}</Text>
          </View>
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📍 Location</Text>
          <Text style={styles.locationText}>{listing.location.address}</Text>
          <Text style={styles.locationCity}>{listing.location.city}</Text>
        </View>

        {/* Instructions */}
        {listing.instructions && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📝 Instructions</Text>
            <Text style={styles.instructionsText}>{listing.instructions}</Text>
          </View>
        )}

        {/* Host Contact */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Owner</Text>
          <Text style={styles.ownerName}>{listing.ownerName}</Text>
          <Pressable
            style={styles.contactButton}
            onPress={() => {
              if (listing.ownerPhone) {
                // TODO: implement call/whatsapp
                Alert.alert('Contact', `Call: ${listing.ownerPhone}`);
              }
            }}
          >
            <Text style={styles.contactButtonText}>📞 {listing.ownerPhone}</Text>
          </Pressable>
        </View>

        {/* Booking Section */}
        <View style={[styles.section, styles.bookingSection]}>
          <Text style={styles.sectionTitle}>📅 Select Dates</Text>

          <View style={styles.dateInputContainer}>
            <Pressable
              style={styles.dateButton}
              onPress={() => {
                // TODO: integrate date picker
                Alert.alert('Coming Soon', 'Date picker will be added soon');
              }}
            >
              <Text style={styles.dateButtonLabel}>Pickup Date</Text>
              <Text style={styles.dateButtonValue}>
                {pickupDate ? pickupDate.toLocaleDateString() : 'Select date'}
              </Text>
            </Pressable>

            <Pressable
              style={styles.dateButton}
              onPress={() => {
                // TODO: integrate date picker
                Alert.alert('Coming Soon', 'Date picker will be added soon');
              }}
            >
              <Text style={styles.dateButtonLabel}>Return Date</Text>
              <Text style={styles.dateButtonValue}>
                {returnDate ? returnDate.toLocaleDateString() : 'Select date'}
              </Text>
            </Pressable>
          </View>

          {/* Driver Option */}
          <View style={styles.driverOption}>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverOptionTitle}>Include Driver?</Text>
              <Text style={styles.driverOptionSub}>+₨1,000 per day</Text>
            </View>
            <Pressable
              style={[
                styles.driverToggle,
                includeDriver && styles.driverToggleActive,
              ]}
              onPress={() => setIncludeDriver(!includeDriver)}
            >
              <Text style={styles.driverToggleText}>{includeDriver ? '✓' : ''}</Text>
            </Pressable>
          </View>

          {/* Price Breakdown */}
          {days > 0 && (
            <View style={styles.priceBreakdown}>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>
                  ₨{listing.pricePerDay} × {days} days
                </Text>
                <Text style={styles.priceValue}>
                  ₨{(days * listing.pricePerDay).toLocaleString()}
                </Text>
              </View>
              {includeDriver && (
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Driver ({days} days)</Text>
                  <Text style={styles.priceValue}>
                    ₨{(days * 1000).toLocaleString()}
                  </Text>
                </View>
              )}
              <View style={[styles.priceRow, styles.priceRowTotal]}>
                <Text style={styles.priceLabelTotal}>Total</Text>
                <Text style={styles.priceValueTotal}>
                  ₨{totalPrice.toLocaleString()}
                </Text>
              </View>
            </View>
          )}

          <Pressable
            style={[
              styles.bookButton,
              (booking || !pickupDate || !returnDate) && styles.bookButtonDisabled,
            ]}
            onPress={submitBooking}
            disabled={booking || !pickupDate || !returnDate}
          >
            {booking ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.bookButtonText}>
                {pickupDate && returnDate ? `Book Now — ₨${totalPrice.toLocaleString()}` : 'Select Dates'}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={{ height: 20 }} />
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
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    content: {
      paddingHorizontal: 0,
      paddingVertical: 0,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: colors.muted,
    },
    imageContainer: {
      height: 200,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    imagePlaceholder: {
      fontSize: 80,
    },
    carHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    carTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    carPlate: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 4,
    },
    badge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.glassLime,
      borderRadius: 6,
    },
    badgeText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primary,
    },
    detailsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    detailItem: {
      width: '50%',
      alignItems: 'center',
      paddingBottom: 12,
    },
    detailLabel: {
      fontSize: 12,
      color: colors.muted,
    },
    detailValue: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginTop: 4,
    },
    section: {
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    bookingSection: {
      backgroundColor: colors.surface,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 12,
    },
    locationText: {
      fontSize: 14,
      color: colors.text,
      fontWeight: '600',
    },
    locationCity: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 4,
    },
    instructionsText: {
      fontSize: 14,
      color: colors.text,
      lineHeight: 20,
    },
    ownerName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
    },
    contactButton: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.primary,
      borderRadius: 8,
      alignItems: 'center',
    },
    contactButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#fff',
    },
    dateInputContainer: {
      gap: 12,
      marginBottom: 16,
    },
    dateButton: {
      paddingHorizontal: 12,
      paddingVertical: 14,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
    },
    dateButtonLabel: {
      fontSize: 12,
      color: colors.muted,
    },
    dateButtonValue: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginTop: 4,
    },
    driverOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: colors.background,
      borderRadius: 8,
      marginBottom: 16,
    },
    driverOptionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    driverOptionSub: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 2,
    },
    driverToggle: {
      width: 32,
      height: 32,
      borderWidth: 2,
      borderColor: colors.border,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    driverToggleActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    driverToggleText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#fff',
    },
    priceBreakdown: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: colors.background,
      borderRadius: 8,
      marginBottom: 16,
    },
    priceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    priceRowTotal: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      marginBottom: 0,
    },
    priceLabel: {
      fontSize: 13,
      color: colors.muted,
    },
    priceLabelTotal: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    priceValue: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    priceValueTotal: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.primary,
    },
    bookButton: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: colors.primary,
      borderRadius: 8,
      alignItems: 'center',
    },
    bookButtonDisabled: {
      opacity: 0.5,
    },
    bookButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
  })
);
