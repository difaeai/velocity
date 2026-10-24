/**
 * The passenger menu — every feature in Velocity, in one readable list.
 *
 * ── What was wrong with it ──────────────────────────────────────────────────
 * It was fifteen identical rows of emoji-plus-label, rendered in a Modal that
 * faded in as one flat sheet. Three problems, all the same problem:
 *
 *  · The marks carried no information. Emoji are drawn by the handset, so they
 *    matched neither each other nor the brand, and "City" and "Special Rides"
 *    both landed on 🚗 — two different products wearing one face.
 *  · The labels carried no information either. "My routes", "Matches & Groups",
 *    "Find my Customers" are names, not explanations; a rider who has not used
 *    the feature cannot tell from the row what it would do.
 *  · Nothing moved, so nothing led the eye. A list that arrives all at once is
 *    read as a block of text and scrolled past.
 *
 * So: colourful little illustrations instead of marks (DrawerIcons), a
 * plain-English line under every label saying what the feature is for, and the
 * rows arriving in sequence so the eye is walked down the list instead of
 * being handed it.
 *
 * The icons went through two rounds. Drawn outlines fixed the duplicate faces
 * but not the readability: sixteen hairline marks in one grey are still
 * sixteen things you have to read the label to tell apart. They are now
 * shaded objects in their real materials — gold coins, a kraft parcel, a steel
 * shield, paper map and envelope — which is what the handset's emoji had going
 * for it, with none of what it had against it. Colour is doing the work of
 * telling rows apart; the lime is kept for the one detail that names each
 * feature.
 *
 * ── How the animation is driven ─────────────────────────────────────────────
 * ONE Animated.Value for the whole list, not one per row. Each row derives its
 * entrance by interpolating that single value over its own slice of the
 * timeline, so sixteen rows cost one native-driven animation rather than
 * sixteen JS timers.
 *
 * That same slice is handed to the row's ICON, added to the row's press value,
 * as a single 0 → 1 → 2 `motion` input: arriving, at rest, held. That is how
 * the wheels roll in, the pin drops, the letter comes out of the envelope and
 * the cog turns into place — on one shared native animation, and again under
 * your finger. Press feedback is per row (it has to be), and the only thing
 * that animates FOREVER is an unread badge: a pulse that carries information.
 * Decoration that loops behind a closed drawer is battery we are spending on
 * nobody.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ColorValue,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';
import {
  CityCarIcon,
  CityToCityIcon,
  EnvelopeIcon,
  GearIcon,
  GroupIcon,
  MegaphoneIcon,
  ParcelIcon,
  PartnerIcon,
  ProfileIcon,
  RapidHelpIcon,
  RouteMapIcon,
  SharedRideIcon,
  ShieldIcon,
  SignOutIcon,
  SpecialRideIcon,
  WalletCardIcon,
  type DrawerIconProps,
} from './DrawerIcons';

const DRAWER_WIDTH = Dimensions.get('window').width * 0.8;

/** Brand lime as a literal: the drawer is dark in both themes. */
const LIME = '#ccff00';

type IconComponent = (props: DrawerIconProps) => React.JSX.Element;

interface Row {
  key: string;
  Icon: IconComponent;
  label: string;
  /** The line that turns a name into something a first-time rider understands. */
  blurb: string;
  /** The icon tile's wash. Groups related features without needing a header. */
  tint: string;
  onPress: () => void;
  badge?: number;
  active?: boolean;
  danger?: boolean;
}

interface Section {
  title: string;
  rows: Row[];
}

export interface PassengerDrawerProps {
  visible: boolean;
  onClose: () => void;
  /** The rider's own name; null until it is known, which shows "Your account". */
  name: string | null;
  /** The line under the name — @username, else the phone number. */
  handle?: string | null;
  /** The rider's own picture; falls back to their initials, then to a mark. */
  photoURL?: string | null;
  isDriver: boolean;
  walletHidden: boolean;
  walletLabel: string;
  messagesUnread: number;
  supportUnread: number;
  /** Closes the drawer and routes; the host owns navigation. */
  onNavigate: (path: string) => void;
  onDriverMode: () => void;
  onSignOut: () => void;
  onProfile: () => void;
}

