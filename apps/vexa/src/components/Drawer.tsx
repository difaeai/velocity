import { BlurView } from 'expo-blur';
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Avatar from './Avatar';
import { GoogleMark, InstagramMark, MetaMark, TiktokMark, YoutubeMark } from './BrandMarks';
import Glass from './Glass';
import {
  ActivityIcon,
  ArrowUpIcon,
  CapIcon,
  CardIcon,
  ChartUpIcon,
  CheckCircleIcon,
  ChevronRight,
  ChevronsLeft,
  CrownIcon,
  DocIcon,
  GlobeWireIcon,
  LogoutIcon,
  MegaphoneIcon,
  SearchIcon,
  SparkleIcon,
  UsersIcon,
} from './Icons';
import VexaProgress from './VexaProgress';
import { creditsTotal, creditsUsed, useDb } from '../store';
import { C, IS_PRO, R, TOP_INSET } from '../theme';

const WIDTH = Math.min(332, Dimensions.get('window').width * 0.86);
// The drawer carries a lot of rows, so it starts a little higher than the rest.
const DRAWER_TOP = TOP_INSET - 8;

function AccountsMark() {
  return (
    <View style={st.accountsMark}>
      <View style={st.accountsRow}>
        <GoogleMark size={12} />
        <InstagramMark size={12} />
        <MetaMark size={12} />
      </View>
      <View style={st.accountsRow}>
        <YoutubeMark size={12} />
        <TiktokMark size={12} />
      </View>
    </View>
  );
}

type RowProps = {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  badge?: string;
  right?: React.ReactNode;
  highlight?: boolean;
  index: number;
  open: boolean;
  onPress: () => void;
};

