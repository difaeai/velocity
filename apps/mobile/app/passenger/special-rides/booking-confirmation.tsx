import { useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';

export default function BookingConfirmationScreen() {
  const router = useRouter();
  const { bookingId, totalPrice } = useLocalSearchParams<{
    bookingId: string;
    totalPrice: string;
  }>();

  useEffect(() => {
    // Auto-navigate back after a few seconds if user doesn't interact
    const timer = setTimeout(() => {
      // User can manually navigate back before this
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Success Icon */}
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✓</Text>
        </View>

        {/* Message */}
        <Text style={styles.successTitle}>Booking Submitted!</Text>
        <Text style={styles.successMessage}>
          Your booking request has been sent to the car owner. You'll receive a confirmation once they approve it.
        </Text>

        {/* Booking Details */}
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Booking ID</Text>
            <Text style={styles.detailValue}>{bookingId}</Text>
          </View>
          <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 12 }]}>
            <Text style={styles.detailLabel}>Total Price</Text>
            <Text style={styles.detailValue}>₨{parseInt(totalPrice || '0').toLocaleString()}</Text>
          </View>
        </View>

        {/* What's Next */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What's Next?</Text>
          <View style={styles.stepList}>
            <View style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <Text style={styles.stepText}>Owner will review your booking</Text>
            </View>
            <View style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <Text style={styles.stepText}>You'll receive a notification when confirmed</Text>
            </View>
            <View style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <Text style={styles.stepText}>Complete payment and arrange pickup</Text>
            </View>
          </View>
        </View>

        {/* Contact Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Need Help?</Text>
          <Text style={styles.helpText}>
            Contact our support team if you have any questions about your booking.
          </Text>
          <Pressable style={styles.supportButton}>
            <Text style={styles.supportButtonText}>💬 Contact Support</Text>
          </Pressable>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Continue Button */}
      <View style={styles.footer}>
        <Pressable
          style={styles.continueButton}
          onPress={() => router.replace('/passenger/special-rides')}
        >
          <Text style={styles.continueButtonText}>Back to Special Rides</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: 16,
      paddingVertical: 24,
    },
    successContainer: {
      width: 80,
      height: 80,
      backgroundColor: `${colors.primary}22`,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 20,
    },
    successIcon: {
      fontSize: 44,
      fontWeight: '800',
      color: colors.primary,
    },
    successTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    successMessage: {
      fontSize: 14,
      color: colors.muted,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 24,
    },
    detailsCard: {
      padding: 16,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 24,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    detailLabel: {
      fontSize: 13,
      color: colors.muted,
      fontWeight: '600',
    },
    detailValue: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 12,
    },
    stepList: {
      gap: 12,
    },
    step: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    stepNumber: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.glassLime,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    stepNumberText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.primary,
    },
    stepText: {
      fontSize: 13,
      color: colors.text,
      flex: 1,
      paddingTop: 6,
    },
    helpText: {
      fontSize: 13,
      color: colors.muted,
      lineHeight: 18,
      marginBottom: 12,
    },
    supportButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: colors.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    supportButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
    },
    footer: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    continueButton: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: colors.primary,
      borderRadius: 8,
      alignItems: 'center',
    },
    continueButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
  })
);
