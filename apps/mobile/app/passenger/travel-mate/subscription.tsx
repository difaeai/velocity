/**
 * Travel Mate — subscription screen.
 *
 * Shows available plans + the user's current subscription status.
 * Wallet payment is fully supported (charged at admin approval, not here).
 * EasyPaisa / JazzCash / Bank: user selects, enters their own reference number
 * as the proof URL, and the admin verifies manually before approving.
 */
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { Card, PrimaryButton } from '../../../src/ui/components';

type PaymentMethod = 'wallet' | 'easypaisa' | 'jazzcash' | 'bank';

interface Plan {
  id: string;
  name: string;
  billingPeriod: 'weekly' | 'yearly';
  pricePKR: number;
  dailyLikeAllowance: number;
  active: boolean;
}

interface Sub {
  id: string;
  status: 'pending' | 'active' | 'rejected' | 'expired';
  planSnapshot?: { name?: string; billingPeriod?: string; pricePKR?: number; dailyLikeAllowance?: number };
  paymentMethod?: string;
  requestedAt?: { seconds: number };
  endAt?: { seconds: number };
  rejectionReason?: string | null;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  wallet: '💳 Velocity Wallet (charged on approval)',
  easypaisa: '📱 EasyPaisa (upload receipt)',
  jazzcash: '📱 JazzCash (upload receipt)',
  bank: '🏦 Bank transfer (upload receipt)',
};

