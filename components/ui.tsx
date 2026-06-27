'use client';

import { colors } from '@/lib/config';

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
        backgroundColor: bg,
        color: fg,
        border: variant === 'ghost' ? `1px solid ${colors.border}` : 'none',
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
        background: colors.surface,
        border: `1px solid ${colors.border}`,
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
