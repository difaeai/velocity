'use client';

import { colors } from '@/lib/config';

/**
 * Apple-style liquid glass (owner, 2026-11-06): see-through, blurred behind,
 * lit along the top edge. For panels; buttons get `glassShine` over their fill.
 */
export const glass: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.56))',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.85)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(255,255,255,0.4), 0 10px 30px rgba(16,48,32,0.08)',
};

/** The light on a solid glass button: a sheen down its face and a bright top rim. */
const glassShine: React.CSSProperties = {
  backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0.04) 55%, rgba(255,255,255,0))',
  border: '1px solid rgba(255,255,255,0.22)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), 0 6px 18px rgba(0,0,0,0.12)',
};

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  const bg =
    variant === 'danger'
      ? colors.danger
      : variant === 'secondary'
        ? colors.secondary
        : variant === 'ghost'
          ? 'transparent'
          : colors.primary;
  const fg = variant === 'ghost' ? colors.text : '#fff';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...(variant === 'ghost' ? glass : { ...glassShine, backgroundColor: bg }),
        color: fg,
        borderRadius: 10,
        padding: '8px 14px',
        fontWeight: 700,
        fontSize: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        ...glass,
        borderRadius: 16,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 160 }}>
      <div style={{ color: colors.muted, fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ color: colors.text, fontSize: 28, fontWeight: 900, marginTop: 6 }}>{value}</div>
    </Card>
  );
}

export function Badge({ label, color = colors.primary }: { label: string; color?: string }) {
  return (
    <span
      style={{
        background: `${color}1A`,
        color,
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 11,
        fontWeight: 800,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}
