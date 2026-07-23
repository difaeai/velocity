import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api, type NearbyPublicPool } from '../../src/api/client';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { useAuth } from '../../src/auth/AuthContext';
import { useCurrentLocation } from '../../src/hooks/location';
import {
  usePlacesAutocomplete,
  fetchPlaceDetail,
  geocodeAddress,
  type PlacePrediction,
} from '../../src/hooks/places';
import { NearbyPoolCard } from '../../src/ui/NearbyPoolCard';
import { PickupDotIcon, DestinationPinIcon, PoolIcon } from '../../src/ui/RideIcons';

const PICKUP_RADIUS_KM = 5;
const DEST_RADIUS_KM = 5;

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * "Find a pool" — discovery for public pools headed the rider's way.
 *
 * Pickup is the rider's current location; they type a destination and we surface
 * every public pool whose pickup is within 5 km of them AND whose drop-off is
 * within 5 km of where they're going. With no destination it's just "pools near
 * me". Cards never show names — only areas, gender make-up, seats and fare. If
 * nothing matches, they start their own pool through the normal booking flow.
 */
export default function FindPools() {
  const router = useRouter();
  const { user } = useAuth();
  const { coords, address: currentAddress, status: locStatus, request: requestLocation } =
    useCurrentLocation();

  const [dest, setDest] = useState('');
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pools, setPools] = useState<NearbyPublicPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const sessionTokenRef = useRef(uuidv4());
  const { predictions, loading: placesLoading } = usePlacesAutocomplete(dest, sessionTokenRef.current);
  // Hide the suggestion list once a place is chosen (or the field is untouched).
  const [predictionsOpen, setPredictionsOpen] = useState(false);
  // A newer destination pick invalidates a slower coordinate lookup.
  const destSeq = useRef(0);

  const runSearch = useCallback(
    async (destPoint: { lat: number; lng: number } | null) => {
      if (!coords) {
        requestLocation();
        return;
      }
      setLoading(true);
      setSearched(true);
      try {
        const res = await api.getNearbyPublicPoolTrips({
          lat: coords.lat,
          lng: coords.lng,
          radiusKm: PICKUP_RADIUS_KM,
          ...(destPoint
            ? { destLat: destPoint.lat, destLng: destPoint.lng, destRadiusKm: DEST_RADIUS_KM }
            : {}),
        });
        setPools(res.pools);
      } catch {
        setPools([]);
      } finally {
        setLoading(false);
      }
    },
    [coords, requestLocation],
  );

  // First load (and whenever location arrives): show every pool near the rider.
  useEffect(() => {
    if (coords && !searched) runSearch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords]);

  async function selectPrediction(pred: PlacePrediction) {
    const seq = ++destSeq.current;
    setDest(pred.fullText);
    setPredictionsOpen(false);
    setDestCoords(null);
    const detail = await fetchPlaceDetail(pred.placeId, sessionTokenRef.current);
    sessionTokenRef.current = uuidv4();
    let point = detail ? { lat: detail.lat, lng: detail.lng } : null;
    if (!point) {
      const geo = await geocodeAddress(pred.fullText);
      point = geo ? { lat: geo.lat, lng: geo.lng } : null;
    }
    if (destSeq.current !== seq) return;
    setDestCoords(point);
    runSearch(point);
  }

  function clearDest() {
    setDest('');
    setDestCoords(null);
    setPredictionsOpen(false);
    runSearch(null);
  }

  const headingText = destCoords
    ? 'Pools heading your way'
    : 'Pools near you';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Find a pool</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Route inputs — pickup fixed to current location, destination is searched */}
      <View style={styles.routeCard}>
        <View style={styles.inputRow}>
          <View style={styles.inputIconWrap}>
            <PickupDotIcon size={17} color="rgba(255,255,255,0.75)" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.inputLabel}>YOUR PICKUP</Text>
            <Text style={styles.pickupValue} numberOfLines={1}>
              {currentAddress ?? (coords ? 'Current location' : 'Enable location')}
            </Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.inputRow}>
          <View style={styles.inputIconWrap}>
            <DestinationPinIcon size={17} color={colors.primary} accent={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.inputLabel, { color: colors.primary }]}>WHERE ARE YOU GOING?</Text>
            <TextInput
              value={dest}
              onChangeText={(t) => {
                setDest(t);
                setDestCoords(null);
                setPredictionsOpen(true);
              }}
              placeholder="Search a destination (optional)…"
              placeholderTextColor={colors.muted}
              style={styles.destInput}
            />
          </View>
          {dest.length > 0 && (
            <Pressable onPress={clearDest} hitSlop={10} style={styles.clearBtn}>
              <Text style={styles.clearTxt}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Destination suggestions overlay the results while typing */}
        {predictionsOpen && dest.trim().length > 1 && predictions.length > 0 ? (
          <View style={styles.suggestBox}>
            {placesLoading ? (
              <View style={styles.suggestLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null}
            {predictions.slice(0, 6).map((pred) => (
              <Pressable key={pred.placeId} style={styles.suggestRow} onPress={() => selectPrediction(pred)}>
                <DestinationPinIcon size={15} color="#c9cfcc" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestMain} numberOfLines={1}>{pred.mainText}</Text>
                  <Text style={styles.suggestSub} numberOfLines={1}>{pred.secondaryText}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>
              {headingText.toUpperCase()}
              {destCoords ? ` · within ${DEST_RADIUS_KM} KM OF YOUR DROP` : ` · WITHIN ${PICKUP_RADIUS_KM} KM`}
            </Text>

            {loading ? (
              <View style={styles.centerState}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.centerStateText}>Looking for pools…</Text>
              </View>
            ) : pools.length > 0 ? (
              <View style={{ gap: 10 }}>
                {pools.map((p) => (
                  <NearbyPoolCard
                    key={p.code}
                    pool={p}
                    onJoin={() =>
                      router.push(`/passenger/pool-join/${p.code}` as Parameters<typeof router.push>[0])
                    }
                  />
                ))}
              </View>
            ) : (
              <View style={styles.centerState}>
                <View style={styles.emptyIconWrap}>
                  <PoolIcon size={30} color={colors.primary} accent={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {destCoords ? 'No pools going that way yet' : 'No pools near you right now'}
                </Text>
                <Text style={styles.emptySub}>
                  Be the first — start your own pool on this route and nearby riders can join and split the fare.
                </Text>
              </View>
            )}

            {/* Always offer creating your own pool */}
            <Pressable
              style={({ pressed }) => [styles.createBtn, pressed && { opacity: 0.85 }]}
              onPress={() => router.push('/passenger/booking')}
            >
              <PoolIcon size={18} color="#0b0d0c" accent="#0b0d0c" />
              <Text style={styles.createBtnText}>Create your own pool</Text>
            </Pressable>

            {!coords && locStatus !== 'loading' ? (
              <Pressable onPress={requestLocation} style={styles.locHintBtn}>
                <Text style={styles.locHint}>Enable location to see pools near you</Text>
              </Pressable>
            ) : null}
          </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { width: 40 },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  routeCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  inputIconWrap: { width: 20, alignItems: 'center' },
  inputLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1,
  },
  pickupValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginTop: 1,
  },
  destInput: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    height: 26,
    padding: 0,
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 32,
  },
  clearBtn: { padding: 6 },
  clearTxt: { color: colors.muted, fontSize: 14 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.8,
  },

  suggestBox: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  suggestLoading: { paddingVertical: 12, alignItems: 'center' },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  suggestMain: { fontSize: 14, fontWeight: '700', color: colors.text },
  suggestSub: { fontSize: 12, color: colors.muted, marginTop: 1 },

  centerState: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 32,
  },
  centerStateText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.glassLime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptySub: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 12,
  },

  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  createBtnText: { fontSize: 15, fontWeight: '900', color: '#0b0d0c' },

  locHintBtn: { alignItems: 'center', paddingVertical: 6 },
  locHint: { fontSize: 12, color: colors.primary, fontWeight: '700' },
}));
