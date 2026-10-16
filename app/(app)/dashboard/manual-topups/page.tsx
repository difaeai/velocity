'use client';

/**
 * Bank-transfer top-ups our own OCR engine would not credit on its own.
 *
 * ── WHAT THIS QUEUE IS ───────────────────────────────────────────────────────
 *
 * domain/topupProof.ts has three verdicts, not two, and this page is the third
 * one. Anything it could not read confidently — a blurry screenshot, an amount
 * that disagrees with what the driver typed, a reference it could not find, a
 * recipient it could not match — is neither credited nor refused. It lands
 * here, because being strict costs an admin thirty seconds and being lenient
 * costs real money to anyone with an image editor.
 *
 * ── THE ONE THING TO GET RIGHT ───────────────────────────────────────────────
 *
 * **Credit what the receipt shows, not what the driver typed.** A top-up is
 * the one path where the screenshot decides the amount, so the typed figure is
 * a claim and the read figure is evidence. The backend defaults to the read
 * one for exactly this reason; this page puts them side by side and shouts when
 * they disagree, because a mismatch is the single most common reason a row is
 * sitting here and also what a forgery looks like.
 *
 * ── WHY `verifying` ROWS ARE HERE TOO ────────────────────────────────────────
 *
 * `verifying` is meant to last about a second. A row still in it minutes later
 * means the function died mid-check — a timeout, or an image big enough to run
 * it out of memory. Nothing retries that, so without this queue showing them, a
 * driver who really did pay would wait forever and nobody would ever know. They
 * are listed with the age showing, and they are safe to decide on: the credit
 * claims the receipt in the same transaction, so a late engine run cannot pay
 * twice.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

/** Keep in step with MIN_SINGLE/MAX_SINGLE in domain/topupProof.ts. */
const MIN_SINGLE = 100;
const MAX_SINGLE = 50000;

/** How long a row may sit in `verifying` before it is treated as stuck. */
const STUCK_AFTER_MS = 5 * 60 * 1000;

interface Topup {
  id: string;
  uid?: string;
  status: string;
  /** What the driver typed. A claim. */
  claimedAmount?: number;
  /** What our OCR read off the receipt. The evidence. */
  detectedAmount?: number | null;
  method?: string | null;
  proofPath?: string;
  ocrConfidence?: number;
  transactionRef?: string | null;
  refKey?: string | null;
  sourceApp?: string | null;
  recipientMatch?: boolean;
  reasons?: string[];
  message?: string | null;
  createdAt?: { seconds: number };
}

/** The machine-readable reasons, in words an admin can act on. */
const REASON_LABEL: Record<string, string> = {
  proof_unreadable: 'The image could not be opened at all.',
  ocr_unavailable: 'Our OCR engine was unavailable — nothing was read.',
  not_a_receipt: 'Does not read like a payment receipt (cropped, or not a receipt).',
  low_ocr_confidence: 'Too blurry to read confidently.',
  amount_unreadable: 'The amount could not be read.',
  no_transaction_reference: 'No transaction ID found on the receipt.',
  recipient_unmatched: 'Could not confirm the money was sent to a Velocity account.',
  amount_mismatch: 'The typed amount and the receipt disagree.',
  above_single_cap: `Over the PKR ${MAX_SINGLE.toLocaleString()} instant-credit cap.`,
  daily_auto_cap: 'Past this account’s daily instant-credit limit.',
  below_minimum: `Under the PKR ${MIN_SINGLE} minimum.`,
  image_replay: 'This exact image has been credited before.',
  duplicate_reference: 'This transaction reference has been credited before.',
  claimed_by_race: 'Another request credited this receipt first.',
};

/**
 * How long ago, against a clock passed in rather than read here.
 *
 * `Date.now()` during a render is impure — two renders of the same data would
 * disagree — so the page keeps the clock in state and ticks it. That also means
 * ages and the stuck flag stay current on a queue page left open all day,
 * instead of freezing until the next Firestore change.
 */
