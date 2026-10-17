'use client';

/**
 * The accounts Velocity receives money into.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────────────
 *
 * `config/settlementAccounts` is the one document the whole manual-money side
 * of the product stands on, and until this page there was no way to write it:
 * `adminSetSettlementAccounts` had been live in the backend for months with no
 * caller anywhere. An empty document is not a quiet default — it breaks three
 * things at once, silently:
 *
 *   1. A commission-locked driver sees "Velocity Rides' payment account isn't
 *      set up yet" and **cannot settle at all**, so the lock never lifts.
 *   2. The balance top-up sheet has no account to show, so nobody can pay in.
 *   3. `parseRecipientMatch` in domain/topupProof.ts has nothing to match
 *      against, so `recipientMatch` is false on every receipt and **every**
 *      top-up is routed to the admin queue instead of being credited — the
 *      engine looks broken when in fact it was never told who it is.
 *
 * ── THE NUMBERS HERE ARE PAID TO BY REAL DRIVERS ─────────────────────────────
 *
 * Whatever is saved on this page is what the app tells drivers to send money
 * to. A typo does not fail loudly; it sends somebody's commission to a
 * stranger's wallet. Hence: a confirm step that shows what is about to be
 * published, no silent clearing of fields, and a visible note of which fields
 * are currently missing.
 */

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

/** Field keys, their labels, and what the app does with each. */
const FIELDS = [
  {
    key: 'accountTitle',
    label: 'Account title',
    hint: 'The name drivers will see as the recipient. Should match what their banking app shows after the transfer.',
    placeholder: 'Berreto (Private) Limited',
    max: 80,
  },
  {
    key: 'easypaisaNumber',
    label: 'Easypaisa number',
    hint: 'Leave empty to hide Easypaisa as an option in the app.',
    placeholder: '03XXXXXXXXX',
    max: 20,
  },
  {
    key: 'jazzcashNumber',
    label: 'JazzCash number',
    hint: 'Leave empty to hide JazzCash as an option in the app.',
    placeholder: '03XXXXXXXXX',
    max: 20,
  },
  {
    key: 'bankName',
    label: 'Bank name',
    hint: 'Shown next to the IBAN so drivers pick the right bank.',
    placeholder: 'Meezan Bank',
    max: 80,
  },
  {
    key: 'bankIban',
    label: 'IBAN',
    hint: 'Leave empty to hide bank transfer as an option. The OCR also matches receipts on the last digits of this.',
    placeholder: 'PK00MEZN0000000000000000',
    max: 40,
  },
] as const;

type Key = (typeof FIELDS)[number]['key'];
type Values = Partial<Record<Key, string>>;

export default function ReceivingAccountsPage() {
  const [saved, setSaved] = useState<Values | null>(null);
  const [form, setForm] = useState<Values>({});
  const seeded = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    return onSnapshot(
      doc(db, 'config', 'settlementAccounts'),
      (s) => {
        const d = (s.exists() ? s.data() : {}) as Values;
        setSaved(d);
        // Seed the editable copy once only, so a live update from another admin
        // cannot overwrite what is being typed here mid-edit.
        if (!seeded.current) {
          seeded.current = true;
          setForm(d);
        }
      },
      (e) => setError(e.message),
    );
  }, []);

  const missing = FIELDS.filter((f) => !saved?.[f.key]).map((f) => f.label);
  const nothingSet = saved !== null && FIELDS.every((f) => !saved[f.key]);
  const dirty = FIELDS.some((f) => (form[f.key] ?? '') !== (saved?.[f.key] ?? ''));

  async function save() {
    setError(null);
    // The changed fields only — the callable merge-writes, so sending the whole
    // form would rewrite untouched values with whatever this page last read.
    const changed = FIELDS.filter((f) => (form[f.key] ?? '') !== (saved?.[f.key] ?? ''));
    if (changed.length === 0) return;

    const summary = changed
      .map((f) => `${f.label}: ${(form[f.key] ?? '').trim() || '(cleared)'}`)
      .join('\n');
    if (!window.confirm(
      `Drivers will be told to send money to these. Publish?\n\n${summary}`,
    )) return;

    setBusy(true);
    try {
      const payload: Values = {};
      for (const f of changed) payload[f.key] = (form[f.key] ?? '').trim();
      await adminApi.adminSetSettlementAccounts(payload);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Receiving accounts</h1>
      <p style={{ color: colors.muted, marginBottom: 20, maxWidth: 720 }}>
        Where drivers send money when they settle commission or top up a balance. The app shows
        exactly what is saved here, and our receipt OCR matches these numbers to confirm a payment
        really came to us.
      </p>

      {nothingSet && (
        <Card style={{ borderColor: colors.danger, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, color: colors.danger, marginBottom: 6 }}>
            Nothing is set — three things are broken right now
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: colors.muted, fontSize: 13, lineHeight: 1.7 }}>
            <li>A commission-locked driver has no account to pay and cannot unlock.</li>
            <li>Balance top-ups cannot be started at all.</li>
            <li>Every uploaded receipt fails the recipient check, so nothing auto-credits.</li>
          </ul>
        </Card>
      )}

      {!nothingSet && missing.length > 0 && (
        <Card style={{ borderColor: colors.primary, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: colors.muted }}>
            Not set: <strong style={{ color: colors.text }}>{missing.join(', ')}</strong>. Each
            empty payment method is simply hidden in the app.
          </div>
        </Card>
      )}

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}

      <Card style={{ maxWidth: 560 }}>
        <div style={{ display: 'grid', gap: 18 }}>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label
                htmlFor={f.key}
                style={{ display: 'block', fontSize: 13, fontWeight: 800, color: colors.text, marginBottom: 4 }}
              >
                {f.label}
              </label>
              <input
                id={f.key}
                value={form[f.key] ?? ''}
                maxLength={f.max}
                placeholder={f.placeholder}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: colors.text,
                  fontSize: 14,
                  fontFamily: f.key === 'bankIban' ? 'monospace' : undefined,
                }}
              />
              <div style={{ fontSize: 11.5, color: colors.muted, marginTop: 4, lineHeight: 1.5 }}>
                {f.hint}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button onClick={save} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Publish to the app'}
            </Button>
            {done && <span style={{ color: colors.success, fontWeight: 700, fontSize: 13 }}>✓ Saved</span>}
            {!dirty && !done && (
              <span style={{ color: colors.muted, fontSize: 12 }}>No changes to publish.</span>
            )}
          </div>
        </div>
      </Card>

      <p style={{ color: colors.muted, fontSize: 12, marginTop: 16, maxWidth: 560, lineHeight: 1.6 }}>
        Every change is written to <code>auditLogs</code> with your admin id. Drivers see the new
        details immediately — there is no app release in between.
      </p>
    </div>
  );
}
