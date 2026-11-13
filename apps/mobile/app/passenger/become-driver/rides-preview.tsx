/**
 * "See the rides coming" — what a driver part-way through registration is shown.
 * ----------------------------------------------------------------------------
 * The owner's screen (2026-11-13), in his order: the rides, and over them a red
 * warning to finish registering.
 *
 * Every ride here comes from `getStarterRides`, which answers with EXAMPLES
 * ONLY — never a real pool. That is a deliberate boundary and not an oversight:
 * somebody who has uploaded two documents and been checked by nobody has no
 * business reading real riders' routes, times or whereabouts. The backend
 * decides what is shown; this screen cannot ask for anything else.
 *
 * The warning is red and it is the first thing on the screen, because the one
 * thing this screen must not do is read as "you are done". Nothing here can be
 * accepted: the only button that does anything finishes the registration.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api, type DriverPoolView } from '../../../src/api/client';
import { useCurrentLocation } from '../../../src/hooks/location';
import { useForegroundInterval } from '../../../src/hooks/useForegroundInterval';
import { clockLabel, toHHMM } from '../../../src/lib/dailyRouteTime';
import { themed } from '../../../src/theme';
import { ArrowIcon } from '../../../src/ui/ServiceIcons';
import { Text } from '../../../src/ui/Text';
import { OnbButton, StepHeader, oc } from '../../../src/ui/onboarding';

/** How often the list is refreshed while the screen is open. */
const REFRESH_MS = 30_000;

/** "in 7 min", or the clock once it is further out than an hour. */
function whenOf(j: DriverPoolView): string {
  if (!j.departsAtMs) return 'Leaving now';
  const mins = Math.round((j.departsAtMs - Date.now()) / 60_000);
  if (mins <= 0) return 'Leaving now';
  if (mins < 60) return `Leaving in ${mins} min`;
  return `Leaving at ${clockLabel(toHHMM(new Date(j.departsAtMs)))}`;
}

/** The green "live" dot, so the list reads as something happening now. */
function LiveDot() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[styles.liveDot, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }]}
    />
  );
}

function RideCard({ job }: { job: DriverPoolView }) {
  const sharing = Math.max(1, job.riders);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.fare}>PKR {job.earnNow.toLocaleString('en-PK')}</Text>
        <View style={styles.livePill}>
          <LiveDot />
          <Text style={styles.liveText}>{whenOf(job)}</Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.pickDot} />
        <Text style={styles.place} numberOfLines={1}>{job.pickup.address}</Text>
      </View>
      <View style={styles.row}>
        <ArrowIcon size={13} color={oc.sub} />
        <Text style={styles.place} numberOfLines={1}>{job.dropoff.address}</Text>
      </View>

      <View style={styles.facts}>
        <Text style={styles.fact}>
          {sharing} {sharing === 1 ? 'passenger' : 'passengers'} sharing
        </Text>
        <Text style={styles.factDot}>·</Text>
        <Text style={styles.fact}>{job.routeKm} km</Text>
        {job.toPickupKm !== null ? (
          <>
            <Text style={styles.factDot}>·</Text>
            <Text style={styles.fact}>{job.toPickupKm} km from you</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

export default function RidesPreview() {
  const router = useRouter();
  const { coords, status, request } = useCurrentLocation();
  const [jobs, setJobs] = useState<DriverPoolView[] | null>(null);

  const load = useCallback(() => {
    if (!coords) return;
    api
      .getStarterRides({ lat: coords.lat, lng: coords.lng })
      .then((r) => setJobs(r.pools))
      // An empty list, never a spinner that never ends: this screen is a
      // courtesy and must not be able to trap somebody mid-registration.
      .catch(() => setJobs((j) => j ?? []));
    // Keyed on the coordinates themselves: a new object for the same fix must
    // not start another call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng]);

  useEffect(() => { load(); }, [load]);
  useForegroundInterval(coords ? load : null, REFRESH_MS);

  const denied = status === 'unavailable';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Rides near you" />
      <ScrollView contentContainerStyle={styles.container}>
        {denied ? (
          <Pressable style={styles.locCard} onPress={request}>
            <Text style={styles.locText}>
              Turn on location to see the rides going out around you.
            </Text>
            <Text style={styles.locLink}>Allow location</Text>
          </Pressable>
        ) : jobs === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={oc.green} />
            <Text style={styles.loadingText}>Looking for rides around you…</Text>
          </View>
        ) : jobs.length === 0 ? (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>
              No rides to show here yet. Complete your registration — you will be among the first
              drivers in this area.
            </Text>
          </View>
        ) : (
          jobs.map((j) => <RideCard key={j.id} job={j} />)
        )}

        {/*
          The rides, and then the warning — the owner's order (2026-11-13). It
          sits under them rather than over them, and the button that acts on it
          is pinned to the bottom of the screen, so the one thing this screen is
          for cannot scroll out of reach while somebody reads the rides.
        */}
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>Please complete your registration</Text>
          <Text style={styles.warningText}>
            These are the kind of rides going out around you right now. You cannot take any of them
            until your registration is complete and approved — finish it and real rides start
            coming to you.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <OnbButton
          label="Complete registration"
          onPress={() => router.replace('/passenger/become-driver/checklist')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14, paddingBottom: 8 },

  warning: {
    backgroundColor: '#fdecea',
    borderColor: '#e74c3c',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  warningTitle: { color: '#c0392b', fontWeight: '900', fontSize: 16 },
  warningText: { color: '#a93226', fontWeight: '600', fontSize: 13, lineHeight: 19 },

  card: { backgroundColor: oc.card, borderRadius: 16, padding: 16, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fare: { color: oc.text, fontSize: 24, fontWeight: '900' },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#eaf7ee', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: oc.green },
  liveText: { color: '#1b7a2e', fontSize: 12, fontWeight: '800' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2.5, borderColor: oc.green },
  place: { flex: 1, color: oc.text, fontSize: 14, fontWeight: '600' },

  facts: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  fact: { color: oc.sub, fontSize: 12, fontWeight: '700' },
  factDot: { color: oc.sub, fontSize: 12 },

  loading: { backgroundColor: oc.card, borderRadius: 16, padding: 20, gap: 10, alignItems: 'center' },
  loadingText: { color: oc.sub, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19 },

  locCard: { backgroundColor: oc.card, borderRadius: 16, padding: 18, gap: 8 },
  locText: { color: oc.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  locLink: { color: oc.green, fontSize: 14, fontWeight: '800' },

  footer: { padding: 18, paddingTop: 10, backgroundColor: oc.screen },
}));
