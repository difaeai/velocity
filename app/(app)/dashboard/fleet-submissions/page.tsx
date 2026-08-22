'use client';

/**
 * Fleet submissions — drivers filed by Pro partners from their web portal.
 *
 * This is the final approval the whole portal flow waits on. Nothing exists for
 * these people yet: approving is what creates the driver's account, grants the
 * driver role, writes the vehicle, and credits the driver to the partner's
 * fleet. Rejecting sends the partner the reason so they can fix it.
 *
 * Two things worth checking before approving:
 *  · the CNIC and licence look like a real person, not a placeholder;
 *  · the plate is not one you have already seen under a different fleet — the
 *    backend blocks exact repeats, but not a plate typed slightly differently.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

type Status = 'pending' | 'approved' | 'rejected';

interface Submission {
  id: string;
  partnerId: string;
  partnerName?: string | null;
  partnerCode?: string | null;
  fullName: string;
  phone: string;
  email?: string | null;
  cnic?: string | null;
  licenseNumber?: string | null;
  vehicleType: string;
  vehicleLabel: string;
  plate: string;
  vehicleYear?: number | null;
  vehicleColor?: string | null;
  notes?: string | null;
  status: Status;
  rejectionReason?: string | null;
  fleetBound?: boolean;
  createdDriverUid?: string | null;
  createdAt?: { seconds: number };
}

const TABS: { key: Status; label: string }[] = [
  { key: 'pending', label: 'Awaiting review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export default function FleetSubmissionsPage() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [tab, setTab] = useState<Status>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'driver_submissions'),
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Submission);
          // Oldest first inside the pending queue — nobody waits behind a newer
          // submission — but newest first once decided, which is what you scan.
          list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
          setRows(list);
        },
        (e) => setError(e.message),
      ),
    [],
  );

  const shown = useMemo(() => {
    const filtered = rows.filter((r) => r.status === tab);
    return tab === 'pending' ? filtered : [...filtered].reverse();
  }, [rows, tab]);

  const counts = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
    }),
    [rows],
  );

  async function review(row: Submission, decision: 'approve' | 'reject') {
    let reason: string | undefined;
    if (decision === 'reject') {
      const typed = window.prompt(
        `Why is ${row.fullName} not approved? The partner sees this word for word.`,
      );
      if (!typed || !typed.trim()) return;
      reason = typed.trim();
    } else if (
      !window.confirm(
        `Approve ${row.fullName} (${row.plate})?\n\nThis creates their driver account, grants the driver role and credits them to ${row.partnerName ?? 'the partner'}'s fleet.`,
      )
    ) {
      return;
    }

    setBusy(row.id);
    setError(null);
    setNote(null);
    try {
      const res = await adminApi.adminReviewDriverSubmission({
        submissionId: row.id,
        decision,
        reason,
      });
      if (decision === 'approve') {
        setNote(
          res.fleetBound
            ? `${row.fullName} approved and added to the fleet.`
            : `${row.fullName} approved as a driver, but NOT credited to the fleet — they had already completed rides for Velocity.`,
        );
      } else {
        setNote(`${row.fullName} rejected. The partner has been told why.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Fleet submissions</h1>
      <p style={{ color: colors.muted, marginBottom: 20, maxWidth: '70ch' }}>
        Drivers filed by Pro partners from their fleet portal. Approving here is what actually
        creates the driver — until then the person has no account, no role and no vehicle on the
        platform.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              border: `1px solid ${tab === t.key ? colors.primary : colors.border}`,
              background: tab === t.key ? colors.primary : 'transparent',
              color: tab === t.key ? '#fff' : colors.text,
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {error ? (
        <Card style={{ borderColor: colors.danger, marginBottom: 14 }}>
          <strong style={{ color: colors.danger }}>{error}</strong>
        </Card>
      ) : null}
      {note ? (
        <Card style={{ borderColor: colors.success, marginBottom: 14 }}>
          <strong style={{ color: colors.success }}>{note}</strong>
        </Card>
      ) : null}

      {shown.length === 0 ? (
        <Card>
          <span style={{ color: colors.muted }}>Nothing here.</span>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {shown.map((r) => (
            <Card key={r.id}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <strong style={{ fontSize: 17 }}>{r.fullName}</strong>
                  <div style={{ color: colors.muted, fontSize: 13.5, marginTop: 2 }}>
                    {r.phone}
                    {r.email ? ` · ${r.email}` : ''}
                  </div>
                  <div style={{ color: colors.muted, fontSize: 13.5 }}>
                    CNIC {r.cnic ?? '—'}
                    {r.licenseNumber ? ` · Licence ${r.licenseNumber}` : ''}
                  </div>
                </div>

                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <strong style={{ fontSize: 15 }}>
                    {r.vehicleLabel} · {r.plate}
                  </strong>
                  <div style={{ color: colors.muted, fontSize: 13.5, marginTop: 2 }}>
                    {r.vehicleType}
                    {r.vehicleYear ? ` · ${r.vehicleYear}` : ''}
                    {r.vehicleColor ? ` · ${r.vehicleColor}` : ''}
                  </div>
                </div>

                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: 13.5 }}>
                    Filed by <strong>{r.partnerName ?? r.partnerId}</strong>
                  </div>
                  <div style={{ color: colors.muted, fontSize: 13 }}>
                    Code {r.partnerCode ?? '—'}
                  </div>
                </div>

                {r.status === 'pending' ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Button onClick={() => review(r, 'approve')} disabled={busy === r.id}>
                      {busy === r.id ? 'Working…' : 'Approve'}
                    </Button>
                    <Button variant="danger" onClick={() => review(r, 'reject')} disabled={busy === r.id}>
                      Reject
                    </Button>
                  </div>
                ) : (
                  <span
                    style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: r.status === 'approved' ? colors.success : colors.danger,
                      background:
                        r.status === 'approved' ? 'rgba(4,120,87,.1)' : 'rgba(186,26,26,.08)',
                    }}
                  >
                    {r.status === 'approved'
                      ? r.fleetBound
                        ? 'Approved · in fleet'
                        : 'Approved · not credited'
                      : 'Rejected'}
                  </span>
                )}
              </div>

              {r.notes ? (
                <p style={{ marginTop: 12, fontSize: 13.5, color: colors.muted }}>
                  Partner note: {r.notes}
                </p>
              ) : null}
              {r.status === 'rejected' && r.rejectionReason ? (
                <p style={{ marginTop: 12, fontSize: 13.5, color: colors.danger }}>
                  Reason given: {r.rejectionReason}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
