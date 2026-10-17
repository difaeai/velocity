/**
 * The emergency-contact list, stored and watched.
 *
 * ONE DOCUMENT, NOT A SUBCOLLECTION. Five rows is not a collection — it is a
 * field — and keeping it as one document buys two things that matter here:
 *
 *   the limit is enforceable  A security rule can check `contacts.size() <= 5`
 *                             on a single document. Counting documents in a
 *                             subcollection from a rule is not possible, so the
 *                             cap would live only in the app, where a modified
 *                             client could ignore it.
 *   the SOS reads it once     One `getDoc`/snapshot, not a query — the list is
 *                             already in memory before the button is pressed,
 *                             which is the only latency budget that counts.
 *
 * Lives at users/{uid}/safety/emergencyContacts. Owner-only, both ways: these
 * are other people's phone numbers and nobody else in the product needs them.
 */
import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

import { db } from '../firebase';
import { MAX_EMERGENCY_CONTACTS, type EmergencyContact } from '../lib/sos';

/** Where the list lives. Mirrored by the rule in firestore.rules. */
export function emergencyContactsPath(uid: string): [string, string, string, string] {
  return ['users', uid, 'safety', 'emergencyContacts'];
}

/**
 * Read a stored row back defensively.
 *
 * Firestore hands back whatever was written, and a row that lost its phone
 * number to an old client or a half-finished migration must not survive into
 * an SOS as `undefined` — the deep link would open a chat with nobody.
 */
function parseContact(raw: unknown): EmergencyContact | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : null;
  const name = typeof r.name === 'string' ? r.name : null;
  const phone = typeof r.phone === 'string' ? r.phone.replace(/\D/g, '') : '';
  if (!id || !name || phone.length < 10) return null;
  return {
    id,
    name,
    phone,
    whatsappCheckedAt: typeof r.whatsappCheckedAt === 'number' ? r.whatsappCheckedAt : null,
  };
}

export interface EmergencyContactsState {
  contacts: EmergencyContact[];
  /** True until the first snapshot lands, so the UI can tell empty from unknown. */
  loading: boolean;
  /** Replace the whole list. Rejects anything over the cap before it hits the rule. */
  save: (next: readonly EmergencyContact[]) => Promise<void>;
}

export function useEmergencyContacts(uid?: string): EmergencyContactsState {
  /**
   * Tagged with the uid it was read for.
   *
   * Signing out, or switching accounts, must never leave one person's
   * emergency contacts on another person's SOS screen — and the tag settles
   * that without clearing state from inside an effect: a list read for a
   * different uid is simply not surfaced. It is also what "loading" means
   * here, so nothing has to be reset when the uid changes.
   */
  const [state, setState] = useState<{ uid: string | null; contacts: EmergencyContact[] }>({
    uid: null,
    contacts: [],
  });

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      doc(db, ...emergencyContactsPath(uid)),
      (snap) => {
        const rows = (snap.data()?.contacts as unknown[] | undefined) ?? [];
        setState({
          uid,
          contacts: rows
            .map(parseContact)
            .filter((c): c is EmergencyContact => c !== null)
            .slice(0, MAX_EMERGENCY_CONTACTS),
        });
      },
      // A read that fails resolves to an empty list rather than a stuck
      // spinner: the screen then offers to add contacts, which is the state a
      // user can actually get out of.
      () => setState({ uid, contacts: [] }),
    );
    return unsub;
  }, [uid]);

  const mine = !!uid && state.uid === uid;
  const contacts = mine ? state.contacts : [];
  const loading = !!uid && !mine;

  const save = useCallback(
    async (next: readonly EmergencyContact[]) => {
      if (!uid) throw new Error('Sign in to save emergency contacts.');
      if (next.length > MAX_EMERGENCY_CONTACTS) {
        throw new Error(`You can have ${MAX_EMERGENCY_CONTACTS} emergency contacts.`);
      }
      await setDoc(
        doc(db, ...emergencyContactsPath(uid)),
        {
          contacts: next.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            whatsappCheckedAt: c.whatsappCheckedAt ?? null,
          })),
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    },
    [uid],
  );

  return { contacts, loading, save };
}
