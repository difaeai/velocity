/**
 * Riders on your way.
 *
 * Two ways in, one screen:
 *
 *   ON A TRIP        The driver is already carrying a pool. The corridor is that
 *                    trip's route, and the riders shown are the ones standing on
 *                    it who can be picked up without going anywhere the car was
 *                    not already going.
 *
 *   HEADING HOME     No trip at all. The driver says where they are going, and
 *                    the same search runs against that route. Earning on a drive
 *                    they were making anyway.
 *
 * Every card is a ride the backend has ALREADY cleared: seats, gender rules, the
 * 1 km corridor, the 4 km drop allowance and the fare gate all passed server-side
 * before it was sent here. Tapping accept cannot fail for a reason the card did
 * not show — which is the whole reason the feed and the accept path run the same
 * checks over there rather than being talked into agreeing here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { api, type EnRouteMatch } from '../../src/api/client';
import { colors } from '../../src/config';
import { useCurrentLocation } from '../../src/hooks/location';
import { useDriverActiveTrip } from '../../src/hooks/driver';
import { fetchRouteInfo } from '../../src/hooks/directions';
import { fetchPlaceDetail, usePlacesAutocomplete } from '../../src/hooks/places';
import { PrimaryButton } from '../../src/ui/components';
import { LiveMap } from '../../src/ui/LiveMap';
import type { GeoPoint } from '../../src/domain/types';

/** Re-check the corridor this often — riders appear and are taken by others. */
const REFRESH_MS = 20_000;

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function EnRoute() {
  const router = useRouter();
  const { user } = useAuth();
  const activeTrip = useDriverActiveTrip(user?.uid);
  const { coords } = useCurrentLocation();

  /**
   * The road route, encoded, from OUR map. Only a fallback: when the backend has
   * its own Maps key it fetches the road itself and ignores this. So a failure to
   * get it here is not fatal — `routeReady` is what gates the search, not this.
   */
  const [polyline, setPolyline] = useState<string | undefined>(undefined);
  const [routeReady, setRouteReady] = useState(false);
  const [routeLabel, setRouteLabel] = useState<string>('');
  const [matches, setMatches] = useState<EnRouteMatch[]>([]);
  const [seatsLeft, setSeatsLeft] = useState(0);
  const [walletTrip, setWalletTrip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Where are we going? ────────────────────────────────────────────────────
  // On a trip, the corridor is decided for us: it is the trip's own route, and
  // the driver gets no say in it (nor does the backend take one from them).
  const onTrip = !!activeTrip;

  useEffect(() => {
    if (!activeTrip?.pickup || !activeTrip?.dropoff) return;
    let alive = true;
    setRouteLabel(
      `${activeTrip.pickup.address ?? 'Pickup'} → ${activeTrip.dropoff.address ?? 'Destination'}`,
    );
    // Send our polyline up if we can get one, but search either way — the server
    // can fetch the road itself, and on this path it already knows the endpoints.
    fetchRouteInfo(activeTrip.pickup, activeTrip.dropoff).then((info) => {
      if (!alive) return;
      setPolyline(info?.encoded);
      setRouteReady(true);
    });
    return () => { alive = false; };
  }, [activeTrip?.id, activeTrip?.pickup, activeTrip?.dropoff]);

  // ── Look for riders ───────────────────────────────────────────────────────
  const search = useCallback(async () => {
    if (!routeReady) return;
    setLoading(true);
    try {
      const res = await api.getEnRouteMatches({
        polyline,
        driverLat: coords?.lat,
        driverLng: coords?.lng,
      });
      setMatches(res.matches ?? []);
      setSeatsLeft(res.seatsLeft ?? 0);
      setWalletTrip(res.walletTrip === true);
    } catch (e) {
      Alert.alert('Could not search', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [polyline, routeReady, coords?.lat, coords?.lng]);

  useEffect(() => {
    if (!routeReady) return;
    search();
    const t = setInterval(search, REFRESH_MS);
    return () => clearInterval(t);
  }, [routeReady, search]);

  // ── Take a rider ──────────────────────────────────────────────────────────
  const accept = useCallback(
    async (m: EnRouteMatch) => {
      setBusyId(m.tripId);
      try {
        const res = await api.acceptEnRouteRider({
          tripId: m.tripId,
          polyline,
          driverLat: coords?.lat,
          driverLng: coords?.lng,
        });
        Alert.alert(
          `${res.riderName} is on board`,
          `They pay PKR ${res.fare}. Your trip is now worth PKR ${res.driverGross} — ` +
            `PKR ${res.earnExtra} more than before.`,
        );
        // Back to the trip: the pickup order and everyone's new fare live there.
        router.replace('/driver/home');
      } catch (e) {
        Alert.alert('Could not pick them up', (e as Error).message);
        search(); // the feed was stale — refresh it rather than leave a dead card
      } finally {
        setBusyId(null);
      }
    },
    [polyline, coords?.lat, coords?.lng, router, search],
  );

  const mapCoords = useMemo(
    () => (activeTrip?.pickup && activeTrip?.dropoff
      ? { pickup: activeTrip.pickup, dropoff: activeTrip.dropoff }
      : null),
    [activeTrip?.pickup, activeTrip?.dropoff],
  );

  // ── No trip and no route yet: ask where they're heading ───────────────────
  if (!onTrip && !routeReady) {
    return (
      <RouteSetter
        coords={coords}
        onReady={(encoded, label) => {
          setPolyline(encoded);
          setRouteLabel(label);
          setRouteReady(true);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Riders on your way</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.routeBar}>
        <Text style={styles.routeLabel} numberOfLines={1}>{routeLabel}</Text>
        <Text style={styles.routeHint}>
          {onTrip
            ? 'Anyone within 1 km of this route who is also heading your way'
            : 'We only show riders who are on this road and finishing near where you finish'}
        </Text>
      </View>

      {mapCoords && (
        <View style={styles.map}>
          <LiveMap
            coords={coords}
            pickup={mapCoords.pickup}
            dropoff={mapCoords.dropoff}
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}

      {walletTrip ? (
        <Notice text="Your current trip is paid by wallet, so extra riders can't be added to it. Cash pools only, for now." />
      ) : seatsLeft <= 0 ? (
        <Notice text="Your car is full." />
      ) : loading && matches.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Looking along your route…</Text>
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyBig}>Nobody on your way right now</Text>
          <Text style={styles.muted}>
            We'll keep checking. {seatsLeft} seat{seatsLeft === 1 ? '' : 's'} free.
          </Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(m) => m.tripId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <MatchCard
              match={item}
              busy={busyId === item.tripId}
              disabled={busyId !== null}
              onAccept={() => accept(item)}
            />
          )}
        />
      )}

      {!onTrip && (
        <Pressable
          style={styles.endRoute}
          onPress={async () => {
            await api.endDriverRoute({}).catch(() => {});
            router.back();
          }}
        >
          <Text style={styles.endRouteText}>End my route</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

// ── One rider on the corridor ───────────────────────────────────────────────

function MatchCard({
  match,
  busy,
  disabled,
  onAccept,
}: {
  match: EnRouteMatch;
  busy: boolean;
  disabled: boolean;
  onAccept: () => void;
}) {
  const saving = Math.round((1 - match.fare / Math.max(1, match.soloFare)) * 100);
  const detourKm = (match.detourM / 1000).toFixed(1);

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>
            {match.passengerName}
            {match.passengerGender === 'female' ? ' ♀' : match.passengerGender === 'male' ? ' ♂' : ''}
          </Text>
          <Text style={styles.rating}>⭐ {match.passengerRating.toFixed(1)}</Text>
        </View>
        <View style={styles.earnPill}>
          <Text style={styles.earnPillText}>+PKR {match.earnExtra}</Text>
        </View>
      </View>

      <View style={styles.leg}>
        <Text style={styles.legDot}>●</Text>
        <Text style={styles.legText} numberOfLines={1}>{match.pickup.address ?? 'Pickup'}</Text>
      </View>
      <View style={styles.leg}>
        <Text style={[styles.legDot, { color: colors.primary }]}>▼</Text>
        <Text style={styles.legText} numberOfLines={1}>{match.dropoff.address ?? 'Drop-off'}</Text>
      </View>

      {/* The two numbers that decide whether this is worth taking: how far off the
          road it drags you, and what the car is worth once they're in it. */}
      <View style={styles.stats}>
        <Stat label="Detour" value={`${detourKm} km`} />
        <Stat label="They pay" value={`PKR ${match.fare}`} />
        <Stat label="Car total" value={`PKR ${match.driverGrossAfter}`} />
      </View>

      {saving > 0 && (
        <Text style={styles.saving}>
          They save {saving}% versus riding alone (PKR {match.soloFare}).
        </Text>
      )}

      {/* Everyone already in the car, and what taking this rider does to them.
          It can only ever go down — but the driver should see it, because they
          are the one the passengers will ask about it. */}
      {match.ridersAfter.length > 0 && (
        <View style={styles.aboard}>
          <Text style={styles.aboardTitle}>Already in your car</Text>
          {match.ridersAfter.map((r) => (
            <View key={r.uid} style={styles.aboardRow}>
              <Text style={styles.aboardName}>{r.name}</Text>
              <Text style={styles.aboardFare}>
                {r.fareAfter < r.fareNow ? (
                  <>
                    <Text style={styles.strike}>PKR {r.fareNow}</Text>
                    <Text style={styles.aboardDrop}>  PKR {r.fareAfter}</Text>
                  </>
                ) : (
                  <Text style={styles.aboardSame}>PKR {r.fareAfter}</Text>
                )}
              </Text>
            </View>
          ))}
        </View>
      )}

      <PrimaryButton
        label={busy ? 'Picking up…' : 'Pick them up'}
        disabled={disabled}
        onPress={onAccept}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

// ── "I'm heading home" — declare a route ────────────────────────────────────

function RouteSetter({
  coords,
  onReady,
}: {
  coords: { lat: number; lng: number } | null;
  onReady: (polyline: string | undefined, label: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [token] = useState(uuid);
  const [busy, setBusy] = useState(false);
  const { predictions } = usePlacesAutocomplete(query, token);

  const choose = async (placeId: string, description: string) => {
    if (!coords) {
      Alert.alert('Location needed', 'We need your current location to work out your route.');
      return;
    }
    setBusy(true);
    try {
      const detail = await fetchPlaceDetail(placeId, token);
      if (!detail) throw new Error('Could not find that place.');

      const origin: GeoPoint = { lat: coords.lat, lng: coords.lng, address: 'Current location' };
      const destination: GeoPoint = { lat: detail.lat, lng: detail.lng, address: description };

      // Try to get the road route here, but don't insist: the backend can fetch it
      // itself, and it only trusts ours when it has no key of its own anyway. If
      // Maps is unreachable from the phone, the route still gets set.
      const info = await fetchRouteInfo(origin, destination);

      await api.setDriverRoute({ origin, destination, polyline: info?.encoded });
      onReady(info?.encoded, `Current location → ${description}`);
    } catch (e) {
      Alert.alert('Could not set your route', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Earn on your way</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.setter} keyboardShouldPersistTaps="handled">
        <Text style={styles.setterLead}>
          Heading somewhere anyway? Tell us where, and we'll show you pool riders standing on that
          road who are going the same way. You get paid for a drive you were making regardless.
        </Text>

        <Text style={styles.label}>Where are you heading?</Text>
        <TextInput
          style={styles.input}
          placeholder="Home, office, anywhere…"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          editable={!busy}
          autoCorrect={false}
        />

        {busy && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Working out your route…</Text>
          </View>
        )}

        {!busy &&
          predictions.map((p) => (
            <Pressable
              key={p.placeId}
              style={styles.prediction}
              onPress={() => choose(p.placeId, p.mainText)}
            >
              <Text style={styles.predictionMain}>{p.mainText}</Text>
              <Text style={styles.predictionSecondary} numberOfLines={1}>{p.secondaryText}</Text>
            </Pressable>
          ))}

        <View style={styles.rules}>
          <Text style={styles.rulesTitle}>How it works</Text>
          <Text style={styles.rule}>· Only riders within 1 km of your road are shown.</Text>
          <Text style={styles.rule}>· They must finish within 4 km of where you finish.</Text>
          <Text style={styles.rule}>· Only people who booked a pool — nobody is put in your car by surprise.</Text>
          <Text style={styles.rule}>· Everyone pays for the road they are actually on. You keep the rest.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: { color: colors.primary, fontSize: 16, fontWeight: '600', width: 44 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },

  routeBar: { paddingHorizontal: 16, paddingBottom: 10 },
  routeLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  routeHint: { color: colors.muted, fontSize: 12, marginTop: 2 },

  map: { height: 180, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  muted: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  emptyBig: { color: colors.text, fontSize: 16, fontWeight: '600' },

  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rating: { color: colors.muted, fontSize: 12, marginTop: 2 },
  earnPill: {
    backgroundColor: `${colors.primary}22`,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  earnPillText: { color: colors.primary, fontWeight: '800', fontSize: 14 },

  leg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legDot: { color: colors.muted, fontSize: 10 },
  legText: { color: colors.text, fontSize: 13, flex: 1 },

  stats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    marginTop: 2,
  },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { color: colors.muted, fontSize: 11 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 },

  saving: { color: colors.primary, fontSize: 12 },

  aboard: { gap: 4 },
  aboardTitle: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  aboardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aboardName: { color: colors.text, fontSize: 13 },
  aboardFare: { fontSize: 13 },
  strike: { color: colors.muted, textDecorationLine: 'line-through' },
  aboardDrop: { color: colors.primary, fontWeight: '700' },
  aboardSame: { color: colors.text },

  endRoute: { alignItems: 'center', padding: 16 },
  endRouteText: { color: colors.danger, fontSize: 14, fontWeight: '600' },

  setter: { padding: 16, gap: 12 },
  setterLead: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  label: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 8 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    color: colors.text,
    fontSize: 15,
  },
  prediction: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  predictionMain: { color: colors.text, fontSize: 15, fontWeight: '600' },
  predictionSecondary: { color: colors.muted, fontSize: 12, marginTop: 2 },

  rules: {
    marginTop: 20,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  rulesTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  rule: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
