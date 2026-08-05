import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { geocodeAddress } from '../../src/hooks/places';
import { usePassengerTrips } from '../../src/hooks/passenger';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { RIDE_TYPE_LABELS, type TripStatus } from '../../src/domain/types';

const RADIUS_OPTIONS = [2, 3, 5] as const;
type PlaceCategory = 'home' | 'work' | 'other';
type Tab = 'routes' | 'history' | 'places';

interface GeoPoint { lat: number; lng: number; address: string; }
interface DailyRoute {
  id: string;
  label: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  radiusKm: number;
  time: string; // HH:MM
  notify: boolean;
  createdAt: Timestamp | null;
}

interface SavedPlace {
  id: string;
  category: PlaceCategory;
  label: string;
  address: string;
  createdAt: Timestamp | null;
}

const CATEGORIES: { key: PlaceCategory; icon: string; color: string; label: string }[] = [
  { key: 'home',  icon: '🏠', color: '#3b82f6', label: 'Home'  },
  { key: 'work',  icon: '💼', color: '#f59e0b', label: 'Work'  },
  { key: 'other', icon: '📍', color: colors.primary, label: 'Other' },
];

const DEFAULT_PLACE_LABELS: Record<PlaceCategory, string> = {
  home:  'Home',
  work:  'Work',
  other: 'Saved Place',
};

const STATUS_META: Record<TripStatus, { label: string; color: string }> = {
  requested: { label: 'Finding driver', color: '#ccff00' },
  matched: { label: 'Driver assigned', color: '#ccff00' },
  arriving: { label: 'On the way', color: '#ccff00' },
  arrived: { label: 'Driver arrived', color: '#ccff00' },
  in_progress: { label: 'In progress', color: '#ccff00' },
  completed: { label: 'Completed', color: '#10b981' },
  cancelled: { label: 'Cancelled', color: '#ef4444' },
  merged: { label: 'Moved to shared ride', color: '#ccff00' },
};

