'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { Card } from '@/components/ui';

interface Flags {
  walletTopupEnabled: boolean;
  savedPaymentMethodsEnabled: boolean;
  travelMateSubscriptionsEnabled: boolean;
  travelMateFree: boolean;
}

const DEFAULTS: Flags = {
  walletTopupEnabled: false,
  savedPaymentMethodsEnabled: false,
  travelMateSubscriptionsEnabled: false,
  travelMateFree: true,
};

const ROWS: { key: keyof Flags; title: string; on: string; off: string }[] = [
  {
    key: 'walletTopupEnabled',
    title: 'Wallet top-ups (gateway checkout)',
    on: 'Live — passengers and drivers can load their wallets and pay from them.',
    off: 'Coming Soon — the top-up screen shows a "Coming soon" card; rides are cash-only.',
  },
  {
    key: 'savedPaymentMethodsEnabled',
    title: 'Connected payment methods (one-tap top-up)',
    on: 'Live — users can connect an Easypaisa/JazzCash/bank/card account and top up in one tap.',
    off: 'Coming Soon — the Payment methods screen lists the rails but nothing is connectable.',
  },
  {
    key: 'travelMateSubscriptionsEnabled',
    title: 'Travel Partner paid subscriptions',
    on: 'Live — users can buy subscription plans for extra likes.',
    off: 'Coming Soon — the subscription screen shows "Coming soon".',
  },
  {
    key: 'travelMateFree',
    title: 'Travel Partner free for everyone',
    on: 'On — likes are unlimited for all users (no paywall).',
    off: 'Off — the normal free-tier limit and subscriptions apply.',
  },
];

export default function FeatureFlagsPage() {
  const { isAdmin } = useAuth();
  const [flags, setFlags] = useState<Flags>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<keyof Flags | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'featureFlags'), (snap) => {
      const d = snap.data();
      setFlags({
        walletTopupEnabled: d?.walletTopupEnabled === true,
        savedPaymentMethodsEnabled: d?.savedPaymentMethodsEnabled === true,
        travelMateSubscriptionsEnabled: d?.travelMateSubscriptionsEnabled === true,
        travelMateFree: d?.travelMateFree !== false,
      });
      setLoading(false);
    }, (e) => { setError(e.message); setLoading(false); });
  }, []);

  async function toggle(key: keyof Flags) {
    if (!isAdmin) return;
    setSaving(key);
    setError(null);
    try {
      await setDoc(doc(db, 'config', 'featureFlags'), { [key]: !flags[key] }, { merge: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Feature flags</h1>
      <p style={{ color: colors.muted, marginBottom: 24 }}>
        Switch monetised features on or off across the whole app instantly — no deploy needed. The
        code stays wired up; these toggles just control what users see.
      </p>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}

      {loading ? (
        <div style={{ color: colors.muted }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 14, maxWidth: 620 }}>
          {ROWS.map((row) => {
            const value = flags[row.key];
            return (
              <Card key={row.key}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: colors.text, marginBottom: 4 }}>{row.title}</div>
                    <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>{value ? row.on : row.off}</div>
                  </div>
                  <button
                    onClick={() => toggle(row.key)}
                    disabled={!isAdmin || saving === row.key}
                    style={{
                      flexShrink: 0,
                      width: 58,
                      height: 32,
                      borderRadius: 16,
                      border: 'none',
                      cursor: isAdmin ? 'pointer' : 'not-allowed',
                      background: value ? colors.success : colors.border,
                      position: 'relative',
                      transition: 'background 0.15s',
                      opacity: saving === row.key ? 0.6 : 1,
                    }}
                    aria-label={`Toggle ${row.title}`}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 3,
                        left: value ? 29 : 3,
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        background: '#fff',
                        transition: 'left 0.15s',
                      }}
                    />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
