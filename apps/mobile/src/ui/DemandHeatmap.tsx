/**
 * Demand heatmap — shows request density as colour tiles on a canvas grid.
 * Reads from the `openRequests` collection using pickupGeohash precision-4
 * (~40 km cells) to bucket requests into grid squares.
 *
 * The canvas is sized to the component's natural bounds; each tile is painted
 * lime→amber→red depending on density.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '../firebase';
import { colors } from '../config';

interface HeatRequest {
  id: string;
  pickupGeohash?: string;
  pickup?: { lat?: number; lng?: number };
}

// Pakistan bounding box — same as admin map
const LAT_MIN = 23.5, LAT_MAX = 37.5;
const LNG_MIN = 60.5, LNG_MAX = 77.5;
const GRID_COLS = 20;
const GRID_ROWS = 14;

function latToRow(lat: number) {
  return Math.floor(((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * GRID_ROWS);
}
function lngToCol(lng: number) {
  return Math.floor(((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * GRID_COLS);
}

function heatColor(count: number, max: number): string {
  if (count === 0) return 'transparent';
  const ratio = count / max;
  // lime → amber → red
  if (ratio < 0.4) return `rgba(204,255,0,${0.3 + ratio * 0.5})`;
  if (ratio < 0.7) return `rgba(245,158,11,${0.4 + ratio * 0.4})`;
  return `rgba(239,68,68,${0.5 + ratio * 0.3})`;
}

export function DemandHeatmap() {
  const canvasRef = useRef<{ width: number; height: number } | null>(null);
  const [requests, setRequests] = useState<HeatRequest[]>([]);
  const [grid, setGrid]         = useState<number[][]>([]);
  const [maxCount, setMaxCount] = useState(1);
  const [totalOpen, setTotalOpen] = useState(0);

  // Subscribe to openRequests
  useEffect(() => {
    return onSnapshot(collection(db, 'openRequests'), snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as HeatRequest);
      setRequests(rows);
    });
  }, []);

  // Build grid whenever requests change
  useEffect(() => {
    const g: number[][] = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0));
    let max = 0;
    let total = 0;
    requests.forEach(r => {
      const lat = r.pickup?.lat;
      const lng = r.pickup?.lng;
      if (lat === undefined || lng === undefined) return;
      const row = latToRow(lat);
      const col = lngToCol(lng);
      if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
        (g[row] as number[])[col] = ((g[row] as number[])[col] as number) + 1;
        const cellVal = (g[row] as number[])[col] as number;
        if (cellVal > max) max = cellVal;
        total++;
      }
    });
    setGrid(g);
    setMaxCount(Math.max(max, 1));
    setTotalOpen(total);
  }, [requests]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>🔥 Demand Map</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{totalOpen} open</Text>
        </View>
      </View>

      {/* Grid */}
      <View style={styles.grid}>
        {grid.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((count, ci) => (
              <View
                key={ci}
                style={[
                  styles.cell,
                  count > 0 && { backgroundColor: heatColor(count, maxCount) },
                ]}
              />
            ))}
          </View>
        ))}

        {/* Pakistan outline label */}
        <View style={styles.label}>
          <Text style={styles.labelText}>Pakistan</Text>
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <LegendDot color="rgba(204,255,0,0.7)" label="Low demand" />
        <LegendDot color="rgba(245,158,11,0.8)" label="Medium" />
        <LegendDot color="rgba(239,68,68,0.9)" label="High demand" />
      </View>

      {totalOpen === 0 && (
        <Text style={styles.emptyText}>No open requests right now. Try a busier area.</Text>
      )}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:  { fontSize: 14, fontWeight: '900', color: colors.text },
  badge:  { backgroundColor: `${colors.primary}22`, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },

  grid:   { borderRadius: 10, overflow: 'hidden', backgroundColor: '#0f1117', borderWidth: 1, borderColor: colors.border },
  row:    { flexDirection: 'row' },
  cell:   { flex: 1, aspectRatio: 1.2, borderWidth: 0.5, borderColor: '#1e2030' },

  label:  { position: 'absolute', bottom: 6, left: 8 },
  labelText: { color: '#ffffff22', fontSize: 10, fontWeight: '700' },

  legend:      { flexDirection: 'row', gap: 14 },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:   { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11, color: colors.muted },

  emptyText: { fontSize: 12, color: colors.muted, textAlign: 'center', paddingVertical: 4 },
});
