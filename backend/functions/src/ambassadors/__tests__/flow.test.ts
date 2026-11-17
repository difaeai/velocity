/**
 * Velocity Ambassador Program, end to end, against the emulator.
 *
 * The whole life of an ambassador: apply with one document, get approved, hand
 * out the code, watch the two counters move, add a bank account, get paid.
 *
 * The things that must never regress, because each of them is somebody's
 * salary:
 *   - one recruit counts once, for ever — the 100 is what unlocks PKR 50,000;
 *   - a plan sale counts once even if an admin re-approves the application;
 *   - the ambassador's code and a partner's code share one box in the profile
 *     and never collide;
 *   - an ambassador's recruit earns the ambassador NOTHING per ride — they are
 *     paid on targets, not on fares;
 *   - a bank account can only be set by its owner, and only after approval.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import {
  adminListAmbassadors,
  adminReviewAmbassador,
  applyAmbassador,
  getMyAmbassador,
  setAmbassadorPayout,
} from '../index';
import { claimPartnerReferral } from '../../partners/referrals';

const AMB = 'amb1';
const ADMIN = 'admin1';
const RECRUIT = 'recruit1';

/** A storage URL that passes the "our own bucket" check. */
const DOC_URL = 'https://firebasestorage.googleapis.com/v0/b/x/o/cv.pdf';

/**
 * Call a callable as `uid`. `admin` puts the admin role on the token, which is
 * where requireAdmin reads it from (lib/guards.ts requireAuth).
 */
function call<T>(fn: unknown, data: unknown, uid: string, admin = false): Promise<T> {
  const req = makeReq(data, uid) as unknown as {
    auth: { uid: string; token: Record<string, unknown> };
  };
  if (admin) req.auth.token.role = 'admin';
  // `.run` is the handler without the HTTP wrapper, which is what the other
  // callable suites use — the wrapper wants a real request to stream from.
  return (fn as { run: (r: unknown) => Promise<T> }).run(req);
}

