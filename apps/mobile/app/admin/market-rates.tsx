/**
 * Market rates, on a phone.
 *
 * The full desk lives on the web dashboard; this is the half of it that is
 * genuinely useful in the field — where we stand against inDrive and Yango
 * right now, and the ability to enter a card the moment somebody has finished
 * checking a competitor's app on the phone in their other hand.
 *
 * Nothing here imports or scrapes a price. Every card is a number a person
 * observed, and a class with no fresh card shows riders no comparison at all.
 * See src/lib/marketRates.ts for why that is the only defensible design.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { api } from '../../src/api/client';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import type { VehicleCategory } from '../../src/lib/fareEngine';
import {
  CityMarketRates, Competitor, CompetitorCategoryRates,
  MarketComparison, MarketComparisonSettings, RateSource,
  COMPETITOR_LABELS, DEFAULT_MARKET_SETTINGS, RATE_SOURCE_LABELS,
} from '../../src/lib/marketRates';

const CITIES = [
  { id: 'islamabad_rawalpindi', label: 'Islamabad / Rawalpindi' },
  { id: 'karachi', label: 'Karachi' },
];

const CATEGORIES: { key: VehicleCategory; label: string; icon: string }[] = [
  { key: 'moto', label: 'Moto', icon: '🏍️' },
  { key: 'rickshaw', label: 'Rickshaw', icon: '🛺' },
  { key: 'mini', label: 'Mini', icon: '🚗' },
  { key: 'ac_car', label: 'AC Car', icon: '❄️' },
  { key: 'luxury', label: 'Luxury', icon: '⭐' },
];

const COMPETITORS: Competitor[] = ['indrive', 'yango'];
const SOURCES: RateSource[] = ['ops_survey', 'rider_reports', 'published'];
const DAY = 24 * 60 * 60 * 1000;

type PositionRow = MarketComparison & { category: VehicleCategory };

interface Draft {
  base: string;
  perKm: string;
  perMin: string;
  minFare: string;
  includedKm: string;
  includedMin: string;
  sampleSize: string;
  competitorClass: string;
  source: RateSource;
  note: string;
}

const EMPTY_DRAFT: Draft = {
  base: '0', perKm: '0', perMin: '0', minFare: '0',
  includedKm: '0', includedMin: '0', sampleSize: '1',
  competitorClass: '', source: 'ops_survey', note: '',
};

function draftFrom(card: CompetitorCategoryRates | undefined): Draft {
  if (!card) return { ...EMPTY_DRAFT };
  return {
    base: String(card.base),
    perKm: String(card.perKm),
    perMin: String(card.perMin),
    minFare: String(card.minFare),
    includedKm: String(card.includedKm),
    includedMin: String(card.includedMin),
    sampleSize: String(card.sampleSize),
    competitorClass: card.competitorClass,
    source: card.source,
    note: card.note ?? '',
  };
}

function ageLabel(verifiedAt: number): string {
  const days = Math.floor((Date.now() - verifiedAt) / DAY);
  if (days <= 0) return 'checked today';
  if (days === 1) return 'checked yesterday';
  return `checked ${days} days ago`;
}

function Field({
  label, value, onChange, numeric = true,
}: {
  label: string; value: string; onChange: (v: string) => void; numeric?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={(t) => onChange(numeric ? t.replace(/[^0-9.]/g, '') : t)}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        selectTextOnFocus
      />
    </View>
  );
}

export default function MarketRates() {
  const router = useRouter();
  const [cityIdx, setCityIdx] = useState(0);
  const city = CITIES[cityIdx]!;

  const [rates, setRates] = useState<CityMarketRates | null>(null);
  const [settings, setSettings] = useState<MarketComparisonSettings>(DEFAULT_MARKET_SETTINGS);
  const [position, setPosition] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Which card is open, as "competitor:category".
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  /**
   * Everything this screen shows, fetched without touching state. Keeping the
   * fetch pure is what lets the effect below drop a response that arrived after
   * the admin already switched city — and it keeps every setState on the far
   * side of an await, where a render cascade cannot start.
   */
  const fetchAll = useCallback(async (id: string) => {
    const [ratesSnap, settingsSnap] = await Promise.all([
      getDoc(doc(db, 'marketRates', id)),
      getDoc(doc(db, 'config', 'marketComparison')),
    ]);
    let rows: PositionRow[] = [];
    try {
      const pos = await api.adminMarketPosition({ cityId: id });
      rows = pos.rows as PositionRow[];
    } catch {
      // A city with no fare config cannot be positioned. That is a fare-engine
      // gap, not a market one, and the cards below are still worth showing.
      rows = [];
    }
    return {
      rates: ratesSnap.exists() ? (ratesSnap.data() as CityMarketRates) : null,
      settings: settingsSnap.exists()
        ? { ...DEFAULT_MARKET_SETTINGS, ...(settingsSnap.data() as Partial<MarketComparisonSettings>) }
        : DEFAULT_MARKET_SETTINGS,
      rows,
    };
  }, []);

  const apply = useCallback((data: Awaited<ReturnType<typeof fetchAll>>) => {
    setRates(data.rates);
    setSettings(data.settings);
    setPosition(data.rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchAll(city.id)
      .then((data) => { if (alive) apply(data); })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [city.id, fetchAll, apply]);

  /** Re-read after a write. Called from handlers, never from an effect. */
  const load = useCallback(async () => {
    apply(await fetchAll(city.id));
  }, [city.id, fetchAll, apply]);

  async function saveCard(competitor: Competitor, category: VehicleCategory) {
    if (!draft.competitorClass.trim()) {
      Alert.alert(
        'Which of their tiers?',
        'Record the name they use for it — "Economy", "City", and so on. A card without it cannot be checked by anyone else.',
      );
      return;
    }
    setSaving(true);
    try {
      await api.adminUpsertMarketRates({
        cityId: city.id,
        competitor,
        category,
        rates: {
          base: Number(draft.base) || 0,
          perKm: Number(draft.perKm) || 0,
          perMin: Number(draft.perMin) || 0,
          minFare: Number(draft.minFare) || 0,
          includedKm: Number(draft.includedKm) || 0,
          includedMin: Number(draft.includedMin) || 0,
          sampleSize: Number(draft.sampleSize) || 1,
          competitorClass: draft.competitorClass.trim(),
          source: draft.source,
          note: draft.note,
        },
      });
      setEditing(null);
      await load();
    } catch (e) {
      Alert.alert('Could not save', String(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeCard(competitor: Competitor, category: VehicleCategory) {
    Alert.alert(
      'Remove this card?',
      'Riders will see no comparison for this class until a new one is entered.',
      [
        { text: 'Keep it' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await api.adminDeleteMarketRates({ cityId: city.id, competitor, category });
              setEditing(null);
              await load();
            } catch (e) {
              Alert.alert('Could not remove', String(e));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  async function saveUndercut(pct: number) {
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'config', 'marketComparison'),
        { ...settings, undercutPct: pct },
        { merge: true },
      );
      setSettings((s) => ({ ...s, undercutPct: pct }));
      await load();
    } catch (e) {
      Alert.alert('Could not save', String(e));
    } finally {
      setSaving(false);
    }
  }

  const behind = position.filter((r) => r.available && !r.guaranteeMet);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.title}>Market rates</Text>
        <Pressable onPress={load} style={styles.backBtn}>
          <Text style={styles.backTxt}>⟳</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.tabRow}>
          {CITIES.map((c, i) => (
            <Pressable
              key={c.id}
              style={[styles.tab, cityIdx === i && styles.tabOn]}
              onPress={() => { setLoading(true); setCityIdx(i); }}
            >
              <Text style={[styles.tabTxt, cityIdx === i && styles.tabTxtOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.intro}>
          Neither inDrive nor Yango publishes a fare we may read here — inDrive has no fixed price
          at all, and Yango does not disclose per-km rates in Pakistan. Every card below is a quote
          somebody observed. A class with no fresh card shows riders nothing.
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ── Where we stand ── */}
            <Text style={styles.section}>WHERE WE STAND · 8 KM REFERENCE TRIP</Text>

            {behind.length > 0 ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnTxt}>
                  Not {Math.round(settings.undercutPct * 100)}% under the market in{' '}
                  {behind.map((r) => CATEGORIES.find((c) => c.key === r.category)?.label).join(', ')}.
                  The undercut already pulls those fares down to the driver floor and stops there.
                  To go lower, cut the per-km rate or the bid floor in Fare configuration.
                </Text>
                <Pressable
                  style={styles.warnBtn}
                  onPress={() => router.push('/admin/fare-config' as Parameters<typeof router.push>[0])}
                >
                  <Text style={styles.warnBtnTxt}>Open fare configuration</Text>
                </Pressable>
              </View>
            ) : null}

            {position.map((row) => {
              const cat = CATEGORIES.find((c) => c.key === row.category);
              return (
                <View key={row.category} style={styles.posRow}>
                  <Text style={styles.posCat}>{cat?.icon} {cat?.label}</Text>
                  <View style={{ flex: 1 }}>
                    {row.available ? (
                      <Text style={styles.posDetail}>
                        {row.competitors.map((c) => `${c.label} ~${c.fare}`).join(' · ')}
                      </Text>
                    ) : (
                      <Text style={styles.posMuted}>No verified rates — no comparison shown</Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.posFare}>PKR {row.velocityFare.toLocaleString()}</Text>
                    <Text style={row.available && row.guaranteeMet ? styles.posOk : styles.posBad}>
                      {!row.available ? '—' : row.guaranteeMet ? `−${row.savingsPct}%` : 'floor blocked'}
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* ── The undercut ── */}
            <Text style={styles.section}>HOW FAR UNDER THEM WE AIM</Text>
            <View style={styles.pctRow}>
              {[10, 15, 20, 25].map((pct) => {
                const on = Math.round(settings.undercutPct * 100) === pct;
                return (
                  <Pressable
                    key={pct}
                    style={[styles.pct, on && styles.pctOn]}
                    onPress={() => saveUndercut(pct / 100)}
                    disabled={saving}
                  >
                    <Text style={[styles.pctTxt, on && styles.pctTxtOn]}>{pct}%</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* ── Their cards ── */}
            {COMPETITORS.map((competitor) => (
              <View key={competitor}>
                <Text style={styles.section}>{COMPETITOR_LABELS[competitor].toUpperCase()} RATES</Text>
                {CATEGORIES.map((cat) => {
                  const key = `${competitor}:${cat.key}`;
                  const card = rates?.competitors?.[competitor]?.[cat.key];
                  const stale = card ? (Date.now() - card.verifiedAt) / DAY > settings.maxAgeDays : false;
                  const thin = card ? card.sampleSize < settings.minSampleSize : false;
                  const open = editing === key;

                  return (
                    <View key={cat.key} style={styles.cardRow}>
                      <Pressable
                        style={styles.cardHead}
                        onPress={() => {
                          setEditing(open ? null : key);
                          if (!open) setDraft(draftFrom(card));
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardTitle}>
                            {cat.icon} {cat.label}
                            {card ? <Text style={styles.cardTier}>  ·  {card.competitorClass}</Text> : null}
                          </Text>
                          <Text style={card && !stale && !thin ? styles.cardSub : styles.cardSubBad}>
                            {card
                              ? `PKR ${card.base} + ${card.perKm}/km · min ${card.minFare} · ${card.sampleSize} samples · ${ageLabel(card.verifiedAt)}`
                                + (stale ? ' · STALE, hidden' : thin ? ' · TOO FEW SAMPLES, hidden' : '')
                              : 'No card yet'}
                          </Text>
                        </View>
                        <Text style={styles.chev}>{open ? '⌃' : '⌄'}</Text>
                      </Pressable>

                      {open ? (
                        <View style={styles.editor}>
                          <Field
                            label="Their name for this tier"
                            value={draft.competitorClass}
                            onChange={(v) => setDraft({ ...draft, competitorClass: v })}
                            numeric={false}
                          />
                          <View style={styles.fieldGrid}>
                            <Field label="Base PKR" value={draft.base} onChange={(v) => setDraft({ ...draft, base: v })} />
                            <Field label="Per km" value={draft.perKm} onChange={(v) => setDraft({ ...draft, perKm: v })} />
                            <Field label="Per min" value={draft.perMin} onChange={(v) => setDraft({ ...draft, perMin: v })} />
                            <Field label="Min fare" value={draft.minFare} onChange={(v) => setDraft({ ...draft, minFare: v })} />
                            <Field label="Included km" value={draft.includedKm} onChange={(v) => setDraft({ ...draft, includedKm: v })} />
                            <Field label="Included min" value={draft.includedMin} onChange={(v) => setDraft({ ...draft, includedMin: v })} />
                            <Field label="Quotes seen" value={draft.sampleSize} onChange={(v) => setDraft({ ...draft, sampleSize: v })} />
                          </View>

                          <Text style={styles.fieldLabel}>WHERE IT CAME FROM</Text>
                          <View style={styles.srcRow}>
                            {SOURCES.map((s) => (
                              <Pressable
                                key={s}
                                style={[styles.src, draft.source === s && styles.srcOn]}
                                onPress={() => setDraft({ ...draft, source: s })}
                              >
                                <Text style={[styles.srcTxt, draft.source === s && styles.srcTxtOn]}>
                                  {RATE_SOURCE_LABELS[s]}
                                </Text>
                              </Pressable>
                            ))}
                          </View>

                          <Field
                            label="Which routes did you sample?"
                            value={draft.note}
                            onChange={(v) => setDraft({ ...draft, note: v })}
                            numeric={false}
                          />

                          <View style={styles.actions}>
                            <Pressable
                              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                              onPress={() => saveCard(competitor, cat.key)}
                              disabled={saving}
                            >
                              <Text style={styles.saveTxt}>{saving ? 'Saving…' : 'Save card'}</Text>
                            </Pressable>
                            {card ? (
                              <Pressable
                                style={styles.delBtn}
                                onPress={() => removeCard(competitor, cat.key)}
                                disabled={saving}
                              >
                                <Text style={styles.delTxt}>Remove</Text>
                              </Pressable>
                            ) : null}
                          </View>
                          <Text style={styles.editorHint}>
                            Saving stamps today as the date this was last confirmed.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontSize: 20, color: colors.text },
  title: { flex: 1, fontSize: 18, fontWeight: '900', color: colors.text },

  body: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontSize: 12, color: colors.muted, lineHeight: 17 },

  tabRow: { flexDirection: 'row', gap: 8 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  tabTxt: { fontSize: 12, fontWeight: '800', color: colors.muted },
  tabTxtOn: { color: colors.primary },

  section: {
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1,
    color: colors.muted,
    marginTop: 18,
    marginBottom: 4,
  },

  warnBox: {
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: `${colors.danger}18`,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  warnTxt: { fontSize: 12.5, color: colors.text, lineHeight: 18 },
  warnBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  warnBtnTxt: { fontSize: 13, fontWeight: '800', color: colors.danger },

  posRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  posCat: { width: 92, fontSize: 13, fontWeight: '800', color: colors.text },
  posDetail: { fontSize: 11.5, color: colors.muted },
  posMuted: { fontSize: 11.5, color: colors.muted, fontStyle: 'italic' },
  posFare: { fontSize: 15, fontWeight: '900', color: colors.text },
  posOk: { fontSize: 11, fontWeight: '800', color: colors.primary },
  posBad: { fontSize: 11, fontWeight: '800', color: colors.danger },

  pctRow: { flexDirection: 'row', gap: 8 },
  pct: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  pctOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  pctTxt: { fontSize: 14, fontWeight: '900', color: colors.muted },
  pctTxtOn: { color: colors.primary },

  cardRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    marginBottom: 8,
    overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  cardTier: { fontSize: 12, fontWeight: '500', color: colors.muted },
  cardSub: { fontSize: 11, color: colors.muted, marginTop: 3, lineHeight: 15 },
  cardSubBad: { fontSize: 11, color: colors.danger, marginTop: 3, lineHeight: 15 },
  chev: { fontSize: 16, color: colors.muted },

  editor: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 12,
    gap: 10,
    backgroundColor: colors.surface,
  },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: { flexGrow: 1, minWidth: 96, gap: 4 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.primary,
    textTransform: 'uppercase',
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
  },

  srcRow: { gap: 6 },
  src: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  srcOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  srcTxt: { fontSize: 12, fontWeight: '700', color: colors.muted },
  srcTxtOn: { color: colors.primary },

  actions: { flexDirection: 'row', gap: 8 },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveTxt: { fontSize: 14, fontWeight: '900', color: '#000' },
  delBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  delTxt: { fontSize: 14, fontWeight: '800', color: colors.danger },
  editorHint: { fontSize: 11, color: colors.muted },
}));
