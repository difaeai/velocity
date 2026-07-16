import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { useDriverEntry } from '../../src/hooks/useDriverEntry';
import { colors } from '../../src/config';
import { Card, comingSoon } from '../../src/ui/components';

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const driverEntry = useDriverEntry();

  const openSettings = () => router.push('/passenger/settings');
  const openActivity = () => router.push('/passenger/activity');
  const openWallet = () => router.push('/passenger/wallet');
  const safetyInfo = () =>
    Alert.alert(
      'Safety',
      'Your safety matters. During a ride you can trigger an Emergency SOS from the trip screen, and our team monitors safety events in real time.',
    );
  const aboutInfo = () =>
    Alert.alert('Velocity', 'Velocity — ride-hailing & smart pooling.\n\nMade for Pakistan. 🇵🇰');

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
        >
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Pressable style={styles.profileSummary} onPress={openSettings}>
          <View style={styles.nameRow}>
            <Text style={styles.userName}>{user?.displayName ?? 'Your account'}</Text>
            <Text style={styles.arrowIcon}>➔</Text>
          </View>
          <Text style={styles.userPhone}>{user?.email ?? user?.phoneNumber ?? 'Tap to manage account'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Quick Actions Row */}
        <View style={styles.quickActionsRow}>
          <Pressable style={styles.quickActionItem} onPress={openActivity}>
            <View style={styles.circleIcon}>
              <Text style={styles.actionEmoji}>🕒</Text>
            </View>
            <Text style={styles.actionLabel}>Orders</Text>
          </Pressable>

          <Pressable style={styles.quickActionItem} onPress={() => router.push('/passenger/support-chat')}>
            <View style={styles.circleIcon}>
              <Text style={styles.actionEmoji}>🎧</Text>
            </View>
            <Text style={styles.actionLabel}>Support</Text>
          </Pressable>

          <Pressable style={styles.quickActionItem} onPress={() => comingSoon('Saved addresses')}>
            <View style={styles.circleIcon}>
              <Text style={styles.actionEmoji}>📍</Text>
            </View>
            <Text style={styles.actionLabel}>Addresses</Text>
          </Pressable>

          <Pressable style={styles.quickActionItem} onPress={openSettings}>
            <View style={styles.circleIcon}>
              <Text style={styles.actionEmoji}>⚙️</Text>
            </View>
            <Text style={styles.actionLabel}>Settings</Text>
          </Pressable>
        </View>

        {/* Complete Profile Card */}
        <Card style={styles.completeProfileCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.completeTitle}>COMPLETE PROFILE</Text>
            <Text
              style={styles.whyText}
              onPress={() =>
                Alert.alert('Why complete your profile?', 'A complete profile helps drivers recognise you and speeds up matching.')
              }
            >
              Why? 🛈
            </Text>
          </View>

          <View style={styles.progressRow}>
            <Text style={styles.progressText}>0 of 2</Text>
            <Pressable onPress={openSettings}>
              <Text style={styles.completeLink}>Complete</Text>
            </Pressable>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBarBg}>
            <View style={styles.progressBarFill} />
          </View>

          {/* Checklist Item */}
          <View style={styles.checkItem}>
            <View style={styles.checkIconCircle}>
              <Text style={styles.checkIcon}>👤</Text>
            </View>
            <Text style={styles.checkLabel}>Confirm your name</Text>
          </View>

          {/* Carousel dots indicator */}
          <View style={styles.dotsRow}>
            <View style={[styles.dot, styles.dotActive]} />
            <View style={styles.dot} />
          </View>
        </Card>

        {/* List items: Discounts & Payment methods */}
        <View style={styles.listCard}>
          <Pressable style={styles.listItem} onPress={() => router.push('/referral-code')}>
            <View style={styles.itemLeftRow}>
              <Text style={styles.itemIcon}>🎁</Text>
              <View>
                <Text style={styles.itemTitle}>Referral code</Text>
                <Text style={styles.itemSubtitle}>Enter a partner&apos;s 5-digit code</Text>
              </View>
            </View>
            <Text style={styles.chevron}>➔</Text>
          </Pressable>

          <View style={styles.divider} />

          <Pressable style={styles.listItem} onPress={openWallet}>
            <View style={styles.itemLeftRow}>
              <Text style={styles.itemIcon}>💳</Text>
              <View>
                <Text style={styles.itemTitle}>Wallet &amp; payments</Text>
                <Text style={styles.itemSubtitle}>Top up · Cash</Text>
              </View>
            </View>
            <View style={styles.cashBadgeContainer}>
              <View style={styles.cashBadge}>
                <Text style={styles.cashText}>💵</Text>
              </View>
              <Text style={styles.chevron}>➔</Text>
            </View>
          </Pressable>
        </View>

        {/* Earn as a driver banner */}
        <Pressable
          style={styles.driverBanner}
          disabled={driverEntry.busy}
          onPress={driverEntry.go}
        >
          <View style={styles.bannerLeft}>
            <View style={styles.starBadgeCircle}>
              <Text style={styles.bannerStar}>★</Text>
            </View>
            <Text style={styles.bannerText}>Earn as a driver</Text>
          </View>
          <Text style={styles.bannerArrow}>➔</Text>
        </Pressable>

        {/* Additional List Card */}
        <View style={styles.listCard}>
          <Pressable style={styles.listItem} onPress={() => comingSoon('Improve maps')}>
            <View style={styles.itemLeftRow}>
              <Text style={styles.itemIcon}>🗺️</Text>
              <View>
                <Text style={styles.itemTitle}>Improve maps</Text>
                <Text style={styles.itemSubtitle}>Add places, fix errors</Text>
              </View>
            </View>
            <Text style={styles.chevron}>➔</Text>
          </Pressable>

          <View style={styles.divider} />

          <Pressable style={styles.listItem} onPress={safetyInfo}>
            <View style={styles.itemLeftRow}>
              <Text style={styles.itemIcon}>🛡️</Text>
              <View>
                <Text style={styles.itemTitle}>Safety</Text>
              </View>
            </View>
            <Text style={styles.chevron}>➔</Text>
          </Pressable>

        </View>

        {/* Information List Card */}
        <View style={styles.listCard}>
          <Pressable style={styles.listItem} onPress={aboutInfo}>
            <View style={styles.itemLeftRow}>
              <Text style={styles.itemIcon}>ℹ️</Text>
              <View>
                <Text style={styles.itemTitle}>Information</Text>
              </View>
            </View>
            <Text style={styles.chevron}>➔</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background, // Slate dark background
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassStrong,
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  backText: {
    fontSize: 24,
    color: colors.text,
  },
  profileSummary: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userName: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.text,
  },
  arrowIcon: {
    fontSize: 14,
    color: '#8a8c8c',
  },
  userPhone: {
    fontSize: 14,
    color: '#8a8c8c',
    marginTop: 2,
  },
  container: {
    padding: 16,
    gap: 16,
  },
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  quickActionItem: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  circleIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionEmoji: {
    fontSize: 20,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  completeProfileCard: {
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    padding: 16,
    gap: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  completeTitle: {
    color: '#3b82f6', // Premium blue accent
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  whyText: {
    color: '#8a8c8c',
    fontSize: 12,
    fontWeight: '600',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '700',
  },
  completeLink: {
    color: '#3b82f6',
    fontWeight: '800',
    fontSize: 13,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: colors.glassStrong,
    borderRadius: 2,
    width: '100%',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: '#3b82f6',
    borderRadius: 2,
    width: '0%', // 0 of 2 complete
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1b1c1c',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    marginTop: 4,
  },
  checkIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIcon: {
    fontSize: 14,
    color: colors.text,
  },
  checkLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.glassStrong,
  },
  dotActive: {
    backgroundColor: '#3b82f6',
  },
  listCard: {
    backgroundColor: colors.glassChip,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    overflow: 'hidden',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  itemLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  itemIcon: {
    fontSize: 20,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  itemSubtitle: {
    fontSize: 11,
    color: '#8a8c8c',
    marginTop: 2,
  },
  chevron: {
    fontSize: 12,
    color: '#8a8c8c',
  },
  divider: {
    height: 1,
    backgroundColor: colors.glassStrong,
    marginLeft: 48,
  },
  cashBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cashBadge: {
    backgroundColor: 'rgba(204, 255, 0, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(204, 255, 0, 0.4)',
  },
  cashText: {
    fontSize: 14,
  },
  driverBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.glassStrong, // Dark banner surface
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.glassStrong,
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  starBadgeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffc107',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerStar: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 16,
  },
  bannerText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  bannerArrow: {
    color: '#ef4444', // Red accent arrow
    fontSize: 14,
    fontWeight: '800',
  },
});
