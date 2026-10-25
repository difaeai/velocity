/**
 * "Locations people are traveling to" — everyone's saved daily routes, as areas.
 *
 * Every route a rider saves from the home map's "Location & time" pill lands in
 * this list for the people around them: the pickup AREA, the drop-off AREA, the
 * average time they leave and how many men and women make that trip. It is the
 * answer to "is anyone else going my way?" before a shared ride exists, and for
 * a driver it is where the passengers are.
 *
 * Everything comes from `getTravelAreas`, which is the privacy boundary: the
 * routes themselves are owner-only, and only area names, counts and a rounded
 * time ever leave the server — never an address, a pin or a name.
 *
 * Colours are light-on-dark literals: the map card floats over a dark map, and
 * the list is a dark panel wherever it is shown (home sheet, driver screen).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api, type TravelAreas } from '../api/client';
import { clockLabel } from '../lib/dailyRouteTime';
import { themed } from '../theme';
import { RouteMapIcon } from './DrawerIcons';
import { ArrowIcon } from './ServiceIcons';
import { Text } from './Text';

const LIME = '#ccff00';
const MALE = '#7dd3fc';
const FEMALE = '#f9a8d4';

type Coords = { lat: number; lng: number };

/** "♂ 3  ♀ 1", plus whoever has not given a gender. Only signs with someone behind them. */
export function GenderTally({ people, male, female }: { people: number; male: number; female: number }) {
  const other = people - male - female;
  return (
    <View style={styles.tally}>
      {male > 0 ? <Text style={[styles.tallyTxt, { color: MALE }]}>♂ {male}</Text> : null}
      {female > 0 ? <Text style={[styles.tallyTxt, { color: FEMALE }]}>♀ {female}</Text> : null}
      {other > 0 ? (
        <Text style={styles.tallyOther}>{male || female ? `+${other}` : `${other} ${other === 1 ? 'person' : 'people'}`}</Text>
      ) : null}
    </View>
  );
}

/* ── The map card ───────────────────────────────────────────────────────────
   Where the cars / bikes / passengers legend used to stand, on the right edge.
   It costs nothing until it is tapped: the list is only fetched when opened. */
export function TravelAreasPill({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.mapCard, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel="Locations people are traveling to. Tap to see the list."
    >
      <View style={styles.mapCardTop}>
        <View style={styles.mapIcon}>
          <RouteMapIcon size={22} accent={LIME} />
        </View>
        <ArrowIcon size={14} color={LIME} />
      </View>
      <Text style={styles.mapTitle} numberOfLines={3}>Locations people are traveling to</Text>
    </Pressable>
  );
}

/* ── The list ───────────────────────────────────────────────────────────────
   Three columns as asked for — pickup area, drop-off area, average time — with
   the men and women under the time. Fetched once per opening, around `coords`. */
