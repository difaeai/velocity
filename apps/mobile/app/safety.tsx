/**
 * The Safety Centre — one screen, for passengers and drivers alike.
 *
 * Reachable from both menus, and from the trip screen while a ride is running.
 * Everything a person in trouble might need is here, in the order they would
 * need it: the police first, then the things that help us help them.
 *
 * ── TWO RULES THAT ARE NOT NEGOTIABLE ───────────────────────────────────────
 *
 * 1. **Nothing on this screen dials on its own.** Every emergency number is
 *    shown as text first and placed only from an explicit confirmation. A stray
 *    tap in a pocket must never put a call through to 15, because the cost of
 *    that is a wasted police response and, eventually, a country that ignores
 *    our calls.
 *
 * 2. **An online scam goes to two places.** Velocity can refund, ban and
 *    investigate inside its own app — it cannot subpoena a bank or trace a SIM.
 *    Only Pakistan's cybercrime agency (NCCIA) can, so the screen tells people
 *    to report to both and makes the NCCIA route one tap, rather than burying
 *    it in an FAQ nobody reads while their money is gone.
 *
 * The numbers here are facts about Pakistan, not product copy. Police 15 is the
 * national emergency line; Rescue 1122 is ambulance and road accidents; NCCIA's
 * 1799 helpline opened in June 2025 when it took over the FIA's Cybercrime
 * Wing. They are mirrored in the backend's support/knowledge.ts so the AI agent
 * gives the same numbers this screen does.
 */
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Text } from '../src/ui/Text';
import { api } from '../src/api/client';
import { colors } from '../src/config';
import { themed } from '../src/theme';
import { useAuth } from '../src/auth/AuthContext';

/** Pakistan's emergency and cybercrime channels. See the file header. */
const POLICE = '15';
const RESCUE = '1122';
const NCCIA_HELPLINE = '1799';
const NCCIA_COMPLAINT_URL = 'https://complaint.nccia.gov.pk/';

