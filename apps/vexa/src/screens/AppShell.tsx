import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEnter } from '../anim';
import Avatar from '../components/Avatar';
import Backdrop from '../components/Backdrop';
import Drawer from '../components/Drawer';
import Glass from '../components/Glass';
import {
  ActivityIcon,
  BellIcon,
  ChevronsLeft,
  ContentIcon,
  GridIcon,
  HomeIcon,
  PersonIcon,
} from '../components/Icons';
import HomeScreen from './HomeScreen';
import { screenFor, type Ctx } from './routes';
import { useDb } from '../store';
import { C, R, TOP_INSET } from '../theme';

const W = Dimensions.get('window').width;

type Tab = 'home' | 'activity' | 'content' | 'profile';

const TABS: Array<{ key: Tab; label: string; icon: (on: boolean) => React.ReactNode }> = [
  { key: 'home', label: 'Home', icon: (on) => <HomeIcon size={22} color={on ? C.lime : C.textDim} /> },
  { key: 'activity', label: 'Activity', icon: (on) => <ActivityIcon size={22} color={on ? C.lime : C.textDim} /> },
  { key: 'content', label: 'Content', icon: (on) => <ContentIcon size={22} color={on ? C.lime : C.textDim} /> },
  { key: 'profile', label: 'Profile', icon: (on) => <PersonIcon size={22} color={on ? C.lime : C.textDim} /> },
];

const TAB_TITLE: Record<Exclude<Tab, 'home'>, string> = {
  activity: 'Activity',
  content: 'Content',
  profile: 'Profile',
};

/** A pane that fades and rises whenever its key changes. */
function Swap({ children }: { children: React.ReactNode }) {
  const enter = useEnter(0, { y: 12, duration: 300 });
  return <Animated.View style={[{ flex: 1 }, enter]}>{children}</Animated.View>;
}

/** A pushed destination: slides in from the right, slides out on back. */
function Detail({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [t]);

  const back = () => {
    Animated.timing(t, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => finished && onClose(),
    );
  };

  const x = t.interpolate({ inputRange: [0, 1], outputRange: [W, 0] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, st.detail, { transform: [{ translateX: x }] }]}>
      <Backdrop />
      <View style={st.detailBar}>
        <View testID="back">
          <Glass style={st.backBtn} radius={18} onPress={back}>
            <View style={st.backInner}>
              <ChevronsLeft size={18} />
            </View>
          </Glass>
        </View>
        <Text style={st.detailTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 36 }} />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Animated.View>
  );
}

export default function AppShell({ onLogout }: { onLogout?: () => void }) {
  const data = useDb();
  const [tab, setTab] = useState<Tab>('home');
  const [route, setRoute] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const unread = data.notices.filter((n) => !n.read).length;

  const ctx: Ctx = {
    onOpen: (title) => setRoute(title),
    onLogout: () => onLogout?.(),
    goal,
  };

  return (
    <View style={st.root}>
      <Backdrop />

      <View style={st.header}>
        <Pressable
          testID="menu"
          onPress={() => setDrawerOpen(true)}
          hitSlop={12}
          style={({ pressed }) => [pressed && st.pressed]}
        >
          <GridIcon size={24} />
        </Pressable>

        <View style={st.brandRow}>
          <Text style={st.brand}>
            VE<Text style={{ color: C.lime }}>X</Text>A
          </Text>
        </View>

        <View style={st.headerRight}>
          <Pressable testID="bell" onPress={() => setRoute('Notifications')} hitSlop={10}>
            <BellIcon size={23} />
            {unread ? <View style={st.bellDot} /> : null}
          </Pressable>
          <Pressable onPress={() => setTab('profile')} hitSlop={10}>
            <Avatar />
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <Swap key={tab}>
          {tab === 'home' ? (
            <HomeScreen
              onOpen={setRoute}
              onGoal={(text) => {
                setGoal(text);
                setRoute('Your plan');
              }}
            />
          ) : (
            screenFor(TAB_TITLE[tab], ctx)
          )}
        </Swap>
      </View>

      <Glass style={st.tabbar} radius={R.xl}>
        <View style={st.tabbarInner}>
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <Pressable key={t.key} style={st.tab} onPress={() => setTab(t.key)}>
                {t.icon(on)}
                <Text style={[st.tabLabel, on && st.tabLabelOn]}>{t.label}</Text>
                {on ? <View style={st.tabUnderline} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Glass>

      {route ? (
        <Detail key={route} title={route} onClose={() => setRoute(null)}>
          {screenFor(route, ctx)}
        </Detail>
      ) : null}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={setRoute}
        onLogout={() => onLogout?.()}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: TOP_INSET },
  pressed: { opacity: 0.65 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { color: C.text, fontSize: 25, fontWeight: '900', letterSpacing: 3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bellDot: { position: 'absolute', right: -1, top: -1, width: 8, height: 8, borderRadius: 4, backgroundColor: C.lime },

  tabbar: { marginHorizontal: 16, marginBottom: 18 },
  tabbarInner: { flexDirection: 'row', paddingVertical: 12 },
  tab: { flex: 1, alignItems: 'center', gap: 5 },
  tabLabel: { color: C.textDim, fontSize: 11.5, fontWeight: '600' },
  tabLabelOn: { color: C.lime, fontWeight: '800' },
  tabUnderline: { position: 'absolute', bottom: -8, width: 46, height: 3, borderRadius: 2, backgroundColor: C.lime },

  detail: { backgroundColor: C.bg, paddingTop: TOP_INSET },
  detailBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  backBtn: { width: 36, height: 36 },
  backInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  detailTitle: { color: C.text, fontSize: 16, fontWeight: '800', flex: 1, textAlign: 'center' },
});
