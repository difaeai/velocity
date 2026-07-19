/**
 * Full-screen incoming request feed (the "see all" view of the driver home).
 *
 * Same card, same swipe actions and same "show new requests" behaviour as the
 * home feed — the two lists are the same product surface at different sizes,
 * so they must not drift apart.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, type ReportReason } from '../../src/api/client';
import { useOpenRequests, type OpenRequest } from '../../src/hooks/driver';
import { useCurrentLocation } from '../../src/hooks/location';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { RequestCard } from '../../src/ui/RequestCard';
import { ReportRequestModal } from '../../src/ui/ReportRequestModal';

const SKIP_KEY = 'driver_skipped_requests';
const SKIP_TTL = 60 * 60 * 1000;

export default function AllRequestsScreen() {
  const router = useRouter();
  const { coords } = useCurrentLocation();
  const liveRequests = useOpenRequests(true, coords?.lat, coords?.lng);

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reportTripId, setReportTripId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const listRef = useRef<FlatList<OpenRequest>>(null);

  // Same persisted hide list the home feed uses — hiding a request in one place
  // must hide it in the other.
  useEffect(() => {
    AsyncStorage.getItem(SKIP_KEY).then((raw) => {
      if (!raw) return;
      try {
        const entries: { id: string; at: number }[] = JSON.parse(raw);
        const now = Date.now();
        setHiddenIds(new Set(entries.filter((e) => now - e.at < SKIP_TTL).map((e) => e.id)));
      } catch { /* corrupted data — start fresh */ }
    });
  }, []);

  const hideRequest = useCallback((tripId: string) => {
    setHiddenIds((prev) => new Set([...prev, tripId]));
    AsyncStorage.getItem(SKIP_KEY).then((raw) => {
      const existing: { id: string; at: number }[] = raw ? JSON.parse(raw) : [];
      const updated = [...existing.filter((e) => e.id !== tripId), { id: tripId, at: Date.now() }];
      AsyncStorage.setItem(SKIP_KEY, JSON.stringify(updated));
    }).catch(() => {});
  }, []);

  const visible = useMemo(
    () => liveRequests.filter((r) => !hiddenIds.has(r.tripId)),
    [liveRequests, hiddenIds],
  );

  // Frozen snapshot — new arrivals queue behind the pill instead of reflowing
  // the list while the driver is reading it.
  const [shown, setShown] = useState<OpenRequest[]>([]);
  useEffect(() => {
    setShown((prev) => {
      if (prev.length === 0) return visible;
      const live = new Map(visible.map((r) => [r.tripId, r]));
      return prev.flatMap((r) => {
        const fresh = live.get(r.tripId);
        return fresh ? [fresh] : [];
      });
    });
  }, [visible]);

  const shownIds = useMemo(() => new Set(shown.map((r) => r.tripId)), [shown]);
  const pendingCount = useMemo(
    () => visible.filter((r) => !shownIds.has(r.tripId)).length,
    [visible, shownIds],
  );

  const showNewRequests = () => {
    setShown(visible);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  async function submitReport(reasons: ReportReason[], description: string) {
    if (!reportTripId) return;
    setReporting(true);
    setReportError(null);
    try {
      const res = await api.reportOpenRequest({
        tripId: reportTripId,
        reasons,
        ...(description ? { description } : {}),
      });
      hideRequest(reportTripId);
      setReportTripId(null);
      Alert.alert(
        res.alreadyReported ? 'Already reported' : 'Report sent',
        res.alreadyReported
          ? 'You have already reported this request. Our team is reviewing it.'
          : 'Thank you. Our team will review this request.',
      );
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Could not send the report. Please try again.');
    } finally {
      setReporting(false);
    }
  }

  const openRequest = (tripId: string) =>
    router.push(`/driver/request-detail/${tripId}` as Parameters<typeof router.push>[0]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          Ride requests {shown.length > 0 ? `(${shown.length})` : ''}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.flex}>
        <FlatList
          ref={listRef}
          data={shown}
          keyExtractor={(r) => r.tripId}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No open requests</Text>
              <Text style={styles.emptyText}>
                Nothing nearby right now, or everything has been hidden. New requests appear here automatically.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <RequestCard
              request={item}
              expanded={expandedId === item.tripId}
              onToggleActions={() =>
                setExpandedId((cur) => (cur === item.tripId ? null : item.tripId))
              }
              onOpen={() => openRequest(item.tripId)}
              onComplain={() => {
                setExpandedId(null);
                setReportError(null);
                setReportTripId(item.tripId);
              }}
              onHide={() => {
                setExpandedId(null);
                hideRequest(item.tripId);
              }}
              onChooseOnMap={() => {
                setExpandedId(null);
                openRequest(item.tripId);
              }}
            />
          )}
        />

        {pendingCount > 0 && (
          <View style={styles.pillWrap} pointerEvents="box-none">
            <Pressable style={styles.pill} onPress={showNewRequests}>
              <Text style={styles.pillTxt}>
                ↑  Show new request{pendingCount === 1 ? '' : 's'}
                {pendingCount > 1 ? `  (${pendingCount})` : ''}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <ReportRequestModal
        visible={reportTripId !== null}
        submitting={reporting}
        error={reportError}
        onClose={() => { setReportTripId(null); setReportError(null); }}
        onSubmit={submitReport}
      />
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn:     { width: 40 },
  backArrow:   { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  empty:      { paddingTop: 60, alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  emptyText:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  pillWrap: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  pill: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 13,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  pillTxt: { fontSize: 15, fontWeight: '700', color: '#111' },
}));
