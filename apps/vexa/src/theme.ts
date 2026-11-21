// Vexa dark theme. One place for every colour and radius the screens use.
export const C = {
  bg: '#000000',
  bgDeep: '#040A06',
  panel: 'rgba(18, 26, 20, 0.55)',
  panelSolid: '#0B1310',
  tile: 'rgba(16, 24, 19, 0.5)',
  border: 'rgba(130, 255, 170, 0.16)',
  borderSoft: 'rgba(255, 255, 255, 0.07)',
  lime: '#C3FF37',
  green: '#2BE07A',
  greenDim: '#17A75B',
  glow: '#39FF88',
  text: '#FFFFFF',
  textDim: '#9AA8A0',
  textFaint: '#5F6C65',
  badge: '#1D2B22',
};

// Apple-style glass: a blur, a diagonal sheen, a hairline rim.
export const GLASS = {
  sheen: ['rgba(255,255,255,0.13)', 'rgba(255,255,255,0.03)', 'rgba(120,255,170,0.06)'] as const,
  rim: 'rgba(255,255,255,0.16)',
  rimLit: 'rgba(195,255,55,0.42)',
  intensity: 28,
};

export const R = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };

// shortcut: fixed top inset instead of react-native-safe-area-context,
// upgrade when the app gains real navigation / notched-device testing.
export const TOP_INSET = 54;

/** Mock account state — the drawer hides "Upgrade" while this is true. */
export const IS_PRO = true;