/** Each row slides in behind the panel, one after the next. */
function Row({ icon, label, sub, badge, right, highlight, index, open, onPress }: RowProps) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const a = Animated.timing(t, {
      toValue: open ? 1 : 0,
      duration: open ? 300 : 120,
      delay: open ? 110 + index * 34 : 0,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [open, index, t]);

  const style = {
    opacity: t,
    transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] }) }],
  };

  return (
    <Animated.View style={[st.rowWrap, style]}>
      <Glass style={st.row} radius={R.md} lit={highlight} onPress={onPress}>
        <View style={st.rowInner}>
          <View style={st.rowIcon}>{icon}</View>
          <View style={{ flex: 1 }}>
            <View style={st.rowLabelLine}>
              <Text style={[st.rowLabel, highlight && { color: C.lime }]}>{label}</Text>
              {badge ? (
                <View style={st.badge}>
                  <Text style={st.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            {sub ? <Text style={st.rowSub}>{sub}</Text> : null}
          </View>
          {right === undefined ? <ChevronRight size={18} /> : right}
        </View>
      </Glass>
    </Animated.View>
  );
}

export default function Drawer({
  open,
  onClose,
  onNavigate,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (title: string) => void;
  onLogout?: () => void;
}) {
  const data = useDb();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(t, {
      toValue: open ? 1 : 0,
      duration: open ? 320 : 230,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, t]);

  const slide = t.interpolate({ inputRange: [0, 1], outputRange: [-WIDTH - 24, 0] });
  const go = (title: string) => {
    onClose();
    onNavigate(title);
  };

  let i = 0;
  const next = () => i++;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: t }]}>
        <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable style={[StyleSheet.absoluteFill, st.backdrop]} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[st.panel, { width: WIDTH, transform: [{ translateX: slide }] }]}>
        <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={st.panelTint} pointerEvents="none" />

        <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => [st.collapse, pressed && st.pressed]}>
          <ChevronsLeft size={18} />
        </Pressable>

        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <Avatar size={64} />
          <Text style={st.name}>{data.me.name}</Text>
          <Text style={st.email}>{data.me.email}</Text>

          <Glass style={st.proPill} radius={R.pill} lit onPress={() => go('Vexa Pro')}>
            <View style={st.proInner}>
              <CrownIcon size={17} />
              <Text style={st.proText}>Vexa Pro</Text>
              <ChevronRight size={16} color={C.lime} />
            </View>
          </Glass>

          <View style={st.divider} />

          <VexaProgress open={open} />

          <Text style={st.section}>MAIN FEATURES</Text>
          <Row index={next()} open={open} icon={<SearchIcon size={21} />} label={'Research\nTeam'} onPress={() => go('Research Team')} />
          <Row index={next()} open={open} icon={<DocIcon size={21} />} label={'Content\nTeam'} onPress={() => go('Content Team')} />
          <Row index={next()} open={open} icon={<MegaphoneIcon size={21} />} label="Ads Expert" onPress={() => go('Ads Expert')} />
          <Row index={next()} open={open} icon={<ChartUpIcon size={21} />} label="Sales Team" onPress={() => go('Sales Team')} />
          <Row
            index={next()}
            open={open}
            icon={<UsersIcon size={21} />}
            label="Outreach"
            sub="Find people & write to them"
            badge="New"
            onPress={() => go('Outreach')}
          />
          <Row index={next()} open={open} icon={<AccountsMark />} label={'Connected\nAccounts'} onPress={() => go('Connected Accounts')} />
          <Row
            index={next()}
            open={open}
            icon={<CapIcon size={21} />}
            label="Make me Learn"
            sub="Save & train with VEXA"
            badge="New"
            highlight
            onPress={() => go('Make me Learn')}
          />
          <Row
            index={next()}
            open={open}
            icon={<ActivityIcon size={21} color={C.green} />}
            label="Usage"
            sub={`${(creditsUsed() / 1000).toFixed(1)}k / ${(creditsTotal() / 1000).toFixed(1)}k credits used`}
            onPress={() => go('Usage')}
          />
          <Row
            index={next()}
            open={open}
            icon={<CardIcon size={21} />}
            label="Billing"
            sub="Invoices & payment method"
            onPress={() => go('Billing')}
          />

          <Text style={st.section}>ACCOUNT</Text>
          {IS_PRO ? (
            <Row
              index={next()}
              open={open}
              icon={<CrownIcon size={19} />}
              label="Vexa Pro Active"
              sub="Unlocking full potential"
              right={<CheckCircleIcon size={20} />}
              onPress={() => go('Vexa Pro')}
            />
          ) : (
            <Row
              index={next()}
              open={open}
              icon={<ArrowUpIcon size={19} />}
              label="Upgrade to Pro"
              right={<SparkleIcon size={17} />}
              highlight
              onPress={() => go('Upgrade to Pro')}
            />
          )}
          <Row
            index={next()}
            open={open}
            icon={<LogoutIcon size={19} />}
            label="Logout"
            right={null}
            onPress={() => {
              onClose();
              onLogout?.();
            }}
          />

          <View style={st.footer}>
            <SparkleIcon size={18} />
            <View style={{ flex: 1 }}>
              <Text style={st.footerTitle}>
                Powered by <Text style={st.footerBrand}>VEXA</Text>
              </Text>
              <Text style={st.footerSub}>Your Social Media Virtual Assistant</Text>
            </View>
            <View style={st.globe}>
              <GlobeWireIcon size={86} />
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  pressed: { opacity: 0.65 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },

  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderTopRightRadius: R.xl,
    borderBottomRightRadius: R.xl,
  },
  panelTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(6,12,9,0.62)' },

  scroll: { paddingTop: DRAWER_TOP, paddingHorizontal: 16, paddingBottom: 6, alignItems: 'flex-start' },

  collapse: {
    position: 'absolute',
    right: 16,
    top: DRAWER_TOP,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },

  name: { color: C.text, fontSize: 18.5, fontWeight: '800', marginTop: 6 },
  email: { color: C.textDim, fontSize: 12.5, marginTop: 2 },

  proPill: { marginTop: 10 },
  proInner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 7 },
  proText: { color: C.lime, fontSize: 14, fontWeight: '800' },

  divider: { height: 1, alignSelf: 'stretch', backgroundColor: C.borderSoft, marginTop: 10 },

  section: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginTop: 11,
    marginBottom: 6,
  },

  rowWrap: { alignSelf: 'stretch', marginBottom: 5 },
  row: { alignSelf: 'stretch' },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 12 },
  rowIcon: { width: 32, alignItems: 'center', justifyContent: 'center' },
  rowLabelLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { color: C.text, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  rowSub: { color: C.textDim, fontSize: 11.5, marginTop: 2 },

  badge: { backgroundColor: C.lime, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#0A1206', fontSize: 10, fontWeight: '800' },

  accountsMark: { alignItems: 'center', gap: 2 },
  accountsRow: { flexDirection: 'row', gap: 2 },

  footer: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
    overflow: 'hidden',
    height: 44,
  },
  footerTitle: { color: C.text, fontSize: 13.5, fontWeight: '600' },
  footerBrand: { fontWeight: '900', letterSpacing: 1 },
  footerSub: { color: C.textDim, fontSize: 11.5, marginTop: 2 },
  globe: { position: 'absolute', right: -14, bottom: -16, opacity: 0.85 },
});
