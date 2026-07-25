/**
 * The bottom sheet that sits over a map (home, booking, live trip, driver
 * request detail).
 *
 * These sheets used to be a fixed percentage of the screen, so whatever didn't
 * fit could only be reached by scrolling a small window — the map above it was
 * dead space you couldn't trade away. This makes the height the user's: drag
 * the grabber to any snap point, or tap it to jump between the height it opened
 * at and (near) full screen.
 *
 * Only the grabber strip is the drag surface. The sheet's content is almost
 * always a ScrollView, and without react-native-gesture-handler (deliberately
 * not a dependency — adding a native module would invalidate the current
 * dev/production builds) a PanResponder covering the whole sheet would fight
 * that scroll for every vertical gesture. A dedicated handle has no such
 * ambiguity, which is why the grabber here is a real 32px target rather than
 * the decorative 4px line it replaces.
 *
 * Height is animated with translateY on a container sized to the TALLEST snap
 * point, never by animating `height` — only transforms can run on the native
 * driver, and a JS-driven height animation stutters badly on low-end Androids.
 */
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors } from '../config';
import { themed } from '../theme';

/** Peek · comfortable · (near) full screen, as fractions of screen height. */
export const DEFAULT_SNAP_POINTS = [0.32, 0.58, 0.94];

/** Past this speed the release is a fling — move a step, don't snap to nearest. */
const FLING_VELOCITY = 0.6;
/** Movement below this counts as a tap on the grabber, not a drag. */
const TAP_SLOP = 4;

interface Props {
  children: ReactNode;
  /**
   * Sheet heights as fractions of the screen, sorted ascending internally.
   * Pass a module-level constant, not an inline array — a fresh array every
   * render re-creates the gesture handler on every render.
   */
  snapPoints?: number[];
  /** Which snap point the sheet opens at, and what a tap collapses back to. */
  initialIndex?: number;
  /** Overrides the default surface (background, border, radius). */
  style?: StyleProp<ViewStyle>;
  /** Fires whenever the sheet settles, with the index it settled on. */
  onSnap?: (index: number) => void;
}

/** A vertical ScrollView is the thing we can lengthen to make a short sheet
 *  scroll. Identified structurally: it takes a contentContainerStyle and is not
 *  a horizontal carousel. Nested scrollers (e.g. the vehicle strip) are never
 *  direct children of the sheet, so scanning one level deep can't reach them. */
function isVerticalScroller(node: ReactNode): node is ReactElement<{ children?: ReactNode }> {
  return (
    isValidElement(node) &&
    (node.props as { contentContainerStyle?: unknown }).contentContainerStyle !== undefined &&
    !(node.props as { horizontal?: boolean }).horizontal
  );
}

/**
 * Append a `height: hiddenBelow` spacer to the LAST vertical ScrollView among
 * the sheet's direct children, so its content can always be scrolled past the
 * screen edge. Runs on every render (spacer height 0 when fully expanded) so the
 * child tree keeps a stable shape and never remounts as the sheet is resized.
 */
function injectScrollSpacer(children: ReactNode, hiddenBelow: number): ReactNode {
  const arr = Children.toArray(children);
  let target = -1;
  arr.forEach((c, i) => {
    if (isVerticalScroller(c)) target = i;
  });
  if (target < 0) return children;

  const scroller = arr[target] as ReactElement<{ children?: ReactNode }>;
  arr[target] = cloneElement(
    scroller,
    undefined,
    scroller.props.children,
    <View key="__sheet_scroll_spacer" style={{ height: Math.max(0, hiddenBelow) }} pointerEvents="none" />,
  );
  return arr;
}

