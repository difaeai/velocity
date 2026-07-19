/**
 * Custom bottom tab bar for the Travel Partner section.
 *
 * A floating glass pill that sits on the app's charcoal backdrop instead of
 * the default edge-to-edge grey slab: rounded frosted bar, and the active tab
 * carries a lime-glass capsule behind its icon (Material-3 style) so focus
 * reads at a glance without shouting.
 *
 * Only the five real tabs are rendered — every push-navigated full-screen
 * (chat, post, message-requests, …) is excluded here, and while one of those
 * screens is focused the bar hides entirely.
 */
import type { BottomTabBarProps } from 'expo-router/tabs';
import type { ColorValue } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../config';
import { themed } from '../theme';
import { ChatsIcon, FeedIcon, HomeIcon, MatchesIcon, ProfileIcon } from './TabBarIcons';

type TabIconComponent = (props: {
  color: ColorValue;
  focused: boolean;
  size?: number;
}) => React.JSX.Element;

const TABS: Record<string, { label: string; Icon: TabIconComponent }> = {
  index: { label: 'Home', Icon: HomeIcon },
  feed: { label: 'Feed', Icon: FeedIcon },
  matches: { label: 'Matches', Icon: MatchesIcon },
  chats: { label: 'Chats', Icon: ChatsIcon },
  profile: { label: 'Profile', Icon: ProfileIcon },
};

export function TravelMateTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const focusedRoute = state.routes[state.index];

  // Push-navigated full-screens (chat, post, setup, …) get no bar at all.
  if (!focusedRoute || !TABS[focusedRoute.name]) return null;

  // Always keep the bar clear of the system navigation bar / gesture area,
  // even on devices that under-report the bottom inset.
  const bottomInset = Math.max(insets.bottom, 12);

  return (
    <View style={[s.wrap, { paddingBottom: bottomInset }]}>
      <View style={s.bar}>
        {state.routes.map((route) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const { label, Icon } = tab;
          const focused = route.key === focusedRoute.key;
        return (
            <Pressable
              key={route.key}
              style={s.tab}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              android_ripple={{ color: `${colors.primary}22`, borderless: true }}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              onLongPress={() => {
                navigation.emit({ type: 'tabLongPress', target: route.key });
              }}
            >
              <View style={[s.iconPill, focused && s.iconPillActive]}>
                <Icon color={focused ? colors.primary : colors.muted} focused={focused} size={22} />
              </View>
              <Text style={[s.label, focused && s.labelActive]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
          })}
      </View>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  // Matches the screens' backdrop so the pill appears to float over the page.
  wrap: {
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  iconPill: {
    width: 54,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPillActive: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '800',
  },
}));