function fmtTime(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function DailyRoutesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { trips, loading: tripsLoading } = usePassengerTrips(user?.uid);

  const [tab, setTab] = useState<Tab>('routes');
  const [routes, setRoutes] = useState<DailyRoute[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  // Routes editor modal state
  const [showRoutesModal, setShowRoutesModal] = useState(false);
  const [editTarget, setEditTarget] = useState<DailyRoute | null>(null);
  const [label, setLabel] = useState('');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [hour, setHour] = useState(8);
  const [minute, setMinute] = useState(30);
  const [radiusKm, setRadiusKm] = useState<number>(3);
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<GeoPoint | null>(null);

  // Places editor modal state
  const [showPlacesModal, setShowPlacesModal] = useState(false);
  const [editPlace, setEditPlace] = useState<SavedPlace | null>(null);
  const [placeCategory, setPlaceCategory] = useState<PlaceCategory>('other');
  const [placeLabel, setPlaceLabel] = useState('');
  const [placeAddress, setPlaceAddress] = useState('');
  const [savingPlace, setSavingPlace] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, 'users', user.uid, 'dailyRoutes'), orderBy('time', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRoutes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRoute)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'users', user.uid, 'savedPlaces'),
      orderBy('createdAt', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setPlaces(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedPlace)));
    });
    return unsub;
  }, [user?.uid]);

  function openAdd() {
    setEditTarget(null);
    setLabel('');
    setPickup('');
    setDropoff('');
    setHour(8);
    setMinute(30);
    setRadiusKm(3);
    setNotify(true);
    setPickupCoords(null);
    setDropoffCoords(null);
    setShowRoutesModal(true);
  }

  function openEdit(r: DailyRoute) {
    setEditTarget(r);
    setLabel(r.label ?? '');
    setPickup(r.pickup.address);
    setDropoff(r.dropoff.address);
    const parts = (r.time ?? '08:30').split(':');
    const h = parseInt(parts[0] ?? '8', 10);
    const m = parseInt(parts[1] ?? '30', 10);
    setHour(Number.isFinite(h) ? h : 8);
    setMinute(Number.isFinite(m) ? m : 30);
    setRadiusKm(r.radiusKm ?? 3);
    setNotify(r.notify ?? true);
    setPickupCoords(r.pickup);
    setDropoffCoords(r.dropoff);
    setShowRoutesModal(true);
  }

  async function resolve(address: string, cached: GeoPoint | null): Promise<GeoPoint | null> {
    if (cached && address.trim() === cached.address.trim()) return { ...cached, address: address.trim() };
    const geo = await geocodeAddress(address);
    return geo ? { lat: geo.lat, lng: geo.lng, address: address.trim() } : null;
  }

  async function save() {
    if (!user?.uid) return;
    if (!pickup.trim()) { Alert.alert('Pickup needed', 'Enter where this route starts.'); return; }
    if (!dropoff.trim()) { Alert.alert('Destination needed', 'Enter where this route ends.'); return; }

    setSaving(true);
    try {
      const [p, d] = await Promise.all([
        resolve(pickup, pickupCoords),
        resolve(dropoff, dropoffCoords),
      ]);
      if (!p) { Alert.alert('Could not find pickup', 'Try a more specific address or landmark.'); return; }
      if (!d) { Alert.alert('Could not find destination', 'Try a more specific address or landmark.'); return; }

      const payload = {
        label: label.trim() || 'Daily route',
        pickup: p,
        dropoff: d,
        radiusKm,
        time: fmtTime(hour, minute),
        notify,
        updatedAt: serverTimestamp(),
      };

      if (editTarget) {
        await updateDoc(doc(db, 'users', user.uid, 'dailyRoutes', editTarget.id), payload);
      } else {
        await addDoc(collection(db, 'users', user.uid, 'dailyRoutes'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setShowRoutesModal(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function remove(r: DailyRoute) {
    if (!user?.uid) return;
    Alert.alert('Delete route?', `Remove "${r.label}"? You'll stop getting pool alerts for it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'users', user.uid!, 'dailyRoutes', r.id));
          } catch {
            Alert.alert('Error', 'Could not delete the route. Please try again.');
          }
        },
      },
    ]);
  }

  function openAddPlace() {
    setEditPlace(null);
    setPlaceCategory('other');
    setPlaceLabel('');
    setPlaceAddress('');
    setShowPlacesModal(true);
  }

  function openEditPlace(place: SavedPlace) {
    setEditPlace(place);
    setPlaceCategory(place.category);
    setPlaceLabel(place.label);
    setPlaceAddress(place.address);
    setShowPlacesModal(true);
  }

  async function savePlace() {
    if (!placeAddress.trim()) { Alert.alert('Missing', 'Enter an address.'); return; }
    if (!user?.uid) return;

    setSavingPlace(true);
    const finalLabel = placeLabel.trim() || DEFAULT_PLACE_LABELS[placeCategory];
    try {
      if (editPlace) {
        await updateDoc(doc(db, 'users', user.uid, 'savedPlaces', editPlace.id), {
          category: placeCategory,
          label:   finalLabel,
          address: placeAddress.trim(),
        });
      } else {
        await addDoc(collection(db, 'users', user.uid, 'savedPlaces'), {
          category: placeCategory,
          label:     finalLabel,
          address:   placeAddress.trim(),
          createdAt: Timestamp.now(),
        });
      }
      setShowPlacesModal(false);
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to save place.');
    } finally {
      setSavingPlace(false);
    }
  }

  async function deletePlace(place: SavedPlace) {
    if (!user?.uid) return;
    Alert.alert(
      'Delete Place',
      `Remove "${place.label}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'users', user.uid!, 'savedPlaces', place.id));
            } catch {
              Alert.alert('Error', 'Failed to delete place.');
            }
          },
        },
      ],
    );
  }

  const isLoading = tab === 'history' ? tripsLoading : loading;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>My routes</Text>
        {tab === 'routes' && (
          <Pressable style={styles.addBtn} onPress={openAdd} hitSlop={8}>
            <Text style={styles.addBtnTxt}>+ Add</Text>
          </Pressable>
        )}
        {tab === 'places' && (
          <Pressable style={styles.addBtn} onPress={openAddPlace} hitSlop={8}>
            <Text style={styles.addBtnTxt}>+ Add</Text>
          </Pressable>
        )}
        {tab === 'history' && <View style={{ width: 40 }} />}
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, tab === 'routes' && styles.tabActive]}
          onPress={() => setTab('routes')}
        >
          <Text style={[styles.tabText, tab === 'routes' && styles.tabTextActive]}>Routes</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'history' && styles.tabActive]}
          onPress={() => setTab('history')}
        >
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>History</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'places' && styles.tabActive]}
          onPress={() => setTab('places')}
        >
          <Text style={[styles.tabText, tab === 'places' && styles.tabTextActive]}>Saved places</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {tab === 'routes' && (
            <>
              <Text style={styles.intro}>
                Save the commutes you take often. When someone opens a public pool going the same way,
                around the same time, we'll nudge you to join and split the fare — always your choice.
              </Text>

              {routes.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🛣️</Text>
                  <Text style={styles.emptyTitle}>No routes yet</Text>
                  <Text style={styles.emptyDesc}>
                    Add your daily commute and get alerted whenever a matching pool opens near your time.
                  </Text>
                  <Pressable style={styles.emptyBtn} onPress={openAdd}>
                    <Text style={styles.emptyBtnTxt}>Add your first route</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {routes.map((r) => (
                    <View key={r.id} style={styles.routeCard}>
                      <View style={styles.routeTopRow}>
                        <Text style={styles.routeLabel} numberOfLines={1}>{r.label}</Text>
                        <View style={[styles.timePill, !r.notify && styles.timePillMuted]}>
                          <Text style={[styles.timePillTxt, !r.notify && styles.timePillTxtMuted]}>
                            {r.notify ? `🕒 ${r.time}` : 'Alerts off'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.legRow}>
                        <View style={[styles.legDot, { backgroundColor: colors.primary }]} />
                        <Text style={styles.legTxt} numberOfLines={1}>{r.pickup.address}</Text>
                      </View>
                      <View style={styles.legRow}>
                        <View style={[styles.legDot, { backgroundColor: colors.muted }]} />
                        <Text style={styles.legTxt} numberOfLines={1}>{r.dropoff.address}</Text>
                      </View>

                      <View style={styles.routeMetaRow}>
                        <Text style={styles.routeMeta}>Within {r.radiusKm} km</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pressable style={styles.editBtn} onPress={() => openEdit(r)} hitSlop={8}>
                            <Text style={styles.editBtnTxt}>Edit</Text>
                          </Pressable>
                          <Pressable style={styles.deleteBtn} onPress={() => remove(r)} hitSlop={8}>
                            <Text style={styles.deleteBtnTxt}>✕</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  ))}

                  <Pressable style={styles.addMoreBtn} onPress={openAdd}>
                    <Text style={styles.addMoreTxt}>+ Add another route</Text>
                  </Pressable>
                </>
              )}
            </>
          )}

          {tab === 'history' && (
            <>
              {trips.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🛺</Text>
                  <Text style={styles.emptyTitle}>No rides yet</Text>
                  <Text style={styles.emptyDesc}>Your trips will show up here once you book one.</Text>
                  <Pressable style={styles.emptyBtn} onPress={() => router.replace('/passenger/home')}>
                    <Text style={styles.emptyBtnTxt}>Book a ride</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.tripsList}>
                  {trips.map((t) => {
                    const meta = STATUS_META[t.status];
                    return (
                      <Pressable key={t.id} style={styles.tripCard} onPress={() => router.push(`/passenger/trip/${t.id}`)}>
                        <View style={styles.tripTop}>
                          <Text style={styles.rideType}>{RIDE_TYPE_LABELS[t.rideType]}</Text>
                          <View style={[styles.statusPill, { borderColor: meta.color }]}>
                            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                          </View>
                        </View>
                        <View style={styles.routeRow}>
                          <Text style={styles.routeDot}>👤</Text>
                          <Text style={styles.routeText} numberOfLines={1}>
                            {t.pickup?.address ?? 'Pickup'}
                          </Text>
                        </View>
                        <View style={styles.routeRow}>
                          <Text style={styles.routeDot}>🏁</Text>
                          <Text style={styles.routeText} numberOfLines={1}>
                            {t.dropoff?.address ?? 'Drop-off'}
                          </Text>
                        </View>
                        <View style={styles.tripBottom}>
                          <Text style={styles.fare}>{t.fare ?? t.offeredFare} PKR</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {tab === 'places' && (
            <>
              <Text style={styles.intro}>
                Save your frequently visited places — home, work, or anywhere else. Quick access when booking a ride.
              </Text>

              {places.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>📍</Text>
                  <Text style={styles.emptyTitle}>No saved places yet</Text>
                  <Text style={styles.emptyDesc}>
                    Add your home, work, or other favorite locations for quick access.
                  </Text>
                  <Pressable style={styles.emptyBtn} onPress={openAddPlace}>
                    <Text style={styles.emptyBtnTxt}>Add your first place</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {places.map((place) => {
                    const cat = CATEGORIES.find(c => c.key === place.category);
                    return (
                      <View key={place.id} style={styles.placeCard}>
                        <View style={styles.placeTop}>
                          <View style={{ flex: 1 }}>
                            <View style={styles.placeIconRow}>
                              <Text style={styles.placeIcon}>{cat?.icon}</Text>
                              <Text style={styles.placeLabel}>{place.label}</Text>
                            </View>
                            <Text style={styles.placeAddress} numberOfLines={2}>{place.address}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Pressable style={styles.editBtn} onPress={() => openEditPlace(place)} hitSlop={8}>
                              <Text style={styles.editBtnTxt}>Edit</Text>
                            </Pressable>
                            <Pressable style={styles.deleteBtn} onPress={() => deletePlace(place)} hitSlop={8}>
                              <Text style={styles.deleteBtnTxt}>✕</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    );
                  })}

                  <Pressable style={styles.addMoreBtn} onPress={openAddPlace}>
                    <Text style={styles.addMoreTxt}>+ Add another place</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </ScrollView>
      )}

      <Modal visible={showRoutesModal} transparent animationType="slide" onRequestClose={() => setShowRoutesModal(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowRoutesModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{editTarget ? 'Edit route' : 'Add route'}</Text>

              <Text style={styles.fieldLabel}>NAME</Text>
              <TextInput
                style={styles.fieldInput}
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. Morning to office"
                placeholderTextColor={colors.muted}
                maxLength={50}
              />

              <Text style={styles.fieldLabel}>PICKUP AREA</Text>
              <TextInput
                style={styles.fieldInput}
                value={pickup}
                onChangeText={setPickup}
                placeholder="Where you set off from"
                placeholderTextColor={colors.muted}
                maxLength={200}
              />

              <Text style={styles.fieldLabel}>DROP-OFF AREA</Text>
              <TextInput
                style={styles.fieldInput}
                value={dropoff}
                onChangeText={setDropoff}
                placeholder="Where you're heading"
                placeholderTextColor={colors.muted}
                maxLength={200}
              />

              <Text style={styles.fieldLabel}>TIME</Text>
              <Text style={styles.fieldHint}>We'll alert you about pools opened around this time.</Text>
              <View style={styles.timeRow}>
                <View style={styles.stepper}>
                  <Pressable style={styles.stepBtn} onPress={() => setHour((h) => (h + 23) % 24)}>
                    <Text style={styles.stepBtnTxt}>−</Text>
                  </Pressable>
                  <Text style={styles.stepVal}>{String(hour).padStart(2, '0')}</Text>
                  <Pressable style={styles.stepBtn} onPress={() => setHour((h) => (h + 1) % 24)}>
                    <Text style={styles.stepBtnTxt}>+</Text>
                  </Pressable>
                </View>
                <Text style={styles.colon}>:</Text>
                <View style={styles.stepper}>
                  <Pressable style={styles.stepBtn} onPress={() => setMinute((m) => (m + 45) % 60)}>
                    <Text style={styles.stepBtnTxt}>−</Text>
                  </Pressable>
                  <Text style={styles.stepVal}>{String(minute).padStart(2, '0')}</Text>
                  <Pressable style={styles.stepBtn} onPress={() => setMinute((m) => (m + 15) % 60)}>
                    <Text style={styles.stepBtnTxt}>+</Text>
                  </Pressable>
                </View>
              </View>

              <Text style={styles.fieldLabel}>MATCH RADIUS</Text>
              <View style={styles.radiusRow}>
                {RADIUS_OPTIONS.map((km) => (
                  <Pressable
                    key={km}
                    style={[styles.radiusChip, radiusKm === km && styles.radiusChipActive]}
                    onPress={() => setRadiusKm(km)}
                  >
                    <Text style={[styles.radiusChipTxt, radiusKm === km && styles.radiusChipTxtActive]}>{km} km</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Notify me about matching pools</Text>
                  <Text style={styles.toggleSub}>Push alert when a pool opens on this route</Text>
                </View>
                <Switch
                  value={notify}
                  onValueChange={setNotify}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>

              <Pressable style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#000" /> : <Text style={styles.saveBtnTxt}>{editTarget ? 'Save changes' : 'Add route'}</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showPlacesModal} transparent animationType="slide" onRequestClose={() => setShowPlacesModal(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowPlacesModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{editPlace ? 'Edit place' : 'Add place'}</Text>

              <Text style={styles.fieldLabel}>CATEGORY</Text>
              <View style={styles.categoryRow}>
                {CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat.key}
                    style={[styles.categoryChip, placeCategory === cat.key && styles.categoryChipActive]}
                    onPress={() => setPlaceCategory(cat.key)}
                  >
                    <Text style={styles.categoryIcon}>{cat.icon}</Text>
                    <Text style={[styles.categoryLabel, placeCategory === cat.key && styles.categoryLabelActive]}>
                      {cat.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>LABEL</Text>
              <TextInput
                style={styles.fieldInput}
                value={placeLabel}
                onChangeText={setPlaceLabel}
                placeholder="e.g. My home"
                placeholderTextColor={colors.muted}
                maxLength={50}
              />

              <Text style={styles.fieldLabel}>ADDRESS</Text>
              <TextInput
                style={styles.fieldInput}
                value={placeAddress}
                onChangeText={setPlaceAddress}
                placeholder="Full address"
                placeholderTextColor={colors.muted}
                maxLength={200}
              />

              <Pressable style={[styles.saveBtn, savingPlace && { opacity: 0.5 }]} onPress={savePlace} disabled={savingPlace}>
                {savingPlace ? <ActivityIndicator color="#000" /> : <Text style={styles.saveBtnTxt}>{editPlace ? 'Save changes' : 'Add place'}</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40 },
  backTxt: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  addBtn: { backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6 },
  addBtnTxt: { fontSize: 13, fontWeight: '900', color: '#000' },

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    alignItems: 'center',
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  tabTextActive: { color: colors.primary, fontWeight: '800' },

  content: { padding: 16, gap: 10, paddingBottom: 40 },
  intro: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 4 },

  emptyState: { alignItems: 'center', paddingTop: 50, paddingHorizontal: 32, gap: 12 },
  emptyIcon: { fontSize: 52 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptyDesc: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { height: 50, backgroundColor: colors.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, marginTop: 8 },
  emptyBtnTxt: { fontSize: 15, fontWeight: '900', color: '#000' },

  routeCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  routeTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  routeLabel: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  timePill: { backgroundColor: colors.primary + '20', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  timePillMuted: { backgroundColor: colors.border },
  timePillTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },
  timePillTxtMuted: { color: colors.muted },

  legRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legDot: { width: 8, height: 8, borderRadius: 4 },
  legTxt: { flex: 1, fontSize: 13, color: colors.text },

  routeMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  routeMeta: { fontSize: 12, color: colors.muted },
  editBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  editBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  deleteBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: colors.danger + '40' },
  deleteBtnTxt: { fontSize: 12, fontWeight: '900', color: colors.danger },

  addMoreBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  addMoreTxt: { fontSize: 14, fontWeight: '700', color: colors.muted },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    maxHeight: '88%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 20,
    paddingBottom: 34,
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 },

  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginTop: 12 },
  fieldHint: { fontSize: 11, color: colors.muted, marginTop: 2 },
  fieldInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
    marginTop: 6,
  },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt: { fontSize: 22, color: colors.primary, fontWeight: '800' },
  stepVal: { fontSize: 18, fontWeight: '900', color: colors.text, minWidth: 34, textAlign: 'center' },
  colon: { fontSize: 20, fontWeight: '900', color: colors.text },

  radiusRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  radiusChip: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  radiusChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
  radiusChipTxt: { fontSize: 13, fontWeight: '700', color: colors.muted },
  radiusChipTxtActive: { color: colors.primary },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 14,
  },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  toggleSub: { fontSize: 11, color: colors.muted, marginTop: 2 },

  saveBtn: { height: 52, backgroundColor: colors.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  saveBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },

  // History/Trips styles
  tripsList: { gap: 12 },
  tripCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  tripTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rideType: { fontSize: 16, fontWeight: '800', color: colors.text },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '800' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDot: { fontSize: 13 },
  routeText: { flex: 1, fontSize: 13, color: colors.muted },
  tripBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  fare: { fontSize: 16, fontWeight: '900', color: colors.primary },

  // Saved Places styles
  placeCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  placeTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  placeIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  placeIcon: { fontSize: 20 },
  placeLabel: { fontSize: 15, fontWeight: '800', color: colors.text, flex: 1 },
  placeAddress: { fontSize: 13, color: colors.muted },

  categoryRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  categoryChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
  categoryIcon: { fontSize: 22, marginBottom: 4 },
  categoryLabel: { fontSize: 12, fontWeight: '600', color: colors.muted },
  categoryLabelActive: { color: colors.primary, fontWeight: '700' },
}));