export function TravelAreasList({ coords }: { coords: Coords | null }) {
  const [data, setData] = useState<TravelAreas | null>(null);
  const [failed, setFailed] = useState(false);
  // To ~1 km, so a GPS fix that drifts a few metres does not refetch the list.
  const at = coords ? `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}` : null;

  const load = useCallback(() => {
    if (!at) return;
    const [lat, lng] = at.split(',').map(Number) as [number, number];
    setFailed(false);
    setData(null);
    api.getTravelAreas({ lat, lng }).then(setData).catch(() => setFailed(true));
  }, [at]);

  useEffect(load, [load]);

  if (!at) {
    return <Text style={styles.note}>Turn on your location to see the routes around you.</Text>;
  }
  if (failed) {
    return (
      <View style={styles.centre}>
        <Text style={styles.note}>Could not load the list.</Text>
        <Pressable onPress={load} hitSlop={8} accessibilityRole="button">
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!data) return <ActivityIndicator color={LIME} style={{ marginVertical: 24 }} />;
  if (data.areas.length === 0) {
    return (
      <Text style={styles.note}>
        No saved routes around you yet. Add yours and the people who travel the same way will see it.
      </Text>
    );
  }

  return (
    <View style={styles.table}>
      <View style={styles.headRow}>
        <Text style={[styles.head, styles.colArea]}>Pickup area</Text>
        <Text style={[styles.head, styles.colArea]}>Drop-off area</Text>
        <Text style={[styles.head, styles.colTime]}>Avg time</Text>
      </View>
      {data.areas.map((a) => (
        <View key={`${a.from}|${a.to}`} style={styles.row}>
          <Text style={[styles.area, styles.colArea]} numberOfLines={2}>{a.from}</Text>
          <View style={[styles.colArea, styles.toCell]}>
            {/* Its own box so a long area name can never squeeze it. */}
            <View style={styles.noShrink}>
              <ArrowIcon size={12} color="#6b7270" />
            </View>
            <Text style={styles.area} numberOfLines={2}>{a.to}</Text>
          </View>
          <View style={styles.colTime}>
            <Text style={[styles.time, a.time === null && styles.timeAny]}>{clockLabel(a.time) ?? 'Any time'}</Text>
            <GenderTally people={a.people} male={a.male} female={a.female} />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ── The rider's sheet ──────────────────────────────────────────────────────
   The list, and the way onto it: "Add your route" opens the Location & time
   editor, and that route is in this list for everyone the next time it opens. */
export function TravelAreasSheet({
  open,
  coords,
  onClose,
  onAdd,
}: {
  open: boolean;
  coords: Coords | null;
  onClose: () => void;
  onAdd: () => void;
}) {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rise, {
      toValue: open ? 1 : 0,
      duration: open ? 240 : 160,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [open, rise]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View style={[styles.sheetWrap, { transform: [{ translateY }] }]}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grabber} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
              <Text style={styles.sheetTitle}>Locations people are traveling to</Text>
              <Text style={styles.sheetText}>
                From the routes riders near you have saved. Areas only — never an address or a name.
              </Text>
              {open ? <TravelAreasList coords={coords} /> : null}
              <Pressable
                style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
                onPress={onAdd}
                accessibilityRole="button"
              >
                <Text style={styles.addTxt}>+ Add your route</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  /* ── Map card ── */
  mapCard: {
    width: 116,
    marginRight: 16,
    marginTop: 8,
    padding: 10,
    gap: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(16,19,18,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(204,255,0,0.30)',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  mapCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mapIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(204,255,0,0.12)',
  },
  mapTitle: { color: '#ffffff', fontSize: 12, lineHeight: 15, fontWeight: '900' },

  /* ── List ── */
  table: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  headRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  head: { color: '#7d8482', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  colArea: { flex: 1, minWidth: 0 },
  colTime: { width: 78, alignItems: 'flex-end', gap: 3 },
  toCell: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noShrink: { flexShrink: 0 },
  area: { flexShrink: 1, color: '#ffffff', fontSize: 13, fontWeight: '800' },
  time: { color: LIME, fontSize: 12.5, fontWeight: '900' },
  timeAny: { color: '#c4cac8' },
  tally: { flexDirection: 'row', gap: 7 },
  tallyTxt: { fontSize: 11.5, fontWeight: '900' },
  tallyOther: { color: '#9aa2a0', fontSize: 11, fontWeight: '800' },
  centre: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  note: { color: '#9aa2a0', fontSize: 12.5, fontWeight: '600', lineHeight: 18, paddingVertical: 8 },
  retry: { color: LIME, fontSize: 13, fontWeight: '900' },

  /* ── Sheet ── (the same shape as the Location & time sheet beside it) */
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheetWrap: { width: '100%', maxHeight: '88%' },
  sheet: {
    flexShrink: 1,
    backgroundColor: '#151917',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingTop: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 6,
  },
  sheetBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 34, gap: 12 },
  sheetTitle: { color: '#ffffff', fontSize: 19, fontWeight: '900', letterSpacing: -0.2 },
  sheetText: { color: '#9aa2a0', fontSize: 12.5, fontWeight: '600', lineHeight: 17, marginTop: -6 },
  addBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(204,255,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTxt: { color: LIME, fontSize: 14, fontWeight: '900' },
}));