export function DraggableSheet({
  children,
  snapPoints = DEFAULT_SNAP_POINTS,
  initialIndex = 1,
  style,
  onSnap,
}: Props) {
  const { height } = useWindowDimensions();

  const points = useMemo(() => [...snapPoints].sort((a, b) => a - b), [snapPoints]);
  const sheetHeight = height * (points[points.length - 1] ?? 0.94);

  // translateY for each snap point: 0 at the tallest, pushed down below it.
  // Ascending heights therefore give DESCENDING offsets — index 0 is the most
  // collapsed, the last index is fully open.
  const offsets = useMemo(
    () => points.map((p) => sheetHeight - height * p),
    [points, sheetHeight, height],
  );

  const openIndex = Math.min(Math.max(initialIndex, 0), offsets.length - 1);
  // Lazy initialiser, not `useRef(new Animated.Value(…))` — the latter builds a
  // throwaway Animated.Value on every single render.
  const [translateY] = useState(() => new Animated.Value(offsets[openIndex] ?? 0));
  const indexRef = useRef(openIndex);
  // Mirrors indexRef in state so the scroll spacer below re-measures whenever the
  // sheet settles on a new height. The ref stays the source of truth for gestures.
  const [settledIndex, setSettledIndex] = useState(openIndex);
  // Where the sheet sat when the current drag began.
  const grantOffset = useRef(offsets[openIndex] ?? 0);

  const snapTo = useCallback(
    (i: number) => {
      const clamped = Math.min(Math.max(i, 0), offsets.length - 1);
      indexRef.current = clamped;
      setSettledIndex(clamped);
      Animated.spring(translateY, {
        toValue: offsets[clamped] ?? 0,
        useNativeDriver: true,
        bounciness: 2,
        speed: 14,
      }).start();
      onSnap?.(clamped);
    },
    [offsets, translateY, onSnap],
  );

  // Rotation (or any window resize) invalidates every offset — re-seat the
  // sheet at the height it is already showing rather than letting it drift.
  useEffect(() => {
    translateY.setValue(offsets[indexRef.current] ?? 0);
  }, [offsets, translateY]);

  // The gesture handler is built ONCE and reads everything it needs through
  // these, so a rotation (which changes every offset) never has to tear down and
  // rebuild a PanResponder — including mid-drag, which would drop the gesture.
  const latest = useRef({ offsets, snapTo, openIndex });
  useEffect(() => {
    latest.current = { offsets, snapTo, openIndex };
  }, [offsets, snapTo, openIndex]);

  // react-hooks/refs flags any hook initialiser that closes over a ref. Every
  // callback below runs from a touch event, never during render, which is the
  // thing the rule exists to prevent.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        translateY.stopAnimation();
        grantOffset.current = latest.current.offsets[indexRef.current] ?? 0;
      },
      onPanResponderMove: (_e, g) => {
        const o = latest.current.offsets;
        const expanded = o[o.length - 1] ?? 0; // smallest translateY
        const collapsed = o[0] ?? 0;           // largest translateY
        const next = Math.min(collapsed, Math.max(expanded, grantOffset.current + g.dy));
        translateY.setValue(Number.isFinite(next) ? next : expanded);
      },
      onPanResponderRelease: (_e, g) => {
        const { offsets: o, snapTo: snap, openIndex: open } = latest.current;
        const last = o.length - 1;

        // Tap the grabber: toggle between full height and the opening height.
        if (Math.abs(g.dy) < TAP_SLOP && Math.abs(g.vy) < 0.2) {
          snap(indexRef.current === last ? open : last);
          return;
        }

        // A deliberate flick moves one step that way, even if the sheet has
        // barely travelled — snapping back to "nearest" ignores the intent.
        if (Math.abs(g.vy) > FLING_VELOCITY) {
          snap(indexRef.current + (g.vy > 0 ? -1 : 1));
          return;
        }

        const landed = grantOffset.current + g.dy;
        let best = 0;
        let bestDistance = Infinity;
        o.forEach((offset, i) => {
          const d = Math.abs(offset - landed);
          if (d < bestDistance) { bestDistance = d; best = i; }
        });
        snap(best);
      },
      onPanResponderTerminate: () => latest.current.snapTo(indexRef.current),
    }),
  );

  // How much of the sheet currently sits below the screen edge. At the tallest
  // snap this is 0; at a peek snap it is most of the sheet. The scroll area is
  // the full sheet height, so without help the lower content (e.g. the Travel
  // Partner and Earn cards on home) can only be reached by dragging the sheet
  // taller — the ScrollView thinks everything fits and refuses to scroll.
  // Appending a spacer exactly this tall makes the content overflow the visible
  // window, so a plain scroll brings the bottom into view at any snap height.
  const hiddenBelow = offsets[settledIndex] ?? 0;
  const content = useMemo(
    () => injectScrollSpacer(children, hiddenBelow),
    [children, hiddenBelow],
  );

  return (
    <Animated.View
      style={[styles.sheet, { height: sheetHeight, transform: [{ translateY }] }, style]}
    >
      <View
        style={styles.handleArea}
        accessibilityRole="adjustable"
        accessibilityLabel="Resize sheet — drag, or tap to expand and collapse"
        {...pan.panHandlers}
      >
        <View style={styles.grabber} />
      </View>
      {content}
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  // A real target, not a decoration: this strip is the only place the sheet can
  // be dragged from, so it has to be comfortably hittable with a thumb.
  handleArea: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
}));
