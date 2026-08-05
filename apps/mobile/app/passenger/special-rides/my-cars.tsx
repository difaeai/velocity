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
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';

export default function MyPostedCarsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<any>(null);

  useFocusEffect(
    useCallback(() => {
      loadDashboard();
    }, [])
  );

  async function loadDashboard() {
    setLoading(true);
    try {
      const res = await api.getSpecialRidesDashboard({});
      if (res.ok) {
        setDashboard(res);
      }
    } catch (e) {
      console.error('Failed to load dashboard:', e);
    } finally {
      setLoading(false);
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

  const { activeListings = [], totalBookings = 0, totalEarnings = 0 } = dashboard || {};

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backButton}>←</Text>
        </Pressable>
        <Text style={styles.title}>My Posted Cars</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{totalBookings}</Text>
            <Text style={styles.statLabel}>Total Bookings</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>₨{totalEarnings.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Earnings</Text>
          </View>
        </View>

        {/* Add New Car Button */}
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/passenger/special-rides/compose')}
        >
          <Text style={styles.addButtonIcon}>➕</Text>
          <Text style={styles.addButtonText}>Add Another Car</Text>
        </Pressable>

        {/* Listed Cars */}
        {activeListings.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🚗</Text>
            <Text style={styles.emptyTitle}>No cars posted yet</Text>
            <Text style={styles.emptyDesc}>Start earning by adding your first car</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Your Listings</Text>
            {activeListings.map((listing, idx) => (
              <View key={idx} style={styles.carCard}>
                <View style={styles.carImagePlaceholder}>
                  <Text style={styles.carImageIcon}>🚗</Text>
                </View>

                <View style={styles.carInfo}>
                  <Text style={styles.carTitle}>
                    {listing.carDetails.year} {listing.carDetails.make}{' '}
                    {listing.carDetails.model}
                  </Text>
                  <Text style={styles.carMeta}>
                    {listing.location.city} • ₨{listing.pricePerDay}/day
                  </Text>
                  <Text style={styles.carPlate}>{listing.carDetails.licensePlate}</Text>

                  <View style={styles.statusContainer}>
                    <View
                      style={[
                        styles.statusBadge,
                        listing.status === 'active' && styles.statusBadgeActive,
                        listing.status === 'suspended' && styles.statusBadgeSuspended,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          listing.status === 'active' && styles.statusTextActive,
                          listing.status === 'suspended' && styles.statusTextSuspended,
                        ]}
                      >
                        {listing.status === 'active' ? '✓ Active' : '⊗ Suspended'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.actions}>
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => {
                      Alert.alert(
                        'Edit Listing',
                        'Editing existing listings coming soon'
                      );
                    }}
                  >
                    <Text style={styles.actionButtonIcon}>✏️</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionButton, styles.actionButtonDanger]}
                    onPress={() => {
                      Alert.alert(
                        'Delete Listing',
                        'Are you sure you want to remove this listing?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                const res = await api.deleteSpecialRidesListing({});
                                if (res.ok) {
                                  Alert.alert('Success', res.message);
                                  loadDashboard();
                                }
                              } catch (e) {
                                Alert.alert('Error', 'Failed to delete');
                              }
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Text style={styles.actionButtonIcon}>🗑️</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

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
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
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
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      gap: 4,
    },
    statNum: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.primary,
    },
    statLabel: {
      fontSize: 12,
      color: colors.muted,
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: colors.glassLime,
      borderRadius: 12,
      marginBottom: 20,
      gap: 12,
    },
    addButtonIcon: {
      fontSize: 20,
    },
    addButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.primary,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 12,
      marginTop: 20,
    },
    empty: {
      alignItems: 'center',
      paddingVertical: 60,
    },
    emptyIcon: {
      fontSize: 48,
      marginBottom: 12,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 6,
    },
    emptyDesc: {
      fontSize: 13,
      color: colors.muted,
    },
    carCard: {
      flexDirection: 'row',
      padding: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
    },
    carImagePlaceholder: {
      width: 80,
      height: 80,
      backgroundColor: colors.background,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    carImageIcon: {
      fontSize: 36,
    },
    carInfo: {
      flex: 1,
      justifyContent: 'space-between',
    },
    carTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    carMeta: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 2,
    },
    carPlate: {
      fontSize: 11,
      color: colors.muted,
      fontWeight: '600',
      marginTop: 2,
    },
    statusContainer: {
      marginTop: 8,
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: colors.background,
      borderRadius: 6,
      alignSelf: 'flex-start',
    },
    statusBadgeActive: {
      backgroundColor: `${colors.primary}22`,
    },
    statusBadgeSuspended: {
      backgroundColor: `${colors.danger}22`,
    },
    statusText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.muted,
    },
    statusTextActive: {
      color: colors.primary,
    },
    statusTextSuspended: {
      color: colors.danger,
    },
    actions: {
      flexDirection: 'row',
      gap: 8,
    },
    actionButton: {
      width: 32,
      height: 32,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionButtonDanger: {
      borderColor: colors.danger,
    },
    actionButtonIcon: {
      fontSize: 14,
    },
  })
);
