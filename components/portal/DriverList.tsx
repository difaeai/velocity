'use client';

/**
 * The partner's submissions and where each one stands.
 *
 * A rejected row always shows the admin's reason. A partner who is only told
 * "rejected" resubmits the same record unchanged, and the queue grows.
 */
import { useState } from 'react';

import { portalApi, type PortalSubmission } from '@/lib/api';
import s from './portal.module.css';

const STATUS_COPY: Record<PortalSubmission['status'], { label: string; cls: string }> = {
  pending: { label: 'Awaiting Velocity', cls: 'pillPending' },
  approved: { label: 'Approved', cls: 'pillApproved' },
  rejected: { label: 'Not approved', cls: 'pillRejected' },
};

export function DriverList({
  portalId,
  drivers,
  onChanged,
}: {
  portalId: string;
  drivers: PortalSubmission[];
  onChanged: () => void | Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function withdraw(id: string, name: string) {
    if (!window.confirm(`Withdraw the submission for ${name}? This cannot be undone.`)) return;
    setBusyId(id);
    setError(null);
    try {
      await portalApi.withdrawSubmission({ portalId, submissionId: id });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not withdraw that submission.');
    } finally {
      setBusyId(null);
    }
  }

  if (drivers.length === 0) {
    return (
      <p className={s.empty}>
        No drivers yet. Add one above, or give a driver your promo code and they will join your
        fleet the moment they redeem it in the app.
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      <ul className={s.list}>
        {drivers.map((d) => {
          const status = STATUS_COPY[d.status];
          return (
            <li key={d.id} className={s.row}>
              <span className={s.rowMain}>
                <b>{d.fullName}</b>
                <small>
                  {d.phone} · {d.vehicleLabel} · {d.plate}
                </small>
                {d.status === 'rejected' && d.rejectionReason ? (
                  <em className={s.reason}>{d.rejectionReason}</em>
                ) : null}
                {d.status === 'approved' && !d.fleetBound ? (
                  <em className={s.reason}>
                    Approved as a driver, but not credited to your fleet — they already drove for
                    Velocity before you added them.
                  </em>
                ) : null}
              </span>

              <span className={`${s.pill} ${s[status.cls]}`}>{status.label}</span>

              {d.status === 'pending' ? (
                <button
                  type="button"
                  className={s.rowBtn}
                  onClick={() => withdraw(d.id, d.fullName)}
                  disabled={busyId === d.id}
                >
                  {busyId === d.id ? 'Withdrawing…' : 'Withdraw'}
                </button>
              ) : (
                <span className={s.rowBtnSpacer} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
