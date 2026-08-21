'use client';

/**
 * CNIC verification queue.
 *
 * Passengers must prove who they are before they can send or receive a courier
 * (ordinary rides don't ask). Each submission here holds both sides of the card
 * and the number the passenger typed — check the photos are legible, that the
 * number matches the card, and approve. Approving unlocks couriers for them
 * immediately; rejecting tells them why and lets them submit again.
 */

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

interface CnicSubmission {
  id: string;
  uid: string;
  fullName?: string;
  cnicNumber?: string;
  frontUrl?: string;
  backUrl?: string;
  status: 'pending' | 'verified' | 'rejected';
  submittedAt?: { seconds: number };
}

export default function CnicPage() {
  const [rows, setRows] = useState<CnicSubmission[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'cnicVerifications'), where('status', '==', 'pending')),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CnicSubmission);
        // Oldest first — nobody should wait behind a newer submission.
        list.sort((a, b) => (a.submittedAt?.seconds ?? 0) - (b.submittedAt?.seconds ?? 0));
        setRows(list);
      },
      (e) => setError(e.message),
    );
  }, []);

  async function review(uid: string, approve: boolean) {
    setBusy(uid);
    setError(null);
    try {
      let reason: string | undefined;
      if (!approve) {
        reason =
          window.prompt('Reason for rejection (shown to the passenger):') ?? undefined;
      }
      await adminApi.adminReviewCnicVerification({ uid, approve, reason });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>CNIC verification</h1>
      <p style={{ color: colors.muted, marginBottom: 24, maxWidth: 720 }}>
        Passengers who want to send or receive a courier. Check both sides of the card are legible
        and that the number matches, then approve — couriers unlock for them straight away.
      </p>

      {error && (
        <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>
      )}

      {rows.length === 0 ? (
        <Card>
          <div style={{ color: colors.muted }}>No CNIC submissions awaiting review. 🎉</div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 16, maxWidth: 860 }}>
          {rows.map((r) => (
            <Card key={r.id}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <CnicShot url={r.frontUrl} label="Front" />
                  <CnicShot url={r.backUrl} label="Back" />
                </div>

                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: colors.text }}>
                    {r.fullName ?? 'Unnamed'}
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 16,
                      color: colors.text,
                      margin: '6px 0 10px',
                      letterSpacing: 1,
                    }}
                  >
                    {r.cnicNumber ?? '—'}
                  </div>
                  <div style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
                    User {r.uid.slice(0, 8)}… · submitted{' '}
                    {r.submittedAt
                      ? new Date(r.submittedAt.seconds * 1000).toLocaleString()
                      : 'recently'}
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <Button onClick={() => review(r.uid, true)} disabled={busy === r.uid}>
                      {busy === r.uid ? 'Working…' : 'Approve & unlock couriers'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => review(r.uid, false)}
                      disabled={busy === r.uid}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** One side of the card. The URLs are admin-readable per storage.rules. */
function CnicShot({ url, label }: { url?: string; label: string }) {
  const frame: React.CSSProperties = {
    width: 150,
    height: 100,
    objectFit: 'cover',
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    display: 'block',
  };

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`CNIC ${label.toLowerCase()}`} style={frame} />
        </a>
      ) : (
        <div
          style={{
            ...frame,
            background: colors.bg,
            display: 'grid',
            placeItems: 'center',
            color: colors.muted,
            fontSize: 12,
          }}
        >
          Missing
        </div>
      )}
      <div style={{ fontSize: 11, color: colors.muted, fontWeight: 700 }}>{label}</div>
    </div>
  );
}
