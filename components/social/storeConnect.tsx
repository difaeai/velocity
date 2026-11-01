'use client';

/**
 * The owner's WooCommerce store on Connected accounts: name the store, approve
 * a read-only key on its own WordPress, and from then on the month's orders —
 * how many the ads brought, per campaign — beside what the ads cost. Totals
 * only: no customer's name, phone or address is ever read into Velocity.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { useWorkspace } from '@/lib/workspace';
import { storeApi, type StoreDoc } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { adMoney } from '@/components/social/ads';

export function StoreConnect() {
  const { path } = useWorkspace();
  const [store, setStore] = useState<StoreDoc | null | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, path('system/store')),
        (snap) => setStore(snap.exists() ? (snap.data() as StoreDoc) : null),
        () => setStore(null),
      ),
    [path],
  );

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const s = store?.sales;
  const fromAds = s ? Object.values(s.byCampaign).reduce((n, c) => n + c.weekOrders, 0) : 0;

  return (
    <Card style={{ marginBottom: 16 }}>
      <div id="store" style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 17, fontWeight: 900, margin: 0 }}>Your store’s sales (WooCommerce)</h2>
        {store ? <span style={{ fontSize: 12.5, color: colors.success, fontWeight: 800 }}>Connected · {store.url}</span> : null}
      </div>
      <p style={{ fontSize: 13, color: colors.muted, margin: '6px 0 12px', lineHeight: 1.55 }}>
        Every ad the Ad Expert makes tags its link with the campaign, and WooCommerce records it on each order — so your
        store tells the expert which campaign brought which sale, and it judges ROAS on real money. You approve a{' '}
        <strong>read-only</strong> key on your own store; only totals are kept, never a customer’s details.
      </p>

      {store === undefined ? null : store ? (
        <>
          {s ? (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
              <span>
                <strong>{s.week.orders.toLocaleString('en-PK')}</strong> orders this week ·{' '}
                {adMoney(s.week.revenue, s.currency || 'PKR')}
              </span>
              <span>
                <strong>{fromAds.toLocaleString('en-PK')}</strong> of them from your ads
              </span>
              <span style={{ color: colors.muted }}>
                Where the month’s orders came from: {s.sources.map((x) => `${x.source} ${x.orders}`).join(' · ') || '—'}
              </span>
            </div>
          ) : null}
          {store.lastStatus ? <p style={{ fontSize: 12.5, color: colors.muted, margin: '8px 0 0' }}>{store.lastStatus}</p> : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button variant="ghost" disabled={busy !== null} onClick={() => run('sync', async () => void (await storeApi.syncNow({})))}>
              {busy === 'sync' ? 'Reading the orders…' : 'Read orders now'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() =>
                confirm('Disconnect the store? Its key is deleted here; delete it on WooCommerce → Settings → Advanced → REST API too.') &&
                run('off', async () => void (await storeApi.disconnect({})))
              }
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label htmlFor="store-url" style={{ position: 'absolute', left: -9999 }}>
            Store address
          </label>
          <input
            id="store-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourstore.pk"
            style={{
              flex: 1,
              minWidth: 220,
              height: 38,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: '0 12px',
              fontSize: 14,
            }}
          />
          <Button
            disabled={busy !== null || url.trim().length < 4}
            onClick={() =>
              run('connect', async () => {
                const { authorizeUrl } = await storeApi.startConnect({ url });
                window.location.href = authorizeUrl;
              })
            }
          >
            {busy === 'connect' ? 'Opening your store…' : 'Connect WooCommerce'}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: '8px 0 0' }}>
          {error}
        </p>
      ) : null}
    </Card>
  );
}