export function PassengerDrawer({
  visible,
  onClose,
  name,
  handle,
  photoURL,
  isDriver,
  walletHidden,
  walletLabel,
  messagesUnread,
  supportUnread,
  onNavigate,
  onDriverMode,
  onSignOut,
  onProfile,
}: PassengerDrawerProps) {
  const slideX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const dim = useRef(new Animated.Value(0)).current;
  /** The one value every row's entrance is interpolated from. */
  const stagger = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      stagger.setValue(0);
      Animated.parallel([
        Animated.spring(slideX, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 190 }),
        Animated.timing(dim, { toValue: 1, duration: 180, useNativeDriver: true }),
        // Starts a beat after the panel so the rows land ON a surface rather
        // than flying in beside one that is still moving.
        Animated.timing(stagger, {
          toValue: 1,
          duration: 620,
          delay: 90,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideX, { toValue: -DRAWER_WIDTH, duration: 200, useNativeDriver: true }),
        Animated.timing(dim, { toValue: 0, duration: 170, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, slideX, dim, stagger]);

  /* The menu itself. Grouped, because sixteen undifferentiated rows is the
     thing that made the old drawer unreadable: a rider looking for a parcel
     should not have to read past "Matches & Groups" to find it. */
  const sections = useMemo<Section[]>(() => {
    const rides: Row[] = [
      {
        key: 'city',
        Icon: CityCarIcon,
        label: 'City rides',
        blurb: 'Book a car or bike where you are now',
        tint: 'rgba(204,255,0,0.14)',
        active: true,
        onPress: onClose,
      },
      /* The fleet: the colleagues or classmates you make the same run with,
         asked all at once so the car leaves full. It took over the Special
         Rides slot; renting a whole car is a link at the foot of that screen. */
      {
        key: 'fleet',
        Icon: SpecialRideIcon,
        label: 'Corporate / Students',
        blurb: 'Your fleet for the office or campus run',
        tint: 'rgba(168,85,247,0.16)',
        onPress: () => onNavigate('/passenger/fleet'),
      },
      /* Moved off the home sheet, and this is where it belongs: City to City
         is a journey you plan for another day, not one you book from the map
         in front of you. Directly under Corporate / Students because they are
         the same kind of thing — a ride arranged ahead rather than hailed. */
      {
        key: 'intercity',
        Icon: CityToCityIcon,
        label: 'City to City',
        blurb: 'Intercity seats — pick a city and a day',
        tint: 'rgba(56,189,248,0.16)',
        onPress: () => onNavigate('/passenger/city-to-city'),
      },
      {
        key: 'nearby-pools',
        Icon: SharedRideIcon,
        label: 'Nearby sharing rides',
        blurb: 'Cars going your way with a seat still free',
        tint: 'rgba(204,255,0,0.14)',
        onPress: () => onNavigate('/passenger/pool-request/nearby'),
      },
      {
        key: 'couriers',
        Icon: ParcelIcon,
        label: 'Couriers',
        blurb: 'Send a parcel across town',
        tint: 'rgba(251,146,60,0.16)',
        onPress: () => onNavigate('/passenger/couriers'),
      },
    ];

    /* Ordered by how often a row is opened, not by how the features were
       built: an unread message is the only thing here somebody is waiting on.
       "Earn with Velocity Rides" is NOT in this list — it is a full card on
       the home screen, and a drawer row for something already on the screen
       behind the drawer is a second door to one room. */
    const community: Row[] = [
      {
        key: 'messages',
        Icon: EnvelopeIcon,
        label: 'Messages',
        blurb: 'Partners, your driver and the brands you asked',
        tint: 'rgba(56,189,248,0.16)',
        badge: messagesUnread,
        onPress: () => onNavigate('/passenger/messages'),
      },
      {
        key: 'business-ads',
        Icon: MegaphoneIcon,
        label: 'Find my Customers',
        blurb: 'Put your business in front of riders nearby',
        tint: 'rgba(236,72,153,0.16)',
        onPress: () => onNavigate('/passenger/business-ads'),
      },
      {
        key: 'travel-mate',
        Icon: PartnerIcon,
        label: 'Travel Partner',
        blurb: 'Find people who travel the way you do',
        tint: 'rgba(56,189,248,0.16)',
        onPress: () => onNavigate('/passenger/travel-mate'),
      },
      {
        key: 'matches',
        Icon: GroupIcon,
        label: 'Matches & Groups',
        blurb: 'Your travel partners and their city groups',
        tint: 'rgba(56,189,248,0.16)',
        onPress: () => onNavigate('/passenger/travel-mate/matches'),
      },
    ];

    /* My routes sits under your name, not under Rides: it is a thing you keep,
       not a thing you book. */
    const account: Row[] = [
      {
        key: 'routes',
        Icon: RouteMapIcon,
        label: 'My routes',
        blurb: 'The trips you take every day, saved',
        tint: 'rgba(251,146,60,0.16)',
        onPress: () => onNavigate('/passenger/daily-routes'),
      },
    ];
    // Hidden until the wallet economy officially launches — until then the app
    // presents itself as cash-only.
    if (!walletHidden) {
      account.push({
        key: 'wallet',
        Icon: WalletCardIcon,
        label: walletLabel,
        blurb: 'Your balance and how you pay',
        tint: 'rgba(204,255,0,0.14)',
        onPress: () => onNavigate('/passenger/wallet'),
      });
    }
    account.push(
      {
        key: 'safety',
        Icon: ShieldIcon,
        label: 'Safety Centre',
        blurb: 'SOS, emergency numbers and your live trip',
        tint: 'rgba(239,68,68,0.16)',
        onPress: () => onNavigate('/safety'),
      },
      {
        key: 'support',
        Icon: RapidHelpIcon,
        label: 'Help & complaints',
        blurb: 'Rapid Response — answered, never left sitting',
        tint: 'rgba(204,255,0,0.14)',
        badge: supportUnread,
        onPress: () => onNavigate('/support'),
      },
      {
        key: 'settings',
        Icon: GearIcon,
        label: 'Settings',
        blurb: 'Language, theme and notifications',
        tint: 'rgba(148,163,184,0.16)',
        onPress: () => onNavigate('/passenger/settings'),
      },
      {
        key: 'signout',
        Icon: SignOutIcon,
        label: 'Sign out',
        blurb: 'Leave this account on this phone',
        tint: 'rgba(239,68,68,0.16)',
        danger: true,
        onPress: onSignOut,
      },
    );

    return [
      { title: 'Rides', rows: rides },
      { title: 'People & earning', rows: community },
      { title: 'Your account', rows: account },
    ];
  }, [
    walletHidden, walletLabel, messagesUnread, supportUnread,
    onNavigate, onClose, onSignOut,
  ]);

  // One running index across all sections, so the cascade carries through the
  // section headings instead of restarting at each one.
  let order = 0;

  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => ([...w][0] ?? '').toUpperCase())
    .join('');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.panel, { transform: [{ translateX: slideX }] }]}>
          <SafeAreaView style={styles.safe}>
            <ScrollView
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
            >
              {/* Who is signed in, first. It spent a release as the heading of
                  "Your account" at the foot of the list — below the fold on
                  most phones, so the drawer opened on a menu with nobody's name
                  on it. A rider opening the menu checks it is THEIR account
                  before anything else; the card answers that and is the way
                  into the profile. */}
              <Cascade progress={rowProgress(stagger, order++)}>
                <Pressable
                  style={({ pressed }) => [styles.profileCard, pressed && { opacity: 0.88 }]}
                  onPress={onProfile}
                  accessibilityRole="button"
                  accessibilityLabel={`${name ?? 'Your account'}. View and edit your profile`}
                >
                  <View style={styles.avatarRing}>
                    <View style={styles.avatar}>
                      {photoURL ? (
                        <Image source={{ uri: photoURL }} style={styles.avatarPhoto} alt={name ?? ''} />
                      ) : initials ? (
                        <Text style={styles.avatarInitials}>{initials}</Text>
                      ) : (
                        <ProfileIcon size={30} color="#ffffff" accent={LIME} />
                      )}
                    </View>
                  </View>
                  <View style={styles.profileInfo}>
                    <Text style={styles.profileName} numberOfLines={1}>{name ?? 'Your account'}</Text>
                    {handle ? (
                      <Text style={styles.profileHandle} numberOfLines={1}>{handle}</Text>
                    ) : null}
                    <View style={styles.profileChip}>
                      <Text style={styles.profileChipTxt}>View profile</Text>
                    </View>
                  </View>
                  <Text style={styles.profileChevron}>›</Text>
                </Pressable>
              </Cascade>

              {sections.map((section) => (
                <View key={section.title}>
                  <Cascade progress={rowProgress(stagger, order++)}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  </Cascade>
                  {section.rows.map((row) => {
                    // The row and its icon share one slice, so the icon's own
                    // motion lands exactly as the row does.
                    const progress = rowProgress(stagger, order++);
                    return (
                      <Cascade key={row.key} progress={progress}>
                        <DrawerRow row={row} progress={progress} />
                      </Cascade>
                    );
                  })}
                </View>
              ))}
            </ScrollView>

            <View style={styles.footer}>
              <Pressable
                style={({ pressed }) => [styles.driverButton, pressed && { opacity: 0.9 }]}
                onPress={onDriverMode}
              >
                <Text style={styles.driverButtonText}>
                  {isDriver ? 'Driver mode' : 'Become a driver'}
                </Text>
              </Pressable>
              {!isDriver ? (
                <Text style={styles.footerNote}>Drive your own car and earn on your own hours</Text>
              ) : null}
            </View>
          </SafeAreaView>
        </Animated.View>

        {/* Backdrop on the RIGHT — tapping closes the drawer */}
        <Animated.View style={[styles.backdropWrap, { opacity: dim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * One row's slice of the shared entrance timeline, as a plain 0 → 1 value.
 *
 * `index` is its place in the cascade, not its position on screen: later rows
 * start later and every row covers the same span, which is what makes the list
 * read top-to-bottom. The start is capped so a long menu still finishes — a
 * 30th row must not be scheduled to begin after the animation has ended.
 *
 * It is pulled out of <Cascade> because the row's icon needs the same slice:
 * the entrance and the illustration have to be the same event, not two events
 * that happen to overlap.
 */
function rowProgress(stagger: Animated.Value, index: number) {
  const start = Math.min(0.68, index * 0.042);
  const end = Math.min(1, start + 0.32);
  return stagger.interpolate({
    inputRange: [start, end],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
}

function Cascade({
  progress,
  children,
}: {
  progress: Animated.AnimatedInterpolation<number>;
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] }),
          },
          {
            // A touch of overshoot on the way in. Small enough that it reads as
            // weight rather than as a bounce.
            scale: progress.interpolate({
              inputRange: [0, 0.72, 1],
              outputRange: [0.94, 1.012, 1],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function DrawerRow({
  row,
  progress,
}: {
  row: Row;
  progress: Animated.AnimatedInterpolation<number>;
}) {
  const press = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const hasBadge = (row.badge ?? 0) > 0;

  useEffect(() => {
    if (!hasBadge) return;
    // The only looping animation in the drawer, and it is carrying a fact:
    // there is something here you have not read.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 760, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 760, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasBadge, pulse]);

  const body: ColorValue = row.danger ? colors.danger : '#ffffff';
  /* 0 → 1 as the row arrives, 1 → 2 while it is held. The icon animates itself
     off this one value; see DrawerIcons. */
  const motion = Animated.add(progress, press);

  return (
    <Pressable
      onPressIn={() => {
        Animated.spring(press, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 320 }).start();
      }}
      onPressOut={() => {
        Animated.spring(press, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 320 }).start();
      }}
      onPress={row.onPress}
      accessibilityRole="button"
      accessibilityLabel={
        hasBadge ? `${row.label}, ${row.badge} unread. ${row.blurb}` : `${row.label}. ${row.blurb}`
      }
    >
      <Animated.View
        style={[
          styles.row,
          row.active && styles.rowActive,
          {
            transform: [
              { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.975] }) },
              { translateX: press.interpolate({ inputRange: [0, 1], outputRange: [0, 3] }) },
            ],
          },
        ]}
      >
        <View style={[styles.iconTile, { backgroundColor: row.tint }]}>
          <row.Icon size={26} color={body} accent={row.danger ? colors.danger : LIME} motion={motion} />
        </View>

        <View style={styles.rowText}>
          <Text style={[styles.rowLabel, row.danger && { color: colors.danger }]} numberOfLines={1}>
            {row.label}
          </Text>
          <Text style={styles.rowBlurb} numberOfLines={1}>{row.blurb}</Text>
        </View>

        {hasBadge ? (
          <Animated.View
            style={[
              styles.badge,
              {
                transform: [
                  { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) },
                ],
              },
            ]}
          >
            <Text style={styles.badgeText}>{row.badge! > 9 ? '9+' : row.badge}</Text>
          </Animated.View>
        ) : (
          <Text style={styles.rowChevron}>›</Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  backdropWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    width: DRAWER_WIDTH,
    height: '100%',
    backgroundColor: 'rgba(14,16,15,0.98)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.10)',
  },
  safe: { flex: 1 },
  scroll: { paddingBottom: 16 },

  /* The signed-in rider, at the top: a lime-edged card so it reads as YOU
     rather than as one more menu row, with the face in a lime ring. */
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 2,
    padding: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(204,255,0,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(204,255,0,0.24)',
  },
  avatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: LIME,
    padding: 3,
  },
  avatar: {
    flex: 1,
    borderRadius: 27,
    backgroundColor: 'rgba(204,255,0,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPhoto: { width: '100%', height: '100%' },
  avatarInitials: { fontSize: 21, fontWeight: '900', color: LIME, letterSpacing: 0.5 },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '900', color: '#ffffff', letterSpacing: -0.2 },
  profileHandle: { fontSize: 12, fontWeight: '700', color: '#9aa2a0', marginTop: 2 },
  profileChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: LIME,
  },
  profileChipTxt: { fontSize: 10.5, fontWeight: '900', color: '#0b0d0c', letterSpacing: 0.3 },
  profileChevron: { fontSize: 22, fontWeight: '900', color: 'rgba(255,255,255,0.35)' },

  sectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#6b7270',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginHorizontal: 8,
    borderRadius: 14,
  },
  rowActive: { backgroundColor: 'rgba(204,255,0,0.08)' },
  /* 42px tile, 26px illustration: shading needs pixels to read as shading, and
     this is still small enough that two lines of text fit beside it. */
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14.5, fontWeight: '800', color: '#ffffff' },
  rowBlurb: { fontSize: 11, fontWeight: '600', color: '#808784', marginTop: 1.5 },
  rowChevron: { fontSize: 18, fontWeight: '900', color: '#4e5553' },

  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '900', color: '#ffffff' },

  footer: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  driverButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: LIME,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverButtonText: { color: '#0b0d0c', fontSize: 15.5, fontWeight: '900' },
  footerNote: { color: '#6b7270', fontSize: 10.5, fontWeight: '600', textAlign: 'center' },
}));