async function approvedAmbassador(): Promise<string> {
  await call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB);
  const res = await call<{ code: string }>(
    adminReviewAmbassador,
    { uid: AMB, decision: 'approve' },
    ADMIN,
    true,
  );
  return res.code;
}

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${AMB}`).set({ name: 'Hassan Raza', phoneNumber: '+923001234567' });
  await db().doc(`users/${RECRUIT}`).set({ name: 'Ayesha Khan', phoneNumber: '+923009999999' });
});

describe('applying', () => {
  it('takes a CV or a CNIC, and the name off the profile', async () => {
    await call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB);
    const app = await db().doc(`ambassadorApplications/${AMB}`).get();
    expect(app.get('status')).toBe('pending');
    // Never typed into a form — taken from the account (owner).
    expect(app.get('fullName')).toBe('Hassan Raza');
    expect(app.get('mobile')).toBe('+923001234567');
  });

  it('accepts a CNIC photo instead of a CV', async () => {
    await call(applyAmbassador, { cnicUrl: DOC_URL, acceptedTerms: true }, AMB);
    expect((await db().doc(`ambassadorApplications/${AMB}`).get()).get('cnicUrl')).toBe(DOC_URL);
  });

  it('refuses an application with neither document', async () => {
    await expect(call(applyAmbassador, { acceptedTerms: true }, AMB)).rejects.toThrow(
      /CV or a photo of your CNIC/i,
    );
  });

  it('refuses a document hosted somewhere that is not ours', async () => {
    await expect(
      call(applyAmbassador, { cvUrl: 'https://evil.example.com/cv.pdf', acceptedTerms: true }, AMB),
    ).rejects.toThrow(/upload your document/i);
  });

  it('refuses somebody with no name on their profile, and says what to do', async () => {
    await db().doc(`users/${AMB}`).set({ displayName: 'New User' });
    await expect(
      call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB),
    ).rejects.toThrow(/add your name/i);
  });

  it('refuses a second application while one is waiting', async () => {
    await call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB);
    await expect(
      call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB),
    ).rejects.toThrow(/already waiting/i);
  });
});

describe('approval', () => {
  it('mints a code and opens the board at zero', async () => {
    const code = await approvedAmbassador();
    expect(code).toMatch(/^\d{5}$/);

    const me = await call<{ stage: string; progress: { usersRemaining: number; partnersRemaining: number } }>(
      getMyAmbassador,
      {},
      AMB,
    );
    expect(me.stage).toBe('active');
    expect(me.progress.usersRemaining).toBe(100);
    expect(me.progress.partnersRemaining).toBe(15);
  });

  it('refuses a rejection with no reason — the applicant must know what to fix', async () => {
    await call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB);
    await expect(
      call(adminReviewAmbassador, { uid: AMB, decision: 'reject' }, ADMIN, true),
    ).rejects.toThrow(/reason/i);
  });

  it('keeps the same code if an admin approves twice — posters already carry it', async () => {
    const first = await approvedAmbassador();
    await db().doc(`ambassadorApplications/${AMB}`).set({ status: 'pending' }, { merge: true });
    const again = await call<{ code: string }>(
      adminReviewAmbassador,
      { uid: AMB, decision: 'approve' },
      ADMIN,
      true,
    );
    expect(again.code).toBe(first);
  });

  it('is refused to a non-admin', async () => {
    await call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB);
    await expect(
      call(adminReviewAmbassador, { uid: AMB, decision: 'approve' }, RECRUIT),
    ).rejects.toThrow();
  });
});

describe('the 100-user target', () => {
  it('counts a recruit who puts the code in their profile', async () => {
    const code = await approvedAmbassador();
    await call(claimPartnerReferral, { code }, RECRUIT);

    const me = await call<{ progress: { usersOnboarded: number; usersRemaining: number } }>(
      getMyAmbassador,
      {},
      AMB,
    );
    expect(me.progress.usersOnboarded).toBe(1);
    // The countdown the owner described: 99, then 98…
    expect(me.progress.usersRemaining).toBe(99);
  });

  it('counts one recruit once, however many times they try', async () => {
    const code = await approvedAmbassador();
    await call(claimPartnerReferral, { code }, RECRUIT);
    await expect(call(claimPartnerReferral, { code }, RECRUIT)).rejects.toThrow(/already linked/i);

    const me = await call<{ progress: { usersOnboarded: number } }>(getMyAmbassador, {}, AMB);
    expect(me.progress.usersOnboarded).toBe(1);
  });

  it('refuses an ambassador redeeming their own code', async () => {
    const code = await approvedAmbassador();
    await expect(call(claimPartnerReferral, { code }, AMB)).rejects.toThrow(/your own/i);
  });

  it('refuses a code whose ambassador is not approved', async () => {
    await call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB);
    // A code only exists after approval, so nothing resolves yet.
    await expect(call(claimPartnerReferral, { code: '12345' }, RECRUIT)).rejects.toThrow(
      /does not exist/i,
    );
  });

  it('binds no fleet — an ambassador earns nothing per ride', async () => {
    const code = await approvedAmbassador();
    await call(claimPartnerReferral, { code }, RECRUIT);
    const edge = await db().doc(`ambassador_referrals/${RECRUIT}`).get();
    expect(edge.get('ambassadorId')).toBe(AMB);
    // The per-ride commission path reads passenger_referrals; an ambassador's
    // recruit must not appear there, or every ride they take would pay out.
    expect((await db().doc(`passenger_referrals/${RECRUIT}`).get()).exists).toBe(false);
  });
});

describe('the 15-partner target', () => {
  /** Approving a partner application is what makes a sale a sale. */
  async function approvePartnerFor(uid: string) {
    const { adminReviewPartnerApplication } = await import('../../partners/applications');
    await db().doc(`partner_applications/${uid}`).set({
      uid,
      status: 'pending',
      tier: 'free',
      fullName: 'Ayesha Khan',
      mobile: '+923009999999',
      proMonths: 3,
    });
    await call(adminReviewPartnerApplication, { uid, decision: 'approve' }, ADMIN, true);
  }

  it('counts when an ambassador’s recruit buys an Earn with Velocity plan', async () => {
    const code = await approvedAmbassador();
    await call(claimPartnerReferral, { code }, RECRUIT);
    await approvePartnerFor(RECRUIT);

    const me = await call<{ progress: { partnersSold: number; partnersRemaining: number } }>(
      getMyAmbassador,
      {},
      AMB,
    );
    expect(me.progress.partnersSold).toBe(1);
    expect(me.progress.partnersRemaining).toBe(14);
  });

  it('counts that sale once, even if the application is approved again', async () => {
    const code = await approvedAmbassador();
    await call(claimPartnerReferral, { code }, RECRUIT);
    await approvePartnerFor(RECRUIT);
    // An admin re-opening and re-approving must not pay for the same sale twice.
    await db().doc(`partner_applications/${RECRUIT}`).set({ status: 'pending' }, { merge: true });
    await db().doc(`partners/${RECRUIT}`).delete();
    await approvePartnerFor(RECRUIT);

    const me = await call<{ progress: { partnersSold: number } }>(getMyAmbassador, {}, AMB);
    expect(me.progress.partnersSold).toBe(1);
  });

  it('counts nothing for a partner nobody referred', async () => {
    await approvedAmbassador();
    await approvePartnerFor(RECRUIT);
    const me = await call<{ progress: { partnersSold: number } }>(getMyAmbassador, {}, AMB);
    expect(me.progress.partnersSold).toBe(0);
  });
});

describe('the bank account', () => {
  it('is set by the ambassador after approval', async () => {
    await approvedAmbassador();
    await call(
      setAmbassadorPayout,
      { accountTitle: 'Hassan Raza', accountNumber: 'PK36SCBL0000001123456702', bankName: 'HBL' },
      AMB,
    );
    const me = await call<{ payoutAccount: { bankName: string } }>(getMyAmbassador, {}, AMB);
    expect(me.payoutAccount.bankName).toBe('HBL');
  });

  it('cannot be set before approval — we hold no bank details for a stranger', async () => {
    await call(applyAmbassador, { cvUrl: DOC_URL, acceptedTerms: true }, AMB);
    await expect(
      call(
        setAmbassadorPayout,
        { accountTitle: 'Hassan Raza', accountNumber: '123456', bankName: 'HBL' },
        AMB,
      ),
    ).rejects.toThrow(/not been approved/i);
  });

  it('cannot be set on somebody else’s behalf', async () => {
    await approvedAmbassador();
    await expect(
      call(
        setAmbassadorPayout,
        { accountTitle: 'Hassan Raza', accountNumber: '123456', bankName: 'HBL' },
        RECRUIT,
      ),
    ).rejects.toThrow(/not been approved/i);
  });
});

describe('the admin desk', () => {
  it('lists every ambassador with their code, number and what is left', async () => {
    const code = await approvedAmbassador();
    await call(claimPartnerReferral, { code }, RECRUIT);

    const list = await call<{
      ambassadors: { fullName: string; mobile: string; referralCode: string; progress: { usersRemaining: number } }[];
    }>(adminListAmbassadors, {}, ADMIN, true);

    expect(list.ambassadors).toHaveLength(1);
    expect(list.ambassadors[0].fullName).toBe('Hassan Raza');
    expect(list.ambassadors[0].mobile).toBe('+923001234567');
    expect(list.ambassadors[0].referralCode).toBe(code);
    expect(list.ambassadors[0].progress.usersRemaining).toBe(99);
  });

  it('is refused to a non-admin', async () => {
    await expect(call(adminListAmbassadors, {}, RECRUIT)).rejects.toThrow();
  });
});

describe('somebody who is not an ambassador', () => {
  it('is told so plainly rather than refused', async () => {
    const me = await call<{ stage: string }>(getMyAmbassador, {}, RECRUIT);
    expect(me.stage).toBe('none');
  });
});
