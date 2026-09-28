'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { adminApi } from '@/lib/api';
import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';

interface Photo {
  url: string;
  uploadedAt: number;
}

/** Only what the cards print. Year can be null: a cleared field on the app. */
interface CarDetails {
  year?: number | null;
  make?: string;
  model?: string;
}

interface Application {
  id: string;
  uid: string;
  status: 'pending' | 'approved' | 'rejected' | 'resubmit';
  carDetails: CarDetails;
  ownerName: string;
  ownerPhone: string;
  pricePerDay: number;
  photos?: Photo[];
  documentUrls?: { insuranceProof?: string; vehicleRegistration?: string };
  submittedAt: number;
}

const DOCUMENTS = [
  { key: 'insuranceProof', label: 'Insurance proof' },
  { key: 'vehicleRegistration', label: 'Vehicle registration' },
] as const;

/**
 * The backend refuses to approve without both papers (app builds up to 1.12.0
 * could not upload them), so the console says so up front instead of letting
 * Approve fail.
 */
function hasBothDocuments(app: Application): boolean {
  return Boolean(app.documentUrls?.insuranceProof && app.documentUrls?.vehicleRegistration);
}

/** The host's papers, opened in a new tab. A missing one is called out, not hidden. */
function DocumentLinks({ app }: { app: Application }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {DOCUMENTS.map(({ key, label }) => {
        const url = app.documentUrls?.[key];
        // Only ever an https link: these values come from a client.
        return url && url.startsWith('https://') ? (
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '4px 10px',
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              fontSize: 13,
              color: colors.primary,
              textDecoration: 'none',
            }}
          >
            📄 {label}
          </a>
        ) : (
          <span
            key={key}
            style={{
              padding: '4px 10px',
              background: '#FFF3CD',
              color: '#856404',
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            ⚠ {label}: not provided
          </span>
        );
      })}
    </div>
  );
}

interface Listing {
  id: string;
  uid: string;
  status: 'active' | 'suspended';
  carDetails: CarDetails;
  ownerName: string;
  pricePerDay: number;
  photos?: Photo[];
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

  /**
   * All four actions go through the callables, which is the only path that
   * actually works.
   *
   * Approve and Reject used to POST to /api/admin/special-rides/... — routes
   * that do not exist in this app — so they 404'd and said "Failed to approve".
   * Suspend and Reactivate wrote to specialRidesListings directly from the
   * browser, which the rules refuse (`allow write: if false`) for everybody,
   * admins included. The backend does the write with the Admin SDK after
   * checking the admin claim.
   *
   * The lists are live `onSnapshot` queries, so nothing is spliced out of state
   * by hand any more: the server's write is what removes the row, which means
   * the screen can no longer disagree with the database.
   */
  async function approveApplication(uid: string) {
    setProcessingId(uid);
    try {
      await adminApi.adminReviewSpecialRidesApplication({ uid, decision: 'approve' });
    } catch (e) {
      alert('Could not approve: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  async function rejectApplication(uid: string, reason: string) {
    setProcessingId(uid);
    try {
      await adminApi.adminReviewSpecialRidesApplication({
        uid,
        decision: 'reject',
        rejectionReason: reason,
      });
    } catch (e) {
      alert('Could not reject: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  /** Sends the application back to the host, who sees this reason in the app. */
  async function requestDocuments(uid: string) {
    setProcessingId(uid);
    try {
      await adminApi.adminReviewSpecialRidesApplication({
        uid,
        decision: 'resubmit',
        rejectionReason:
          'Please update the app and add photos of your car insurance and vehicle registration.',
      });
    } catch (e) {
      alert('Could not request documents: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  async function suspendListing(uid: string) {
    setProcessingId(uid);
    try {
      await adminApi.adminSuspendHost({ uid, suspended: true });
    } catch (e) {
      alert('Could not suspend: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  async function reactivateListing(uid: string) {
    setProcessingId(uid);
    try {
      await adminApi.adminSuspendHost({ uid, suspended: false });
    } catch (e) {
      alert('Could not reactivate: ' + (e as Error).message);
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
                        {app.carDetails?.year} {app.carDetails?.make} {app.carDetails?.model}
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

                  {app.photos && app.photos.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {app.photos.map((photo, idx) => (
                        <div
                          key={idx}
                          style={{
                            position: 'relative',
                            width: '100%',
                            paddingBottom: '100%',
                            overflow: 'hidden',
                            borderRadius: 4,
                          }}
                        >
                          {/* A plain <img>, like every other document and photo
                              in this console. `next/image` refuses any hostname
                              that is not listed under `images` in next.config.ts,
                              and nothing is — so the moment an application with
                              photos appeared, rendering this page threw
                              "hostname is not configured" and the queue could
                              not be looked at, let alone approved. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={`Car photo ${idx + 1}`}
                            style={{
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <DocumentLinks app={app} />

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => approveApplication(app.uid)}
                      disabled={processingId === app.uid || !hasBothDocuments(app)}
                      title={hasBothDocuments(app) ? undefined : 'Both documents are needed before approval'}
                      style={{
                        flex: 1,
                        background: colors.primary,
                        color: '#fff',
                        padding: '8px 12px',
                        border: 'none',
                        borderRadius: 4,
                        cursor: hasBothDocuments(app) ? 'pointer' : 'not-allowed',
                        opacity: hasBothDocuments(app) ? 1 : 0.5,
                        fontWeight: 600,
                      }}
                    >
                      ✓ Approve
                    </button>
                    {!hasBothDocuments(app) && (
                      <button
                        onClick={() => requestDocuments(app.uid)}
                        disabled={processingId === app.uid}
                        style={{
                          flex: 1,
                          background: 'none',
                          color: colors.primary,
                          padding: '8px 12px',
                          border: `1px solid ${colors.primary}`,
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Ask for documents
                      </button>
                    )}
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
                        {listing.carDetails?.year} {listing.carDetails?.make} {listing.carDetails?.model}
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

                  {listing.photos && listing.photos.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {listing.photos.map((photo, idx) => (
                        <div
                          key={idx}
                          style={{
                            position: 'relative',
                            width: '100%',
                            paddingBottom: '100%',
                            overflow: 'hidden',
                            borderRadius: 4,
                          }}
                        >
                          {/* A plain <img>, like every other document and photo
                              in this console. `next/image` refuses any hostname
                              that is not listed under `images` in next.config.ts,
                              and nothing is — so the moment an application with
                              photos appeared, rendering this page threw
                              "hostname is not configured" and the queue could
                              not be looked at, let alone approved. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={`Car photo ${idx + 1}`}
                            style={{
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

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
