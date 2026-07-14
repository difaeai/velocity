/**
 * Earn with Velocity — the landing page.
 *
 * This screen has one job beyond selling the program: to make the earning rule
 * impossible to misunderstand BEFORE anyone applies. A partner who signs up
 * believing that installs pay, and then watches a hundred recruits earn them
 * nothing, becomes a support ticket and a bad review. So the honest, unglamorous
 * version of the deal is stated on the way in, not buried in the terms.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { colors } from '../../../src/config';
import { usePartnerStatus } from '../../../src/hooks/partner';
import { PrimaryButton } from '../../../src/ui/components';
import { LevelBadge, Skeleton } from '../../../src/ui/partner';

export default function EarnLanding() {
  const router = useRouter();
  const { stage, rejectionReason, level } = usePartnerStatus();

  // An approved partner should never see the sales pitch again — send them
  // straight to the thing they came for.
  useEffect(() => {
    if (stage === 'approved') router.replace('/passenger/earn/dashboard');
  }, [stage, router]);

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

        {level ? (
          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <LevelBadge level={level} />
          </View>
        ) : null}

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
          <Step n={1} text="Apply on the Free or Pro tier with your CNIC." />
          <Step n={2} text="Our team verifies you. Both your fleets are created automatically." />
          <Step n={3} text="Share your 5-digit code — drivers and passengers both use the same one." />
          <Step n={4} text="Earn on every genuine completed ride — and withdraw." />
        </View>

        <StatusPanel stage={stage} reason={rejectionReason} onApply={() => router.push('/passenger/earn/apply')} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPanel({
  stage,
  reason,
  onApply,
}: {
  stage: ReturnType<typeof usePartnerStatus>['stage'];
  reason: string | null;
  onApply: () => void;
}) {
  if (stage === 'loading') return <Skeleton height={52} radius={14} />;

  if (stage === 'pending') {
    return (
      <View style={s.noticeCard}>
        <Text style={s.noticeTitle}>⏳ Application under review</Text>
        <Text style={s.noticeBody}>
          Your application has been submitted successfully. Our team will review your documents.
          You will receive a notification once your application is approved.
        </Text>
      </View>
    );
  }

  if (stage === 'suspended') {
    return (
      <View style={[s.noticeCard, { borderColor: colors.danger }]}>
        <Text style={[s.noticeTitle, { color: colors.danger }]}>Account suspended</Text>
        <Text style={s.noticeBody}>
          Your partner account is suspended and is not earning. Contact support to resolve it.
        </Text>
      </View>
    );
  }

  if (stage === 'rejected' || stage === 'resubmit') {
    return (
      <View style={{ gap: 12 }}>
        <View style={[s.noticeCard, { borderColor: colors.danger }]}>
          <Text style={[s.noticeTitle, { color: colors.danger }]}>
            {stage === 'resubmit' ? 'Documents needed' : 'Application rejected'}
          </Text>
          <Text style={s.noticeBody}>{reason ?? 'Your application could not be approved.'}</Text>
        </View>
        <PrimaryButton label="Fix and resubmit" onPress={onApply} />
      </View>
    );
  }

  return <PrimaryButton label="Apply for Partner Program" onPress={onApply} />;
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

  noticeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  noticeTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  noticeBody: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