export default function TravelMateSubscription() {
  const { user } = useAuth();
  const router = useRouter();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [activeSub, setActiveSub] = useState<Sub | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('wallet');
  const [proofText, setProofText] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active plans
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMatePlans'), where('active', '==', true), orderBy('pricePKR')),
      snap => setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Plan)),
    );
  }, []);

  // Current user's pending or active subscription
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(
        collection(db, 'travelMateSubscriptions'),
        where('uid', '==', user.uid),
        orderBy('requestedAt', 'desc'),
      ),
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Sub);
        const live = docs.find(s => s.status === 'pending' || s.status === 'active') ?? null;
        setActiveSub(live);
      },
    );
  }, [user?.uid]);

  async function submit() {
    if (!selectedPlan) { setError('Choose a plan first.'); return; }
    if (payMethod !== 'wallet' && !proofText.trim()) {
      setError('Paste your payment reference / transaction ID as proof.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.requestTravelMateSubscription({
        planId: selectedPlan.id,
        paymentMethod: payMethod,
        paymentProofURL: payMethod !== 'wallet' ? proofText.trim() : undefined,
      });
      setSuccess(true);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/already-exists') {
        setError('You already have a pending request. Wait for admin approval.');
      } else {
        setError(e instanceof Error ? e.message : 'Request failed. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>←</Text></Pressable>
          <Text style={s.title}>Subscription request</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.center}>
          <Text style={{ fontSize: 60 }}>🎉</Text>
          <Text style={s.successTitle}>Request submitted!</Text>
          <Text style={s.successSub}>
            Our team will review your request and activate your subscription shortly.
            {payMethod === 'wallet' ? ' Payment will only be charged on approval.' : ' Please ensure your payment proof is correct.'}
          </Text>
          <PrimaryButton label="Back to Travel Mate" onPress={() => router.replace('/passenger/travel-mate')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>←</Text></Pressable>
        <Text style={s.title}>Get more likes</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Current subscription status */}
        {activeSub && (
          <Card style={{ borderColor: activeSub.status === 'active' ? colors.primary : '#f59e0b' }}>
            <View style={s.subStatusRow}>
              <Text style={s.subStatusEmoji}>{activeSub.status === 'active' ? '✅' : '⏳'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.subStatusTitle}>
                  {activeSub.status === 'active' ? 'Active subscription' : 'Pending approval'}
                </Text>
                <Text style={s.subStatusDetail}>
                  {activeSub.planSnapshot?.name} · {activeSub.planSnapshot?.dailyLikeAllowance} likes/day
                </Text>
                {activeSub.status === 'active' && activeSub.endAt && (
                  <Text style={s.subStatusExpiry}>
                    Expires {new Date(activeSub.endAt.seconds * 1000).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                )}
                {activeSub.status === 'pending' && (
                  <Text style={s.subStatusExpiry}>Waiting for admin to review your payment</Text>
                )}
              </View>
            </View>
          </Card>
        )}

        {/* Free tier info */}
        <Card>
          <Text style={s.sectionLabel}>FREE TIER</Text>
          <Text style={s.freeTierText}>4 likes per month</Text>
          <Text style={s.freeTierSub}>Renews automatically on the 1st of each month.</Text>
        </Card>

        {/* Plans */}
        <Text style={s.heading}>Subscription plans</Text>
        {plans.length === 0 && (
          <Card><Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center' }}>No plans available yet. Check back soon.</Text></Card>
        )}
        {plans.map(plan => (
          <Pressable key={plan.id} onPress={() => setSelectedPlan(plan)}>
            <Card style={selectedPlan?.id === plan.id ? { ...s.planCard, ...s.planCardActive } : s.planCard}>
              <View style={s.planRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.planName}>{plan.name}</Text>
                  <Text style={s.planSub}>{plan.dailyLikeAllowance} likes/day · {plan.billingPeriod}</Text>
                </View>
                <View style={s.planPriceBox}>
                  <Text style={s.planPrice}>PKR {plan.pricePKR.toLocaleString()}</Text>
                  <Text style={s.planPeriod}>per {plan.billingPeriod === 'yearly' ? 'year' : 'week'}</Text>
                </View>
              </View>
              {selectedPlan?.id === plan.id && (
                <View style={s.selectedBadge}><Text style={s.selectedBadgeText}>Selected ✓</Text></View>
              )}
            </Card>
          </Pressable>
        ))}

        {/* Payment method */}
        {selectedPlan && (
          <>
            <Text style={s.heading}>Payment method</Text>
            {(['wallet', 'easypaisa', 'jazzcash', 'bank'] as PaymentMethod[]).map(m => (
              <Pressable key={m} onPress={() => setPayMethod(m)} style={[s.payRow, payMethod === m && s.payRowActive]}>
                <View style={[s.payRadio, payMethod === m && s.payRadioActive]} />
                <Text style={[s.payLabel, payMethod === m && { color: colors.text }]}>{PAYMENT_LABELS[m]}</Text>
              </Pressable>
            ))}

            {payMethod !== 'wallet' && (
              <Card>
                <Text style={s.proofLabel}>Payment proof (transaction ID or screenshot URL)</Text>
                <TextInput
                  style={s.proofInput}
                  value={proofText}
                  onChangeText={setProofText}
                  placeholder="Paste transaction ID or screenshot link…"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                />
                <Text style={s.proofHint}>
                  Send the exact amount to our {payMethod} account and paste your transaction reference here. Admin will verify before activating.
                </Text>
              </Card>
            )}

            {payMethod === 'wallet' && (
              <Card>
                <Text style={s.walletNote}>
                  PKR {selectedPlan.pricePKR.toLocaleString()} will be deducted from your Velocity wallet only after an admin approves your request. No charge if rejected.
                </Text>
              </Card>
            )}

            {error && <Text style={s.error}>{error}</Text>}

            <PrimaryButton
              label={`Request ${selectedPlan.name} · PKR ${selectedPlan.pricePKR.toLocaleString()}`}
              onPress={submit}
              loading={loading}
              disabled={!!activeSub}
            />
            {!!activeSub && (
              <Text style={s.blockedNote}>You already have a {activeSub.status} subscription. Only one at a time is allowed.</Text>
            )}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.background },
  topBar:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:     { color: colors.text, fontSize: 18, fontWeight: '700' },
  title:        { fontSize: 18, fontWeight: '900', color: colors.text },
  scroll:       { padding: 20, gap: 14, paddingBottom: 40 },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  heading:      { fontSize: 15, fontWeight: '900', color: colors.text, marginTop: 4 },
  sectionLabel: { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' },

  // Current sub banner
  subStatusRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  subStatusEmoji:  { fontSize: 28 },
  subStatusTitle:  { fontSize: 15, fontWeight: '800', color: colors.text },
  subStatusDetail: { fontSize: 13, color: colors.muted, marginTop: 2 },
  subStatusExpiry: { fontSize: 11, color: colors.muted, marginTop: 2 },

  // Free tier
  freeTierText: { fontSize: 20, fontWeight: '900', color: colors.text },
  freeTierSub:  { fontSize: 12, color: colors.muted },

  // Plan cards
  planCard:         { borderColor: colors.border },
  planCardActive:   { borderColor: colors.primary, backgroundColor: `${colors.primary}10` },
  planRow:          { flexDirection: 'row', alignItems: 'center' },
  planName:         { fontSize: 16, fontWeight: '900', color: colors.text },
  planSub:          { fontSize: 12, color: colors.muted, marginTop: 2 },
  planPriceBox:     { alignItems: 'flex-end' },
  planPrice:        { fontSize: 16, fontWeight: '900', color: colors.primary },
  planPeriod:       { fontSize: 11, color: colors.muted },
  selectedBadge:    { marginTop: 8, alignSelf: 'flex-start', backgroundColor: `${colors.primary}20`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  selectedBadgeText:{ fontSize: 11, fontWeight: '800', color: colors.primary },

  // Payment method
  payRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  payRowActive: { opacity: 1 },
  payRadio:     { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
  payRadioActive:{ borderColor: colors.primary, backgroundColor: colors.primary },
  payLabel:     { fontSize: 14, fontWeight: '600', color: colors.muted, flex: 1 },

  // Proof
  proofLabel:   { fontSize: 12, fontWeight: '700', color: colors.muted, marginBottom: 6 },
  proofInput:   { height: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  proofHint:    { fontSize: 11, color: colors.muted, marginTop: 8, lineHeight: 16 },

  // Wallet note
  walletNote:   { fontSize: 13, color: colors.muted, lineHeight: 18 },

  // Success
  successTitle: { fontSize: 22, fontWeight: '900', color: colors.text, textAlign: 'center' },
  successSub:   { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  error:        { color: colors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  blockedNote:  { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4 },
});
