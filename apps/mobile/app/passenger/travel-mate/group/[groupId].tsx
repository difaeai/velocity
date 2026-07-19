/**
 * Travel Partner — group screen.
 *
 * Shows group members, shared destination + schedule.
 * "Book a ride" → navigates to passenger home for a normal trip booking.
 * "Settle fare" → opens a sheet to split a completed trip fare equally via
 *   settleTravelMateSplit. The booker enters the fare amount; all other
 *   members' wallet balances are debited their equal share.
 *
 * Shows settlement history for this group (from settlements subcollection).
 * Group creator can share the Group ID so matched members can join via the
 * matches screen.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { Share } from 'react-native';
import { appLink } from '../../../../src/share/links';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../../src/firebase';
import { useAuth } from '../../../../src/auth/AuthContext';
import { api } from '../../../../src/api/client';
import { colors } from '../../../../src/config';
import { themed } from '../../../../src/theme';
import { Card } from '../../../../src/ui/components';

interface Group {
  name: string;
  createdBy: string;
  members: string[];
  maxSize: number;
  memberInfo: Record<string, { displayName: string; photoURL: string | null }>;
  destinationName: string;
  schedule?: { days: string[]; departTime: string };
  status: string;
}

interface Settlement {
  id: string;
  tripId: string;
  bookerUid: string;
  riders: string[];
  fare: number;
  share: number;
  collected: number;
  bookerNetCost: number;
  createdAt?: { seconds: number };
}

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
  fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

export default function TravelMateGroup() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [group, setGroup] = useState<Group | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settleOpen, setSettleOpen] = useState(false);

  // Settle form state
  const [fareInput, setFareInput] = useState('');
  const [tripIdInput, setTripIdInput] = useState('');
  const [selectedRiders, setSelectedRiders] = useState<Record<string, boolean>>({});
  const [settling, setSettling] = useState(false);
  const [settleResult, setSettleResult] = useState<{ fare: number; share: number; bookerNetCost: number } | null>(null);
  const [dmTarget, setDmTarget] = useState<string | null>(null);
  const [openingDm, setOpeningDm] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    return onSnapshot(doc(db, 'travelMateGroups', groupId), snap => {
      if (snap.exists()) {
        const g = snap.data() as Group;
        setGroup(g);
        // Pre-select all members for fare split
        const sel: Record<string, boolean> = {};
        g.members.forEach(uid => { sel[uid] = true; });
        setSelectedRiders(sel);
      }
    });
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    return onSnapshot(
      query(collection(db, 'travelMateGroups', groupId, 'settlements'), orderBy('createdAt', 'desc')),
      snap => setSettlements(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Settlement)),
    );
  }, [groupId]);

  async function settle() {
    const fare = parseFloat(fareInput);
    if (isNaN(fare) || fare <= 0) { Alert.alert('Enter a valid fare amount.'); return; }
    const riders = Object.entries(selectedRiders).filter(([, on]) => on).map(([uid]) => uid);
    if (riders.length < 2) { Alert.alert('Select at least 2 riders.'); return; }
    if (!riders.includes(user!.uid)) { Alert.alert('You must be one of the riders.'); return; }
    const tid = tripIdInput.trim() || `manual-${Date.now()}`;
    setSettling(true);
    try {
      const res = await api.settleTravelMateSplit({
        groupId,
        tripId: tid,
        riderUids: riders,
        amountPKR: fare,
      });
      setSettleResult({ fare: res.fare, share: res.share, bookerNetCost: res.bookerNetCost });
      setFareInput('');
      setTripIdInput('');
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/already-exists') {
        Alert.alert('Already settled', 'This trip has already been settled.');
      } else if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Insufficient balance', 'A rider does not have enough wallet balance for their share.');
      } else {
        Alert.alert('Error', e instanceof Error ? e.message : 'Settlement failed.');
      }
    } finally {
      setSettling(false);
    }
  }

  function closeSettle() {
    setSettleOpen(false);
    setSettleResult(null);
    setFareInput('');
    setTripIdInput('');
  }

  function shareInvite() {
    // Personalise the invite with the sharer's real name so the recipient knows
    // who is inviting them — not a generic "Velocity" / admin identity. Prefer
    // the name stored on the group (what other members see), then the account
    // display name.
    const myName =
      (user && group?.memberInfo[user.uid]?.displayName) || user?.displayName || 'A travel partner';
    const groupLabel = group?.name ? ` "${group.name}"` : '';
    const link = appLink(`/passenger/travel-mate/group-invite/${groupId}`);
    Share.share({
      message: `${myName} invited you to join their Travel Partner commute group${groupLabel} on Velocity!\n\n${link}\n\nOr open the app → Travel Partner → "Join a group" and paste this invite code:\n${groupId}`,
      title: `${myName} invited you on Velocity`,
    }).catch(() => Alert.alert('Share failed', `Copy this invite code manually:\n\n${groupId}`));
  }

  async function openPrivateChat(targetUid: string) {
    if (!groupId || openingDm) return;
    setOpeningDm(true);
    try {
      const { matchId } = await api.openTravelMateDirectChat({ targetUid, groupId });
      setDmTarget(null);
      router.push(`/passenger/travel-mate/chat/${matchId}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not open the chat.');
    } finally {
      setOpeningDm(false);
    }
  }

  if (!group) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>←</Text></Pressable>
          <Text style={s.title}>Group</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.muted }}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>←</Text></Pressable>
        <Text style={s.title} numberOfLines={1}>{group.name}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Group info */}
        <Card>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Destination</Text>
            <Text style={s.infoValue}>{group.destinationName || '—'}</Text>
          </View>
          {group.schedule && (
            <>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Departs</Text>
                <Text style={s.infoValue}>{group.schedule.departTime}</Text>
              </View>
              <View style={s.daysRow}>
                {group.schedule.days.map(d => (
                  <View key={d} style={s.dayChip}><Text style={s.dayChipText}>{DAY_LABELS[d] ?? d}</Text></View>
                ))}
              </View>
            </>
          )}
          {/* Invite code — always visible so members can dictate/copy it */}
          <View style={s.inviteBox}>
            <Text style={s.inviteLabel}>INVITE CODE</Text>
            <Text style={s.inviteCode} selectable>{groupId}</Text>
            <Text style={s.inviteHint}>
              Long-press to copy. Partners must be matched with a member to join.
            </Text>
          </View>
          <Pressable onPress={shareInvite} style={s.copyIdBtn}>
            <Text style={s.copyIdText}>🔗 Share invite link + code</Text>
          </Pressable>
        </Card>

        {/* Members */}
        <Text style={s.sectionHead}>Members ({group.members.length}/{group.maxSize})</Text>
        <Card>
          {group.members.map((uid, i) => {
            const info = group.memberInfo[uid];
            const isMe = uid === user?.uid;
            return (
              <Pressable
                key={uid}
                style={[s.memberRow, i < group.members.length - 1 && s.memberSep]}
                disabled={isMe}
                onPress={() => setDmTarget(uid)}
              >
                <View style={s.memberAvatar}><Text style={{ fontSize: 18 }}>👤</Text></View>
                <Text style={s.memberName}>{info?.displayName ?? uid}</Text>
                {uid === group.createdBy && (
                  <View style={s.creatorBadge}><Text style={s.creatorBadgeText}>Creator</Text></View>
                )}
                {isMe ? (
                  <View style={s.youBadge}><Text style={s.youBadgeText}>You</Text></View>
                ) : (
                  <Text style={{ fontSize: 14 }}>💬</Text>
                )}
              </Pressable>
            );
          })}
        </Card>

        {/* Actions */}
        <Text style={s.sectionHead}>Actions</Text>
        <Card>
          <Pressable
            onPress={() => router.push(`/passenger/travel-mate/group-chat/${groupId}` as Parameters<typeof router.push>[0])}
            style={s.actionBtn}
          >
            <Text style={s.actionBtnIcon}>💬</Text>
            <View>
              <Text style={s.actionBtnLabel}>Group chat</Text>
              <Text style={s.actionBtnSub}>Chat with all members — shared rides appear here too</Text>
            </View>
          </Pressable>
          <View style={s.actionDivider} />
          <Pressable
            onPress={() => router.push('/passenger/booking')}
            style={s.actionBtn}
          >
            <Text style={s.actionBtnIcon}>🚗</Text>
            <View>
              <Text style={s.actionBtnLabel}>Book shared ride</Text>
              <Text style={s.actionBtnSub}>Anyone in the group can book — then share the ride link from the trip screen</Text>
            </View>
          </Pressable>
          <View style={s.actionDivider} />
          <Pressable
            onPress={() => setSettleOpen(true)}
            style={s.actionBtn}
          >
            <Text style={s.actionBtnIcon}>💸</Text>
            <View>
              <Text style={s.actionBtnLabel}>Settle fare</Text>
              <Text style={s.actionBtnSub}>Split a completed trip fare equally from wallet balances</Text>
            </View>
          </Pressable>
        </Card>

        {/* Settlement history */}
        {settlements.length > 0 && (
          <>
            <Text style={s.sectionHead}>Settlement history</Text>
            {settlements.map(st => (
              <Card key={st.id}>
                <View style={s.settlRow}>
                  <View>
                    <Text style={s.settlFare}>PKR {st.fare.toLocaleString()}</Text>
                    <Text style={s.settlDetail}>{st.riders.length} riders · PKR {st.share} each</Text>
                    {st.createdAt && (
                      <Text style={s.settlDate}>
                        {new Date(st.createdAt.seconds * 1000).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}
                      </Text>
                    )}
                  </View>
                  <View style={s.settlNet}>
                    {st.bookerUid === user?.uid ? (
                      <>
                        <Text style={s.settlNetLabel}>You paid</Text>
                        <Text style={[s.settlNetAmt, { color: colors.primary }]}>PKR {st.bookerNetCost}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={s.settlNetLabel}>Your share</Text>
                        <Text style={[s.settlNetAmt, { color: colors.danger }]}>−PKR {st.share}</Text>
                      </>
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Member mini-profile → private chat */}
      <Modal visible={!!dmTarget} transparent animationType="fade" onRequestClose={() => setDmTarget(null)}>
        <Pressable style={s.dmOverlay} onPress={() => setDmTarget(null)}>
          <Pressable style={s.dmBox} onPress={() => {}}>
            <View style={s.dmAvatar}><Text style={{ fontSize: 34 }}>👤</Text></View>
            <Text style={s.dmName}>{(dmTarget && group.memberInfo[dmTarget]?.displayName) ?? 'Member'}</Text>
            <Text style={s.dmSub}>Group member</Text>
            <Pressable
              style={[s.dmBtn, openingDm && { opacity: 0.6 }]}
              disabled={openingDm}
              onPress={() => dmTarget && openPrivateChat(dmTarget)}
            >
              <Text style={s.dmBtnText}>{openingDm ? 'Opening…' : '💬 Message privately'}</Text>
            </Pressable>
            <Pressable style={s.dmCancel} onPress={() => setDmTarget(null)}>
              <Text style={s.dmCancelText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Settle fare modal */}
      <Modal visible={settleOpen} transparent animationType="slide" onRequestClose={closeSettle}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: 24 + insets.bottom }]}>
            {settleResult ? (
              <>
                <Text style={s.resultEmoji}>✅</Text>
                <Text style={s.resultTitle}>Fare settled!</Text>
                <Text style={s.resultSub}>
                  Total fare: PKR {settleResult.fare.toLocaleString()}{'\n'}
                  Your net cost: PKR {settleResult.bookerNetCost.toLocaleString()}{'\n'}
                  Each rider paid: PKR {settleResult.share.toLocaleString()}
                </Text>
                <Pressable onPress={closeSettle} style={s.doneBtn}>
                  <Text style={s.doneBtnText}>Done</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={s.modalTitle}>Split fare</Text>
                <Text style={s.modalSub}>Enter the fare paid to the driver and select who rode.</Text>

                <Text style={s.fieldLabel}>Total fare (PKR)</Text>
                <TextInput
                  style={s.fieldInput}
                  value={fareInput}
                  onChangeText={setFareInput}
                  placeholder="e.g. 800"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                />

                <Text style={s.fieldLabel}>Trip reference (optional)</Text>
                <TextInput
                  style={s.fieldInput}
                  value={tripIdInput}
                  onChangeText={setTripIdInput}
                  placeholder="Trip ID from ride history"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                />

                <Text style={s.fieldLabel}>Who rode?</Text>
                {group.members.map(uid => {
                  const info = group.memberInfo[uid];
                  return (
                    <View key={uid} style={s.riderRow}>
                      <Switch
                        value={selectedRiders[uid] ?? false}
                        onValueChange={v => setSelectedRiders(prev => ({ ...prev, [uid]: v }))}
                        trackColor={{ true: colors.primary, false: colors.border }}
                        thumbColor="#fff"
                      />
                      <Text style={s.riderName}>{info?.displayName ?? uid}{uid === user?.uid ? ' (you)' : ''}</Text>
                    </View>
                  );
                })}

                {fareInput && parseFloat(fareInput) > 0 && (
                  <Text style={s.sharePreview}>
                    Each rider pays: PKR {Math.round(parseFloat(fareInput) / Math.max(1, Object.values(selectedRiders).filter(Boolean).length)).toLocaleString()}
                  </Text>
                )}

                <View style={s.modalBtns}>
                  <Pressable onPress={closeSettle} style={s.cancelBtn}>
                    <Text style={s.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={settle}
                    disabled={settling || !fareInput.trim()}
                    style={[s.settleBtn, (!fareInput.trim() || settling) && { opacity: 0.5 }]}
                  >
                    <Text style={s.settleBtnText}>{settling ? 'Settling…' : 'Settle'}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.background },
  topBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:   { color: colors.text, fontSize: 18, fontWeight: '700' },
  title:      { fontSize: 18, fontWeight: '900', color: colors.text, flex: 1, textAlign: 'center' },
  scroll:     { padding: 20, gap: 14, paddingBottom: 40 },

  sectionHead: { fontSize: 12, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 6, marginBottom: -4 },

  infoRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel:  { fontSize: 13, color: colors.muted, fontWeight: '600' },
  infoValue:  { fontSize: 14, color: colors.text, fontWeight: '700' },
  daysRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  dayChip:    { backgroundColor: `${colors.primary}20`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  dayChipText:{ fontSize: 11, fontWeight: '800', color: colors.primary },
  inviteBox:  { marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: `${colors.primary}12`, borderWidth: 1, borderColor: `${colors.primary}40`, gap: 4 },
  inviteLabel:{ fontSize: 10, fontWeight: '900', color: colors.primary, letterSpacing: 1 },
  inviteCode: { fontSize: 15, fontWeight: '800', color: colors.text, fontFamily: 'monospace' },
  inviteHint: { fontSize: 11, color: colors.muted, lineHeight: 15 },
  copyIdBtn:  { marginTop: 8, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  copyIdText: { fontSize: 13, fontWeight: '700', color: colors.muted },

  memberRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  memberSep:  { borderBottomWidth: 1, borderBottomColor: colors.border },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  memberName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  creatorBadge: { backgroundColor: `${colors.primary}20`, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  creatorBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primary },
  youBadge:   { backgroundColor: `${colors.secondary}20`, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  youBadgeText: { fontSize: 10, fontWeight: '800', color: colors.secondary },

  actionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  actionBtnIcon: { fontSize: 24 },
  actionBtnLabel: { fontSize: 15, fontWeight: '800', color: colors.text },
  actionBtnSub:   { fontSize: 12, color: colors.muted, marginTop: 2 },
  actionDivider:  { height: 1, backgroundColor: colors.border, marginVertical: 8 },

  settlRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settlFare:  { fontSize: 16, fontWeight: '900', color: colors.text },
  settlDetail:{ fontSize: 12, color: colors.muted, marginTop: 2 },
  settlDate:  { fontSize: 11, color: colors.muted, marginTop: 4 },
  settlNet:   { alignItems: 'flex-end' },
  settlNetLabel: { fontSize: 11, color: colors.muted },
  settlNetAmt:   { fontSize: 16, fontWeight: '900', marginTop: 2 },

  // Member DM modal
  dmOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  dmBox:        { backgroundColor: colors.surface, borderRadius: 24, padding: 28, alignItems: 'center', gap: 6, alignSelf: 'stretch' },
  dmAvatar:     { width: 72, height: 72, borderRadius: 36, backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  dmName:       { fontSize: 20, fontWeight: '900', color: colors.text, marginTop: 6 },
  dmSub:        { fontSize: 12, color: colors.muted },
  dmBtn:        { alignSelf: 'stretch', height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  dmBtnText:    { fontSize: 15, fontWeight: '800', color: '#fff' },
  dmCancel:     { paddingVertical: 10 },
  dmCancelText: { fontSize: 13, fontWeight: '700', color: colors.muted },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12, maxHeight: '90%' },
  modalTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub:     { fontSize: 13, color: colors.muted, lineHeight: 18 },
  fieldLabel:   { fontSize: 12, fontWeight: '700', color: colors.muted },
  fieldInput:   { height: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  riderRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  riderName:    { fontSize: 14, color: colors.text, fontWeight: '600' },
  sharePreview: { fontSize: 13, color: colors.primary, fontWeight: '700', textAlign: 'center', paddingVertical: 4 },
  modalBtns:    { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn:    { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelText:   { fontSize: 14, fontWeight: '700', color: colors.muted },
  settleBtn:    { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  settleBtnText:{ fontSize: 14, fontWeight: '800', color: '#fff' },

  // Result
  resultEmoji: { fontSize: 52, textAlign: 'center' },
  resultTitle: { fontSize: 22, fontWeight: '900', color: colors.text, textAlign: 'center' },
  resultSub:   { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  doneBtn:     { height: 52, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  doneBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
}));