function ago(now: number, seconds?: number): string {
  if (!seconds) return 'just now';
  const mins = Math.floor((now - seconds * 1000) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ManualTopupsPage() {
  const [rows, setRows] = useState<Topup[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once in the lazy initialiser, then only ever from the interval's
  // callback — never in the render body, which has to stay pure. Nothing is
  // rendered from it on the server (the list is empty until Firestore answers),
  // so there is no hydration mismatch to worry about.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Single-field `in` filter — no composite index needed.
    return onSnapshot(
      query(collection(db, 'manualTopups'), where('status', 'in', ['pending_review', 'verifying'])),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Topup);
        // Oldest first: the driver who has waited longest is served first.
        list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
        setRows(list);
      },
      (e) => setError(e.message),
    );
  }, []);

  // Resolve screenshot download URLs (admin-readable per storage.rules).
  useEffect(() => {
    rows.forEach((r) => {
      if (r.proofPath && !urls[r.id]) {
        getDownloadURL(ref(storage, r.proofPath))
          .then((url) => setUrls((prev) => ({ ...prev, [r.id]: url })))
          .catch(() => undefined);
      }
    });
  }, [rows, urls]);

  const waiting = useMemo(
    () => rows.filter((r) => r.status === 'pending_review').length,
    [rows],
  );

  async function review(r: Topup, approve: boolean, overrideAmount?: number) {
    setBusy(r.id);
    setError(null);
    try {
      let note: string | undefined;
      if (!approve) {
        note = window.prompt('Why is this not being credited? (shown to the driver)') ?? undefined;
        if (note === undefined) { setBusy(null); return; }
      }
      await adminApi.adminReviewManualTopup({
        topupId: r.id,
        approve,
        amount: overrideAmount,
        note,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Credit something other than what the engine read.
   *
   * Kept behind a prompt rather than an always-visible input: the default is
   * correct almost every time, and an editable amount next to an Approve button
   * invites an admin to credit the claim instead of the evidence.
   */
  async function approveOther(r: Topup) {
    const typed = window.prompt(
      `Credit how much? The receipt reads ${
        r.detectedAmount != null ? `PKR ${r.detectedAmount.toLocaleString()}` : 'nothing we could parse'
      }; the driver typed PKR ${(r.claimedAmount ?? 0).toLocaleString()}.`,
      String(r.detectedAmount ?? r.claimedAmount ?? ''),
    );
    if (typed === null) return;
    const amount = parseInt(typed.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(amount) || amount < MIN_SINGLE || amount > MAX_SINGLE) {
      setError(`Enter an amount between PKR ${MIN_SINGLE} and ${MAX_SINGLE.toLocaleString()}.`);
      return;
    }
    await review(r, true, amount);
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Balance top-ups</h1>
      <p style={{ color: colors.muted, marginBottom: 24, maxWidth: 760 }}>
        Bank-transfer top-ups our engine would not credit by itself. Open the screenshot and check
        it against Velocity Rides&apos; account, then credit{' '}
        <strong style={{ color: colors.text }}>the amount the receipt shows</strong> — not the one
        the driver typed. The two are shown side by side below.
      </p>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}

      {rows.length === 0 ? (
        <Card><div style={{ color: colors.muted }}>No top-ups awaiting review. 🎉</div></Card>
      ) : (
        <>
          <div style={{ color: colors.muted, fontSize: 13, marginBottom: 14 }}>
            {waiting} awaiting review
            {rows.length - waiting > 0 ? ` · ${rows.length - waiting} still being checked` : ''}
          </div>
          <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
            {rows.map((r) => {
              const claimed = r.claimedAmount ?? 0;
              const detected = r.detectedAmount ?? null;
              const mismatch = detected != null && detected !== claimed;
              const stuck =
                r.status === 'verifying'
                && now - (r.createdAt?.seconds ?? 0) * 1000 > STUCK_AFTER_MS;

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
                      <div style={{ width: 160, height: 220, borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.muted, fontSize: 12, textAlign: 'center', padding: 8 }}>
                        {r.proofPath ? 'Loading…' : 'No screenshot'}
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 260 }}>
                      {/* ── Claimed vs read. The decision lives here. ── */}
                      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 4 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.muted }}>
                            Receipt reads
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: detected != null ? colors.text : colors.danger }}>
                            {detected != null ? `PKR ${detected.toLocaleString()}` : 'unreadable'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.muted }}>
                            Driver typed
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: mismatch ? colors.danger : colors.muted }}>
                            PKR {claimed.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {mismatch && (
                        <div style={{ fontSize: 12, fontWeight: 700, color: colors.danger, marginBottom: 8 }}>
                          ⚠️ These disagree. Credit what the screenshot shows, or reject it.
                        </div>
                      )}

                      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
                        Driver {(r.uid ?? 'unknown').slice(0, 8)}… · via {r.method ?? 'unknown'} ·{' '}
                        {ago(now, r.createdAt?.seconds)}
                        {stuck && (
                          <strong style={{ color: colors.danger }}>
                            {' '}· stuck mid-check — the engine never finished
                          </strong>
                        )}
                      </div>

                      {/* ── What the engine found ── */}
                      <div style={{ background: colors.bg, borderRadius: 10, padding: 12, border: `1px solid ${colors.border}`, marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
                          What our engine read
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: colors.muted, lineHeight: 1.6 }}>
                          <li>
                            Sent to a Velocity account:{' '}
                            <strong style={{ color: r.recipientMatch ? colors.success : colors.danger }}>
                              {r.recipientMatch ? 'yes' : 'not confirmed'}
                            </strong>
                          </li>
                          <li>
                            Transaction ID:{' '}
                            <strong style={{ color: r.transactionRef ? colors.text : colors.danger }}>
                              {r.transactionRef || 'not found'}
                            </strong>
                          </li>
                          <li>
                            OCR confidence:{' '}
                            <strong>{r.ocrConfidence != null ? `${r.ocrConfidence}%` : '—'}</strong>
                          </li>
                          <li>Receipt layout: <strong>{r.sourceApp || 'unrecognised'}</strong></li>
                        </ul>
                        {r.reasons && r.reasons.length > 0 && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${colors.border}` }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
                              Why it stopped
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: colors.muted, lineHeight: 1.6 }}>
                              {r.reasons
                                .filter((x) => x !== 'auto_approved')
                                .map((x) => <li key={x}>{REASON_LABEL[x] ?? x}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <Button
                          onClick={() => review(r, true)}
                          disabled={busy === r.id || detected == null}
                        >
                          {busy === r.id
                            ? 'Working…'
                            : detected != null
                              ? `Credit PKR ${detected.toLocaleString()}`
                              : 'Credit (no amount read)'}
                        </Button>
                        <Button variant="ghost" onClick={() => approveOther(r)} disabled={busy === r.id}>
                          Credit another amount…
                        </Button>
                        <Button variant="secondary" onClick={() => review(r, false)} disabled={busy === r.id}>
                          Reject
                        </Button>
                      </div>
                      <div style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
                        Crediting also clears any commission lock this driver is under.
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
