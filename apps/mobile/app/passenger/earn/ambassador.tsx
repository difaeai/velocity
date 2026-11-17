/**
 * Velocity Ambassador Program — apply, and then your board.
 * ---------------------------------------------------------------------------
 * The third way into Earn with Velocity and the only one nobody buys (owner,
 * 2026-11-18). One screen, four states, because an ambassador taps the same
 * thing every time and should be shown whatever is true right now:
 *
 *   none / rejected  → the deal, and one document to send
 *   pending          → waiting on a person
 *   active           → the two targets, what is left of each, and the money
 *   suspended        → paused by Velocity
 *
 * ONE DOCUMENT, AND NOTHING ELSE
 * A CV or a CNIC photo, their choice. The name and the number come off the
 * account they are already signed in with — this program is aimed at students,
 * and a form that asks a student to retype their own name is a form that does
 * not get finished.
 *
 * THE BANK ACCOUNT IS NOT ON THE APPLICATION
 * It appears on the board AFTER approval, because an account number collected
 * from somebody who is then rejected is a bank detail held for no reason.
 */
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../src/api/client';
import type { MyAmbassador } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { useCachedResource } from '../../../src/lib/cachedResource';
import { uploadAmbassadorDoc } from '../../../src/lib/uploadDoc';
import { themed } from '../../../src/theme';
import { Text, TextInput } from '../../../src/ui/Text';
import { PrimaryButton } from '../../../src/ui/components';
import { pickPhoto } from '../../../src/ui/onboarding';
import { ErrorState, formatPKR, Skeleton } from '../../../src/ui/partner';