export default function SafetyCentre() {
  const router = useRouter();
  const { user } = useAuth();
  // The trip screen passes the live ride, so "tell Velocity I called the
  // police" has something to attach the alert to.
  const params = useLocalSearchParams<{ tripId?: string }>();
  const tripId = typeof params.tripId === 'string' ? params.tripId : undefined;
  const [reporting, setReporting] = useState(false);

  /** Place a call, but only from an explicit confirmation. Never automatic. */
  function confirmCall(number: string, what: string, onPlaced?: () => void) {
    Alert.alert(
      `Call ${number}?`,
      `This dials ${what} directly from your phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Call ${number}`,
          style: 'destructive',
          onPress: () => {
            Linking.openURL(`tel:${number}`).catch(() =>
              Alert.alert('Could not start the call', `Dial ${number} from your phone app.`),
            );
            onPlaced?.();
          },
        },
      ],
    );
  }

  /**
   * Dialling the police on a live ride also tells our safety desk.
   *
   * Not instead of the call and not before it — the call goes first and this
   * runs after, silently. A driver whose passenger called 15 is someone we have
   * to look at within minutes, and waiting for the paperwork to reach us is not
   * a safety process.
   */
  async function reportPoliceCalled() {
    if (!tripId || !user || reporting) return;
    setReporting(true);
    try {
      await api.raiseSafetyEvent({
        tripId,
        kind: 'police_called',
        note: 'The rider dialled 15 from the in-app Safety Centre.',
      });
    } catch {
      /* The call is what matters. A failed report must never surface here. */
    } finally {
      setReporting(false);
    }
  }

  async function reportIncident(kind: 'harassment' | 'accident' | 'unsafe_driving') {
    if (!tripId) {
      router.push('/support/new?category=safety');
      return;
    }
    try {
      await api.raiseSafetyEvent({ tripId, kind });
      Alert.alert(
        'Reported',
        'Our safety team has this now and is looking at your ride. Someone will contact you.',
      );
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Safety Centre</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Why we think we have earned the claim ── */}
        <View style={styles.promise}>
          <Text style={styles.promiseTitle}>🛡️ Pakistan&apos;s securest ride-hailing</Text>
          <Text style={styles.promiseBody}>
            You see your driver&apos;s name, photo, car, number plate and phone number before
            the car arrives. You can share your ride live with your family. And every
            complaint reaches a real person — not a dead end.
          </Text>
        </View>

        {/* ── Emergency ── First on the screen, always. ── */}
        <Text style={styles.sectionTitle}>In an emergency</Text>

        <Pressable
          style={[styles.bigBtn, styles.policeBtn]}
          onPress={() =>
            confirmCall(POLICE, 'the Pakistan police emergency helpline', reportPoliceCalled)
          }
        >
          <Text style={styles.bigBtnIcon}>🚨</Text>
          <View style={styles.bigBtnBody}>
            <Text style={styles.bigBtnTitle}>Call police — {POLICE}</Text>
            <Text style={styles.bigBtnSub}>
              A fight, a threat, an assault, or anything you are frightened of.
              {tripId ? ' We are told at the same time.' : ''}
            </Text>
          </View>
        </Pressable>

        <Pressable
          style={[styles.bigBtn, styles.rescueBtn]}
          onPress={() => confirmCall(RESCUE, 'Rescue 1122 — ambulance and road accidents')}
        >
          <Text style={styles.bigBtnIcon}>🚑</Text>
          <View style={styles.bigBtnBody}>
            <Text style={styles.bigBtnTitle}>Call Rescue — {RESCUE}</Text>
            <Text style={styles.bigBtnSub}>An accident, an injury, or a medical emergency.</Text>
          </View>
        </Pressable>

        {/* ── On a live ride ── */}
        {tripId ? (
          <>
            <Text style={styles.sectionTitle}>On this ride</Text>
            <Pressable style={styles.row} onPress={() => router.push(`/passenger/trip/${tripId}`)}>
              <Text style={styles.rowIcon}>📍</Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Share my live trip</Text>
                <Text style={styles.rowSub}>
                  Send a link your family can open in any browser and watch the ride.
                </Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
            <Pressable style={styles.row} onPress={() => reportIncident('harassment')}>
              <Text style={styles.rowIcon}>🚫</Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Report harassment</Text>
                <Text style={styles.rowSub}>Goes to our safety team as urgent, right now.</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
            <Pressable style={styles.row} onPress={() => reportIncident('unsafe_driving')}>
              <Text style={styles.rowIcon}>⚠️</Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Report unsafe driving</Text>
                <Text style={styles.rowSub}>Speeding, phone use, or a route that feels wrong.</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
            <Pressable style={styles.row} onPress={() => reportIncident('accident')}>
              <Text style={styles.rowIcon}>💥</Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Report an accident</Text>
                <Text style={styles.rowSub}>Call {RESCUE} first if anyone is hurt.</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Online scams ── The two-destination rule, spelled out. ── */}
        <Text style={styles.sectionTitle}>Online scam or fraud</Text>
        <View style={styles.scamCard}>
          <Text style={styles.scamTitle}>Report it in both places</Text>
          <Text style={styles.scamBody}>
            Velocity Rides can refund what we charged and ban the account. Only Pakistan&apos;s
            cybercrime agency, <Text style={styles.bold}>NCCIA</Text>, can investigate and
            recover money — so do both, and keep your screenshots.
          </Text>
          <Text style={styles.scamWarn}>
            Velocity Rides staff never ask for an OTP, a PIN, a card number, or a transfer to
            a personal account. Anyone who does is not us.
          </Text>

          <Pressable
            style={styles.scamPrimary}
            onPress={() => router.push('/support/new?category=online_scam')}
          >
            <Text style={styles.scamPrimaryTxt}>1 · Report to Velocity Rides</Text>
          </Pressable>

          <View style={styles.scamRow}>
            <Pressable
              style={styles.scamSecondary}
              onPress={() => confirmCall(NCCIA_HELPLINE, "NCCIA's cybercrime helpline")}
            >
              <Text style={styles.scamSecondaryTxt}>2 · Call NCCIA {NCCIA_HELPLINE}</Text>
            </Pressable>
            <Pressable
              style={styles.scamSecondary}
              onPress={() =>
                Linking.openURL(NCCIA_COMPLAINT_URL).catch(() =>
                  Alert.alert('Could not open', `Visit ${NCCIA_COMPLAINT_URL} in your browser.`),
                )
              }
            >
              <Text style={styles.scamSecondaryTxt}>File online</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Everything else ── */}
        <Text style={styles.sectionTitle}>Any other problem</Text>
        <Pressable style={styles.row} onPress={() => router.push('/support')}>
          <Text style={styles.rowIcon}>⚡</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Velocity Rapid Response</Text>
            <Text style={styles.rowSub}>
              Answered in seconds, and handed to a real person the moment you ask.
            </Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Police {POLICE} · Rescue {RESCUE} · NCCIA cybercrime {NCCIA_HELPLINE}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: { fontSize: 30, color: colors.text, lineHeight: 32 },
    headerTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
    content: { padding: 16, paddingBottom: 40, gap: 10 },

    promise: {
      backgroundColor: colors.primary + '14',
      borderWidth: 1,
      borderColor: colors.primary + '55',
      borderRadius: 16,
      padding: 14,
    },
    promiseTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
    promiseBody: { fontSize: 12.5, color: colors.muted, lineHeight: 19, marginTop: 6 },

    sectionTitle: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.muted,
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      marginTop: 12,
      marginBottom: 2,
    },

    bigBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1.5,
    },
    policeBtn: { backgroundColor: colors.danger + '18', borderColor: colors.danger },
    rescueBtn: { backgroundColor: colors.card, borderColor: colors.border },
    bigBtnIcon: { fontSize: 26 },
    bigBtnBody: { flex: 1 },
    bigBtnTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
    bigBtnSub: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 2 },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 13,
    },
    rowIcon: { fontSize: 20 },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: 14.5, fontWeight: '800', color: colors.text },
    rowSub: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 2 },
    chev: { fontSize: 22, color: colors.muted },

    scamCard: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 14,
      gap: 8,
    },
    scamTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
    scamBody: { fontSize: 12.5, color: colors.muted, lineHeight: 19 },
    scamWarn: {
      fontSize: 12,
      color: colors.danger,
      lineHeight: 18,
      fontWeight: '700',
    },
    bold: { fontWeight: '900', color: colors.text },
    scamPrimary: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 2,
    },
    scamPrimaryTxt: { fontSize: 14, fontWeight: '900', color: colors.btnText },
    scamRow: { flexDirection: 'row', gap: 8 },
    scamSecondary: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: 'center',
    },
    scamSecondaryTxt: { fontSize: 12.5, fontWeight: '800', color: colors.text },

    footnote: {
      fontSize: 11,
      color: colors.muted,
      textAlign: 'center',
      marginTop: 18,
      lineHeight: 17,
    },
  }),
);
