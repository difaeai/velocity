/**
 * Earn with Velocity — the landing page.
 *
 * This screen has one job beyond selling the program: to make the earning rule
 * impossible to misunderstand BEFORE anyone applies. A partner who signs up
 * believing that installs pay, and then watches a hundred recruits earn them
 * nothing, becomes a support ticket and a bad review. So the honest, unglamorous
 * version of the deal is stated on the way in, not buried in the terms.
 *
 * The pitch is only for strangers. An applicant already said yes — showing them
 * the sales page again with their status buried at the bottom made people think
 * their application vanished. So each stage takes over the whole screen:
 * pending  → "Waiting for approval" with a progress timeline, every time,
 *            until an admin decides;
 * rejected → the admin's reason and a reapply button into the same form;
 * approved → straight to the dashboard (fleets, performance, revenue).
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { colors } from '../../../src/config';
import { usePartnerStatus } from '../../../src/hooks/partner';
import { PrimaryButton } from '../../../src/ui/components';
import { Skeleton } from '../../../src/ui/partner';

export default function EarnLanding() {
  const router = useRouter();
  const { stage, rejectionReason } = usePartnerStatus();

  // An approved partner should never see the sales pitch again — send them
  // straight to the thing they came for.
  useEffect(() => {
    if (stage === 'approved') router.replace('/passenger/earn/dashboard');
  }, [stage, router]);

  if (stage === 'loading' || stage === 'approved') {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton height={150} radius={20} />
          <Skeleton height={90} radius={16} />
        </View>
      </SafeAreaView>
    );
  }

  if (stage === 'pending') {
    return (
      <StatusScreen
        onBack={() => router.back()}
        art={<WaitingArt />}
        title="Waiting for approval"
        body="Your application has been submitted and is with our review team. You will get a notification the moment it is decided — nothing more is needed from you."
      >
        <View style={s.timeline}>
          <TimelineRow state="done" title="Application submitted" body="Your details and documents are in." />
          <TimelineRow state="current" title="Under review" body="A human is checking your documents. This usually takes 1–2 working days." />
          <TimelineRow state="todo" title="Approved" body="Your referral code and both fleets are created automatically." last />
        </View>
        <PrimaryButton
          label="Contact support"
          variant="secondary"
          onPress={() => router.push('/passenger/support-chat')}
        />
      </StatusScreen>
    );
  }

  if (stage === 'rejected' || stage === 'resubmit') {
    return (
      <StatusScreen
        onBack={() => router.back()}
        art={<Text style={s.statusEmoji}>📄</Text>}
        title={stage === 'resubmit' ? 'Documents needed' : 'Application not approved'}
        body={
          stage === 'resubmit'
            ? 'Our team could not verify your documents. Upload clearer ones and your application goes straight back into the queue.'
            : 'Your application was not approved this time. You can fix the problem below and apply again.'
        }
      >
        <View style={s.reasonCard}>
          <Text style={s.reasonLabel}>Reason from our team</Text>
          <Text style={s.reasonText}>{rejectionReason ?? 'Your application could not be approved.'}</Text>
        </View>
        <PrimaryButton
          label="Upload documents & reapply"
          onPress={() => router.push('/passenger/earn/apply')}
        />
      </StatusScreen>
    );
  }

  if (stage === 'suspended') {
    return (
      <StatusScreen
        onBack={() => router.back()}
        art={<Text style={s.statusEmoji}>🚫</Text>}
        title="Account suspended"
        body="Your partner account is suspended and is not earning. Your history is kept. Contact support to resolve it."
      >
        <PrimaryButton
          label="Contact support"
          variant="secondary"
          onPress={() => router.push('/passenger/support-chat')}
        />
      </StatusScreen>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Pressable style={s.back} onPress={() => router.back()} hitSlop={10}>
          <Text style={s.backText}>←</Text>
        </Pressable>

        <GrowthArt />

        <Text style={s.h1}>Earn with Velocity</Text>
        <Text style={s.sub}>
          Build your own transportation network and earn from every genuine completed ride.
        </Text>

        {/* The rule, stated plainly, before they commit. */}
        <View style={s.ruleCard}>
          <Text style={s.ruleTitle}>How the money actually works</Text>

          <Rule
            emoji="✅"
            title="You earn from completed rides"
            body="Every genuine ride your drivers and passengers finish pays you a share of Velocity's commission on that ride."
          />
          <Rule
            emoji="📵"
            title="Sign-ups alone pay nothing"
            body="Someone installing the app or registering with your code earns you zero. They have to actually ride."
          />
          <Rule
            emoji="🚫"
            title="Fake, cancelled and scam rides never pay"
            body="Cancelled, fraudulent or staged rides always generate zero commission. They still show in your history, marked, so nothing looks like it vanished."
          />
        </View>

        <View style={s.stepsCard}>
          <Text style={s.ruleTitle}>How it works</Text>
          <Step n={1} text="Apply on the Free or Pro tier with your CNIC or any identity document." />
          <Step n={2} text="Our team verifies you. Both your fleets are created automatically." />
          <Step n={3} text="Share your 5-digit code — drivers and passengers both use the same one." />
          <Step n={4} text="Earn on every genuine completed ride — and withdraw." />
        </View>

        <PrimaryButton
          label="Apply for Partner Program"
          onPress={() => router.push('/passenger/earn/apply')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Full-screen status page for anyone who already applied. It replaces the
 * sales pitch entirely — an applicant's question is "where is my application?",
 * and the answer should be the first and only thing on screen.
 */
function StatusScreen({
  onBack,
  art,
  title,
  body,
  children,
}: {
  onBack: () => void;
  art: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Pressable style={s.back} onPress={onBack} hitSlop={10}>
          <Text style={s.backText}>←</Text>
        </Pressable>

        <View style={s.statusArt}>{art}</View>
        <Text style={s.h1}>{title}</Text>
        <Text style={s.sub}>{body}</Text>

        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function TimelineRow({
  state,
  title,
  body,
  last,
}: {
  state: 'done' | 'current' | 'todo';
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <View style={s.tlRow}>
      <View style={s.tlRail}>
        <View
          style={[
            s.tlDot,
            state === 'done' && s.tlDotDone,
            state === 'current' && s.tlDotCurrent,
          ]}
        >
          {state === 'done' ? <Text style={s.tlCheck}>✓</Text> : null}
          {state === 'current' ? <View style={s.tlDotInner} /> : null}
        </View>
        {!last ? (
          <View style={[s.tlLine, state === 'done' && { backgroundColor: colors.primary }]} />
        ) : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 18 }}>
        <Text style={[s.tlTitle, state === 'todo' && { color: colors.muted }]}>{title}</Text>
        <Text style={s.tlBody}>{body}</Text>
      </View>
    </View>
  );
}

/** A pulsing hourglass — "we have it, sit tight" in one glance. */
function WaitingArt() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1300, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });

  return (
    <View style={s.waitWrap}>
      <Animated.View style={[s.waitRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
      <View style={s.waitCircle}>
        <Text style={s.statusEmoji}>⏳</Text>
      </View>
    </View>
  );
}

function Rule({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <View style={s.rule}>
      <Text style={s.ruleEmoji}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.ruleHead}>{title}</Text>
        <Text style={s.ruleBody}>{body}</Text>
      </View>
    </View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={s.step}>
      <View style={s.stepNum}>
        <Text style={s.stepNumText}>{n}</Text>
      </View>
      <Text style={s.stepText}>{text}</Text>
    </View>
  );
}

