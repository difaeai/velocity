'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore';
import Link from 'next/link';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Button } from '@/components/ui';

interface Application {
  id: string;
  uid: string;
  status: 'pending' | 'approved' | 'rejected' | 'resubmit';
  carDetails: Record<string, unknown>;
  ownerName: string;
  ownerPhone: string;
  pricePerDay: number;
  submittedAt: number;
}

interface Listing {
  id: string;
  uid: string;
  status: 'active' | 'suspended';
  carDetails: Record<string, unknown>;
  ownerName: string;
  pricePerDay: number;
  createdAt: number;
}

export default function SpecialRidesAdminPage() {
  const [tab, setTab] = useState<'applications' | 'listings' | 'hosts'>('applications');
  const [applications, setApplications] = useState<Application[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    // Load applications
    const appQuery = query(
      collection(db, 'specialRidesApplications'),
      where('status', '==', 'pending')
    );

    const unsubscribeApps = onSnapshot(appQuery, (snapshot) => {
      const docs: Application[] = [];
      snapshot.forEach((doc) => {
        docs.push({
          id: doc.id,
          uid: doc.id,
          ...doc.data(),
        } as Application);
      });
      setApplications(docs);
    });

    // Load listings
    const listingQuery = query(
      collection(db, 'specialRidesListings'),
      where('status', 'in', ['active', 'suspended'])
    );

    const unsubscribeListings = onSnapshot(listingQuery, (snapshot) => {
      const docs: Listing[] = [];
      snapshot.forEach((doc) => {
        docs.push({
          id: doc.id,
          uid: doc.id,
          ...doc.data(),
        } as Listing);
      });
      setListings(docs);
      setLoading(false);
    });

    return () => {
      unsubscribeApps();
      unsubscribeListings();
    };
  }, []);

  async function approveApplication(uid: string) {
    setProcessingId(uid);
    try {
      // Call the admin function to approve
      const response = await fetch('/api/admin/special-rides/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, decision: 'approve' }),
      });

      if (response.ok) {
        alert('Application approved!');
        // Remove from pending list
        setApplications(applications.filter((app) => app.uid !== uid));
      } else {
        alert('Failed to approve');
      }
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  async function rejectApplication(uid: string, reason: string) {
    setProcessingId(uid);
    try {
      const response = await fetch('/api/admin/special-rides/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, decision: 'reject', rejectionReason: reason }),
      });

      if (response.ok) {
        alert('Application rejected');
        setApplications(applications.filter((app) => app.uid !== uid));
      } else {
        alert('Failed to reject');
      }
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  async function suspendListing(uid: string) {
    setProcessingId(uid);
    try {
      await updateDoc(doc(db, 'specialRidesListings', uid), {
        status: 'suspended',
      });
      alert('Listing suspended');
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  async function reactivateListing(uid: string) {
    setProcessingId(uid);
    try {
      await updateDoc(doc(db, 'specialRidesListings', uid), {
        status: 'active',
      });
      alert('Listing reactivated');
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 40 }}>
        <p style={{ color: colors.muted }}>Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Special Rides Management</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: `1px solid ${colors.border}` }}>
        <button
          onClick={() => setTab('applications')}
          style={{
            padding: '12px 16px',
            border: 'none',
            borderBottom: tab === 'applications' ? `2px solid ${colors.primary}` : 'none',
            background: 'none',
            color: tab === 'applications' ? colors.primary : colors.muted,
            fontWeight: tab === 'applications' ? 700 : 400,
            cursor: 'pointer',
          }}
        >
          Pending Applications ({applications.length})
        </button>
        <button
          onClick={() => setTab('listings')}
          style={{
            padding: '12px 16px',
            border: 'none',
            borderBottom: tab === 'listings' ? `2px solid ${colors.primary}` : 'none',
            background: 'none',
            color: tab === 'listings' ? colors.primary : colors.muted,
            fontWeight: tab === 'listings' ? 700 : 400,
            cursor: 'pointer',
          }}
        >
          Active Listings ({listings.length})
        </button>
      </div>

      {/* Applications Tab */}
      {tab === 'applications' && (
        <div>
          {applications.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.muted }}>
              <p>No pending applications</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {applications.map((app) => (
                <div
                  key={app.uid}
                  style={{
                    padding: 16,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    display: 'grid',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <h3 style={{ margin: 0, color: colors.text }}>
                        {(app.carDetails as any)?.year} {(app.carDetails as any)?.make}{' '}
                        {(app.carDetails as any)?.model}
                      </h3>
                      <p style={{ margin: '4px 0 0 0', fontSize: 14, color: colors.muted }}>
                        Owner: {app.ownerName} • {app.ownerPhone}
                      </p>
                      <p style={{ margin: '4px 0 0 0', fontSize: 14, color: colors.muted }}>
                        ₨{app.pricePerDay}/day • Submitted:{' '}
                        {new Date(app.submittedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      style={{
                        padding: '4px 12px',
                        background: '#FFF3CD',
                        color: '#856404',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      ⏳ Pending
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => approveApplication(app.uid)}
                      disabled={processingId === app.uid}
                      style={{
                        flex: 1,
                        background: colors.primary,
                        color: '#fff',
                        padding: '8px 12px',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => {
                        const reason = prompt('Rejection reason:');
                        if (reason) rejectApplication(app.uid, reason);
                      }}
                      disabled={processingId === app.uid}
                      style={{
                        flex: 1,
                        background: colors.danger,
                        color: '#fff',
                        padding: '8px 12px',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Listings Tab */}
      {tab === 'listings' && (
        <div>
          {listings.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.muted }}>
              <p>No active listings</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {listings.map((listing) => (
                <div
                  key={listing.uid}
                  style={{
                    padding: 16,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    display: 'grid',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <h3 style={{ margin: 0, color: colors.text }}>
                        {(listing.carDetails as any)?.year} {(listing.carDetails as any)?.make}{' '}
                        {(listing.carDetails as any)?.model}
                      </h3>
                      <p style={{ margin: '4px 0 0 0', fontSize: 14, color: colors.muted }}>
                        Owner: {listing.ownerName} • ₨{listing.pricePerDay}/day
                      </p>
                    </div>
                    <span
                      style={{
                        padding: '4px 12px',
                        background: listing.status === 'active' ? '#D4EDDA' : '#F8D7DA',
                        color: listing.status === 'active' ? '#155724' : '#721C24',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {listing.status === 'active' ? '✓ Active' : '⊗ Suspended'}
                    </span>
                  </div>

                  <div>
                    {listing.status === 'active' ? (
                      <button
                        onClick={() => suspendListing(listing.uid)}
                        disabled={processingId === listing.uid}
                        style={{
                          background: colors.danger,
                          color: '#fff',
                          padding: '8px 12px',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        onClick={() => reactivateListing(listing.uid)}
                        disabled={processingId === listing.uid}
                        style={{
                          background: colors.primary,
                          color: '#fff',
                          padding: '8px 12px',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
