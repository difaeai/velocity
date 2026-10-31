/**
 * A failed call said the way a person needs it — what, whose fault, how to fix —
 * and a typo turned into the word that was meant. Both are mirrored in the web
 * app (lib/connection.ts, lib/didYouMean.ts), which has no unit runner of its own.
 */
import { describe, expect, it } from 'vitest';

import { didYouMean } from '../didYouMean';
import { explainError, explained } from '../explainError';

const fail = (code: string, message: string) => Object.assign(new Error(message), { code: `functions/${code}` });

describe('explainError', () => {
  it('keeps a sentence the server wrote for this case', () => {
    expect(explainError(fail('failed-precondition', 'Set a daily limit above zero.'), true)).toBe(
      'Set a daily limit above zero.',
    );
  });

  it('turns a bare transport code into what, whose fault, and the fix', () => {
    const said = explainError(fail('internal', 'internal'), true);
    expect(said).toMatch(/our side/);
    expect(said).toMatch(/not your fault/);
    expect(said).toMatch(/Try again/);
  });

  it('blames the connection, not Velocity, when the phone is offline', () => {
    expect(explainError(fail('internal', 'internal'), false)).toMatch(/offline — your phone lost its connection, not Velocity/);
  });

  it('says a timed-out payment or booking should be checked before it is repeated', () => {
    expect(explainError(fail('deadline-exceeded', 'deadline-exceeded'), true)).toMatch(/check it went through/);
  });

  it('keeps the code for any caller that checks it', () => {
    const e = explained(fail('unauthenticated', 'unauthenticated'), true);
    expect((e as { code?: string }).code).toBe('functions/unauthenticated');
    expect(e.message).toMatch(/Sign in again; what you typed is kept/);
  });
});

describe('didYouMean', () => {
  const cities = ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi'];

  it('fixes a typo to the word that was meant', () => {
    expect(didYouMean('Islambad', cities)).toBe('Islamabad');
    expect(didYouMean('rawalpndi', cities)).toBe('Rawalpindi');
  });

  it('offers nothing for a different word, or a query too short to judge', () => {
    expect(didYouMean('Peshawar', cities)).toBeNull();
    expect(didYouMean('La', cities)).toBeNull();
  });
});