/**
 * Growth, transportation and community in one mark: a rising bar chart whose
 * last bar becomes a road, with three riders orbiting it. Drawn in SVG rather
 * than shipped as a PNG so it recolours with the theme.
 */
function GrowthArt() {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(rise, { toValue: 1, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(900),
        Animated.timing(rise, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [rise]);

  const lift = rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const fade = rise.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.35, 1, 1] });

  return (
    <Animated.View style={[s.art, { opacity: fade, transform: [{ translateY: lift }] }]}>
      <Svg width="100%" height={150} viewBox="0 0 300 150">
        <Defs>
          <LinearGradient id="g" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={colors.primary} stopOpacity="0.15" />
            <Stop offset="1" stopColor={colors.primary} stopOpacity="0.75" />
          </LinearGradient>
        </Defs>

        {/* Growth bars */}
        <Rect x="30"  y="98"  width="26" height="34" rx="6" fill="url(#g)" />
        <Rect x="66"  y="80"  width="26" height="52" rx="6" fill="url(#g)" />
        <Rect x="102" y="58"  width="26" height="74" rx="6" fill="url(#g)" />
        <Rect x="138" y="34"  width="26" height="98" rx="6" fill="url(#g)" />

        {/* The road out of the last bar */}
        <Path
          d="M175 132 C 210 132, 220 96, 252 96 L 285 96"
          stroke={colors.primary}
          strokeWidth="3"
          strokeDasharray="9 7"
          strokeLinecap="round"
          fill="none"
        />

        {/* Community */}
        <Circle cx="205" cy="46" r="13" fill={colors.primary} opacity="0.85" />
        <Circle cx="238" cy="34" r="10" fill={colors.secondary} opacity="0.8" />
        <Circle cx="266" cy="56" r="8"  fill={colors.primary} opacity="0.55" />

        {/* Car on the road */}
        <Rect x="243" y="82" width="30" height="14" rx="5" fill={colors.text} opacity="0.9" />
        <Circle cx="251" cy="97" r="4" fill={colors.text} opacity="0.9" />
        <Circle cx="266" cy="97" r="4" fill={colors.text} opacity="0.9" />
      </Svg>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },

  back: { width: 40, height: 40, justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 24, fontWeight: '700' },

  art: { alignItems: 'center' },

  h1: { color: colors.text, fontSize: 30, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5 },
  sub: {
    color: colors.muted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 6,
  },

  ruleCard: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 20,
    padding: 18,
    gap: 14,
    marginTop: 4,
  },
  ruleTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  rule: { flexDirection: 'row', gap: 12 },
  ruleEmoji: { fontSize: 18, marginTop: 1 },
  ruleHead: { color: colors.text, fontSize: 14, fontWeight: '800', marginBottom: 3 },
  ruleBody: { color: colors.muted, fontSize: 13, lineHeight: 19 },

  stepsCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: colors.btnText, fontWeight: '900', fontSize: 13 },
  stepText: { color: colors.muted, fontSize: 13, flex: 1, lineHeight: 19 },

  /* ── Applicant status screens ── */
  statusArt: { alignItems: 'center', marginTop: 14, marginBottom: 6 },
  statusEmoji: { fontSize: 44 },

  waitWrap: { width: 108, height: 108, alignItems: 'center', justifyContent: 'center' },
  waitRing: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
  },
  waitCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.glassLime,
    borderWidth: 1.5,
    borderColor: colors.glassLimeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  timeline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 18,
    paddingBottom: 12,
    marginTop: 6,
  },
  tlRow: { flexDirection: 'row', gap: 14 },
  tlRail: { width: 26, alignItems: 'center' },
  tlDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tlDotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  tlDotCurrent: { borderColor: colors.primary },
  tlDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  tlCheck: { color: colors.btnText, fontSize: 13, fontWeight: '900' },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 3 },
  tlTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  tlBody: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },

  reasonCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    marginTop: 6,
  },
  reasonLabel: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  reasonText: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
