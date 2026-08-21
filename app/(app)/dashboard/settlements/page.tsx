'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

interface AiVerdict {
  genuine?: boolean;
  amountDetected?: number | null;
  recipientMatch?: boolean;
  confidence?: string;
  reasoning?: string;
}
interface Settlement {
  id: string;
  /** Absent on settlements written before cancellation fees existed. */
  kind?: 'commission' | 'cancellation_fee';
  /** Present on every settlement; `driverId` only on commission ones. */
  userId?: string;
  driverId?: string;
  amountDue?: number;
  method?: string | null;
  proofPath?: string;
  status: string;
  aiChecked?: boolean;
  aiVerdict?: AiVerdict | null;
  createdAt?: { seconds: number };
}

export default function SettlementsPage() {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'commissionSettlements'), where('status', '==', 'pending_review')),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Settlement);
        list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
        setRows(list);
      },
      (e) => setError(e.message),
    );
  }, []);

  // Resolve screenshot download URLs (admin-readable per storage rules).
  useEffect(() => {
    rows.forEach((r) => {
      if (r.proofPath && !urls[r.id]) {
        getDownloadURL(ref(storage, r.proofPath))
          .then((url) => setUrls((prev) => ({ ...prev, [r.id]: url })))
          .catch(() => undefined);
      }
    });
  }, [rows, urls]);

  async function review(id: string, approve: boolean) {
    setBusy(id);
    setError(null);
    try {
      let reason: string | undefined;
      if (!approve) {
        reason = window.prompt('Reason for rejection (shown to the payer):') ?? undefined;
      }
      await adminApi.adminReviewCommissionSettlement({ settlementId: id, approve, reason });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Settlements</h1>
      <p style={{ color: colors.muted, marginBottom: 24, maxWidth: 720 }}>
        Payments the AI couldn&apos;t auto-approve — driver commission cycles and unpaid cancellation
        fees alike. Check the screenshot against the amount due and Velocity&apos;s account, then
        approve to clear the debt or reject to ask for a new receipt.
      </p>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}

      {rows.length === 0 ? (
        <Card><div style={{ color: colors.muted }}>No settlements awaiting review. 🎉</div></Card>
      ) : (
        <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
          {rows.map((r) => {
            const v = r.aiVerdict;
            const isFee = r.kind === 'cancellation_fee';
            const payer = r.userId ?? r.driverId ?? 'unknown';
            return (
              <Card key={r.id}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {urls[r.id] ? (
                    <a href={urls[r.id]} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={urls[r.id]}
                        alt="Payment screenshot"
                        style={{ width: 160, height: 220, objectFit: 'cover', borderRadius: 10, border: `1px solid ${colors.border}` }}
                      />
                    </a>
                  ) : (
                    <div style={{ width: 160, height: 220, borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.muted, fontSize: 12 }}>
                      Loading…
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: colors.text }}>
                        PKR {(r.amountDue ?? 0).toLocaleString()} due
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          padding: '3px 8px',
                          borderRadius: 999,
                          color: isFee ? colors.danger : colors.primary,
                          background: `${isFee ? colors.danger : colors.primary}1A`,
                          border: `1px solid ${isFee ? colors.danger : colors.primary}40`,
                        }}
                      >
                        {isFee ? '🚫 Cancellation fee' : '📋 Commission'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
                      {isFee ? 'User' : 'Driver'} {payer.slice(0, 8)}… · via {r.method ?? 'unknown'}
                    </div>

                    <div style={{ background: colors.bg, borderRadius: 10, padding: 12, border: `1px solid ${colors.border}`, marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
                        AI assessment {r.aiChecked === false ? '(AI unavailable)' : ''}
                      </div>
                      {v ? (
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: colors.muted, lineHeight: 1.6 }}>
                          <li>Genuine: <strong style={{ color: v.genuine ? colors.success : colors.danger }}>{v.genuine ? 'yes' : 'no'}</strong></li>
                          <li>Amount detected: <strong>{v.amountDetected != null ? `PKR ${v.amountDetected.toLocaleString()}` : 'unreadable'}</strong></li>
                          <li>Recipient matches Velocity: <strong style={{ color: v.recipientMatch ? colors.success : colors.danger }}>{v.recipientMatch ? 'yes' : 'no'}</strong></li>
                          <li>Confidence: <strong>{v.confidence ?? '—'}</strong></li>
                          {v.reasoning ? <li>{v.reasoning}</li> : null}
                        </ul>
                      ) : (
                        <div style={{ fontSize: 13, color: colors.muted }}>No automated assessment — review the screenshot manually.</div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                      <Button onClick={() => review(r.id, true)} disabled={busy === r.id}>
                        {busy === r.id ? 'Working…' : isFee ? 'Approve & clear fees' : 'Approve & unlock'}
                      </Button>
                      <Button variant="secondary" onClick={() => review(r.id, false)} disabled={busy === r.id}>
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