export default function AmbassadorScreen() {
  const router = useRouter();
  const { data, loading, error, reload } = useCachedResource<MyAmbassador>(
    'myAmbassador',
    () => api.getMyAmbassador({}),
    'Could not load your ambassador status.',
  );

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/earn'))}
          hitSlop={12}
        >
          <Text style={s.back}>←</Text>
        </Pressable>
        <Text style={s.headerTitle}>Velocity Ambassador</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {loading && !data ? (
          <View style={{ gap: 12 }}>
            <Skeleton height={120} radius={18} />
            <Skeleton height={90} radius={18} />
          </View>
        ) : error && !data ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? null : data.stage === 'active' || data.stage === 'suspended' ? (
          <Board data={data} onSaved={reload} />
        ) : data.stage === 'pending' ? (
          <Pending />
        ) : (
          <Apply data={data} onApplied={reload} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Not an ambassador yet, or turned down ───────────────────────────────────

function Apply({ data, onApplied }: { data: MyAmbassador; onApplied: () => void }) {
  const { user } = useAuth();
  const [cvUri, setCvUri] = useState<string | null>(null);
  const [cnicUri, setCnicUri] = useState<string | null>(null);
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const t = data.settings;

  const submit = useCallback(async () => {
    if (!user) return;
    if (!cvUri && !cnicUri) {
      Alert.alert('One document, please', 'Attach your CV or a photo of your CNIC.');
      return;
    }
    setBusy(true);
    try {
      // Whichever they attached. Both is fine; neither is refused above.
      const [cv, cnic] = await Promise.all([
        cvUri ? uploadAmbassadorDoc(user.uid, 'cv', cvUri) : null,
        cnicUri ? uploadAmbassadorDoc(user.uid, 'cnic', cnicUri) : null,
      ]);
      await api.applyAmbassador({
        cvUrl: cv?.url,
        cnicUrl: cnic?.url,
        about: about.trim() || undefined,
        acceptedTerms: true,
      });
      onApplied();
      Alert.alert(
        'Sent for approval',
        'Our team will look at your application. You will get a notification as soon as it is decided.',
      );
    } catch (e) {
      Alert.alert('Could not apply', (e as { message?: string }).message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }, [user, cvUri, cnicUri, about, onApplied]);

  return (
    <View style={{ gap: 14 }}>
      {data.rejectionReason ? (
        <View style={s.alert}>
          <Text style={s.alertTitle}>Not approved</Text>
          <Text style={s.alertBody}>{data.rejectionReason}</Text>
        </View>
      ) : null}

      <View style={s.hero}>
        <View style={s.kicker}>
          <Text style={s.kickerTxt}>NO PAYMENT</Text>
        </View>
        <Text style={s.heroTitle}>Work two targets, earn a salary</Text>
        <Text style={s.heroBody}>
          You buy nothing. Apply with one document, and if we approve you we give you your
          own 5-digit code and two targets to work.
        </Text>
      </View>

      <Text style={s.label}>THE TARGETS</Text>
      <View style={s.card}>
        <TargetRow
          n={t.userTarget}
          title="people on the app"
          body="They install Velocity Rides and put your code in their profile."
          compulsory
        />
        <View style={s.divider} />
        <TargetRow
          n={t.partnerTarget}
          title="people on Earn with Velocity"
          body="Of those, this many go on to buy a Starter or Pro plan on the same code."
        />
      </View>

      <View style={s.payCard}>
        <Text style={s.payAmount}>{formatPKR(t.salaryPkr)}</Text>
        <Text style={s.payMeta}>
          a month, once both targets are met. The {t.userTarget} is compulsory — the salary does
          not unlock without it.
        </Text>
        <Text style={s.payNote}>
          Short of the targets you are paid commission instead, for as much of the work as you
          did. Commission exists on Earn with Velocity only, on nothing else Velocity sells.
        </Text>
      </View>

      <Text style={s.label}>ONE DOCUMENT — YOUR CHOICE</Text>
      <View style={{ gap: 10 }}>
        <DocPicker
          label="Your CV"
          hint="A photo or scan is fine"
          picked={!!cvUri}
          onPress={() => pickPhoto(setCvUri)}
        />
        <DocPicker
          label="Or your CNIC"
          hint="The front of the card"
          picked={!!cnicUri}
          onPress={() => pickPhoto(setCnicUri)}
        />
      </View>

      <TextInput
        style={s.textarea}
        placeholder="Anything you want us to know (optional) — your campus, your year, why you want this."
        placeholderTextColor={colors.muted}
        value={about}
        onChangeText={setAbout}
        multiline
        maxLength={600}
      />

      <PrimaryButton
        label={busy ? 'Sending…' : 'Apply to be an Ambassador'}
        loading={busy}
        disabled={busy || (!cvUri && !cnicUri)}
        onPress={submit}
      />
      <Text style={s.foot}>
        We already have your name and number from your profile, so there is nothing else to fill
        in. You add the account you want to be paid into after you are approved.
      </Text>
    </View>
  );
}

function TargetRow({
  n,
  title,
  body,
  compulsory,
}: {
  n: number;
  title: string;
  body: string;
  compulsory?: boolean;
}) {
  return (
    <View style={s.targetRow}>
      <Text style={s.targetNum}>{n}</Text>
      <View style={{ flex: 1 }}>
        <View style={s.targetHead}>
          <Text style={s.targetTitle}>{title}</Text>
          {compulsory ? (
            <View style={s.mustPill}>
              <Text style={s.mustTxt}>MUST</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.targetBody}>{body}</Text>
      </View>
    </View>
  );
}

function DocPicker({
  label,
  hint,
  picked,
  onPress,
}: {
  label: string;
  hint: string;
  picked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.doc, picked && s.docOn, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: picked }}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.docLabel}>{label}</Text>
        <Text style={s.docHint}>{picked ? 'Attached ✓' : hint}</Text>
      </View>
      <Text style={[s.docPick, picked && { color: colors.primary }]}>
        {picked ? 'Change' : 'Attach'}
      </Text>
    </Pressable>
  );
}

// ── Waiting on a person ─────────────────────────────────────────────────────

function Pending() {
  return (
    <View style={s.waitCard}>
      <Text style={s.waitEmoji}>⏳</Text>
      <Text style={s.waitTitle}>Waiting for approval</Text>
      <Text style={s.waitBody}>
        Our team is reading your application. You will get a notification the moment it is
        decided — then your code and your targets appear here.
      </Text>
    </View>
  );
}

// ── Approved: the board ─────────────────────────────────────────────────────

function Board({ data, onSaved }: { data: MyAmbassador; onSaved: () => void }) {
  const p = data.progress;
  const t = data.settings;
  if (!p) return null;
  const suspended = data.stage === 'suspended';

  return (
    <View style={{ gap: 14 }}>
      {suspended ? (
        <View style={s.alert}>
          <Text style={s.alertTitle}>Paused by Velocity Rides</Text>
          <Text style={s.alertBody}>Contact support to start again.</Text>
        </View>
      ) : null}

      <View style={s.codeCard}>
        <Text style={s.codeLabel}>YOUR CODE</Text>
        <Text style={s.code}>{data.referralCode}</Text>
        <Text style={s.codeHint}>
          They install Velocity Rides, open their profile and type this in. That is what counts.
        </Text>
      </View>

      <Text style={s.label}>YOUR TARGETS</Text>
      <TargetBar
        done={p.usersOnboarded}
        target={t.userTarget}
        remaining={p.usersRemaining}
        title="People on the app"
        unit="users"
        compulsory
      />
      <TargetBar
        done={p.partnersSold}
        target={t.partnerTarget}
        remaining={p.partnersRemaining}
        title="People on Earn with Velocity"
        unit="partners"
      />

      <View style={[s.payCard, p.salaryUnlocked && s.payCardOn]}>
        <Text style={s.payLabel}>
          {p.salaryUnlocked ? 'SALARY UNLOCKED' : 'WHAT YOU HAVE EARNED SO FAR'}
        </Text>
        <Text style={[s.payAmount, p.salaryUnlocked && { color: colors.primary }]}>
          {p.rateUnset ? 'To be confirmed' : formatPKR(p.payPkr)}
        </Text>
        <Text style={s.payMeta}>
          {p.salaryUnlocked
            ? `Both targets met — ${formatPKR(t.salaryPkr)} a month.`
            : p.rateUnset
              ? `Your commission rate has not been set yet. Your ${p.partnersSold} Earn with Velocity ${
                  p.partnersSold === 1 ? 'sale is' : 'sales are'
                } recorded and will be paid once it is.`
              : `Commission on ${p.partnersSold} Earn with Velocity ${
                  p.partnersSold === 1 ? 'sale' : 'sales'
                }. Meet both targets and this becomes ${formatPKR(t.salaryPkr)} a month instead.`}
        </Text>
        {!p.salaryUnlocked ? (
          <Text style={s.payNote}>
            {p.userTargetMet
              ? `The ${t.userTarget} users are done. ${p.partnersRemaining} more on Earn with Velocity unlocks the salary.`
              : `${p.usersRemaining} more ${p.usersRemaining === 1 ? 'user' : 'users'} to go — that one is compulsory.`}
          </Text>
        ) : null}
      </View>

      <PayoutCard account={data.payoutAccount ?? null} onSaved={onSaved} />
    </View>
  );
}

function TargetBar({
  done,
  target,
  remaining,
  title,
  unit,
  compulsory,
}: {
  done: number;
  target: number;
  remaining: number;
  title: string;
  unit: string;
  compulsory?: boolean;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const met = remaining === 0;
  return (
    <View style={s.card}>
      <View style={s.targetHead}>
        <Text style={s.barTitle}>{title}</Text>
        {compulsory ? (
          <View style={s.mustPill}>
            <Text style={s.mustTxt}>MUST</Text>
          </View>
        ) : null}
      </View>
      <View style={s.barRow}>
        <Text style={s.barCount}>
          {done}
          <Text style={s.barOf}> / {target}</Text>
        </Text>
        <Text style={[s.barLeft, met && { color: colors.primary }]}>
          {met ? 'Done ✓' : `${remaining} ${unit} to go`}
        </Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }, met && { backgroundColor: colors.primary }]} />
      </View>
    </View>
  );
}

/** The account an approved ambassador is paid into — added here, never on the application. */
function PayoutCard({
  account,
  onSaved,
}: {
  account: { accountTitle?: string; accountNumber?: string; bankName?: string } | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(!account);
  const [title, setTitle] = useState(account?.accountTitle ?? '');
  const [number, setNumber] = useState(account?.accountNumber ?? '');
  const [bank, setBank] = useState(account?.bankName ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.setAmbassadorPayout({
        accountTitle: title.trim(),
        accountNumber: number.trim(),
        bankName: bank.trim(),
      });
      setOpen(false);
      onSaved();
      Alert.alert('Saved', 'This is the account we will pay you into.');
    } catch (e) {
      Alert.alert('Could not save', (e as { message?: string }).message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  const valid = title.trim().length >= 2 && number.trim().length >= 5 && bank.trim().length >= 2;

  if (!open && account) {
    return (
      <View style={s.card}>
        <Text style={s.label}>WHERE WE PAY YOU</Text>
        <Text style={s.acctNumber}>{account.accountNumber}</Text>
        <Text style={s.acctMeta}>
          {account.accountTitle} · {account.bankName}
        </Text>
        <Pressable onPress={() => setOpen(true)} hitSlop={8}>
          <Text style={s.link}>Change ›</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Text style={s.label}>WHERE WE PAY YOU</Text>
      <Text style={s.acctHint}>
        Add the account you want your salary or commission sent to. Only you and Velocity Rides
        can see it.
      </Text>
      <TextInput
        style={s.field}
        placeholder="Account title (the name on the account)"
        placeholderTextColor={colors.muted}
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        style={s.field}
        placeholder="Account number or IBAN"
        placeholderTextColor={colors.muted}
        value={number}
        onChangeText={setNumber}
        autoCapitalize="characters"
      />
      <TextInput
        style={s.field}
        placeholder="Bank"
        placeholderTextColor={colors.muted}
        value={bank}
        onChangeText={setBank}
      />
      <PrimaryButton
        label={busy ? 'Saving…' : 'Save account'}
        loading={busy}
        disabled={!valid || busy}
        onPress={save}
      />
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { padding: 16, paddingBottom: 44, gap: 14 },

  label: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.6 },
  link: { fontSize: 13, fontWeight: '800', color: colors.primary, marginTop: 8 },
  foot: { fontSize: 11.5, fontWeight: '600', color: colors.muted, lineHeight: 17, textAlign: 'center' },

  hero: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 8,
  },
  kicker: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  kickerTxt: { fontSize: 10, fontWeight: '900', color: colors.btnText, letterSpacing: 0.8 },
  heroTitle: { fontSize: 20, fontWeight: '900', color: colors.text },
  heroBody: { fontSize: 13, fontWeight: '600', color: colors.muted, lineHeight: 19 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  divider: { height: 1, backgroundColor: colors.border },

  targetRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  targetNum: { fontSize: 30, fontWeight: '900', color: colors.primary, minWidth: 54 },
  targetHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  targetTitle: { fontSize: 14, fontWeight: '900', color: colors.text, flexShrink: 1 },
  targetBody: { fontSize: 12, fontWeight: '600', color: colors.muted, lineHeight: 17, marginTop: 2 },
  mustPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  mustTxt: { fontSize: 9, fontWeight: '900', color: colors.btnText, letterSpacing: 0.6 },

  payCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 6,
  },
  payCardOn: { borderColor: colors.primary, borderWidth: 1.5 },
  payLabel: { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  payAmount: { fontSize: 32, fontWeight: '900', color: colors.text, letterSpacing: -0.8 },
  payMeta: { fontSize: 12.5, fontWeight: '700', color: colors.muted, lineHeight: 18 },
  payNote: { fontSize: 11.5, fontWeight: '600', color: colors.muted, lineHeight: 17 },

  barTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  barRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  barCount: { fontSize: 22, fontWeight: '900', color: colors.text },
  barOf: { fontSize: 13, fontWeight: '700', color: colors.muted },
  barLeft: { fontSize: 12, fontWeight: '800', color: colors.muted },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.glassChip, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.text },

  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 18,
    gap: 4,
  },
  codeLabel: { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  code: { fontSize: 40, fontWeight: '900', color: colors.primary, letterSpacing: 6 },
  codeHint: { fontSize: 12, fontWeight: '600', color: colors.muted, lineHeight: 18 },

  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  docOn: { borderColor: colors.primary, borderWidth: 1.5 },
  docLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  docHint: { fontSize: 11.5, fontWeight: '600', color: colors.muted, marginTop: 1 },
  docPick: { fontSize: 13, fontWeight: '900', color: colors.text },

  textarea: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.text,
    height: 96,
    textAlignVertical: 'top',
  },
  field: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  acctHint: { fontSize: 11.5, fontWeight: '600', color: colors.muted, lineHeight: 17 },
  acctNumber: { fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: 0.5 },
  acctMeta: { fontSize: 12, fontWeight: '700', color: colors.muted },

  alert: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 14,
    gap: 4,
  },
  alertTitle: { fontSize: 14, fontWeight: '900', color: colors.danger },
  alertBody: { fontSize: 12.5, fontWeight: '600', color: colors.muted, lineHeight: 18 },

  waitCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  waitEmoji: { fontSize: 36 },
  waitTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  waitBody: { fontSize: 13, fontWeight: '600', color: colors.muted, lineHeight: 19, textAlign: 'center' },
}));
