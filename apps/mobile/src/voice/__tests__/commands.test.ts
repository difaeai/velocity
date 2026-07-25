/**
 * Driver command grammar.
 *
 * A driver says these while moving, so the cost of a wrong match is higher than
 * the cost of no match at all. The safety cases at the bottom are the ones that
 * matter most: an utterance that could be read two ways must always resolve to
 * the less damaging action, and anything unrecognised must resolve to nothing.
 */
import { describe, expect, it } from 'vitest';

import { COMMAND_ACK, COMMAND_LABEL, resolveCommand } from '../commands';

describe('resolveCommand — going on and off duty', () => {
  it('recognises going online across languages', () => {
    expect(resolveCommand('online')).toBe('goOnline');
    expect(resolveCommand('online karo')).toBe('goOnline');
    expect(resolveCommand('آن لائن کر دو')).toBe('goOnline');
    expect(resolveCommand('kaam shuru karo')).toBe('goOnline');
  });

  it('recognises going offline across languages', () => {
    expect(resolveCommand('offline')).toBe('goOffline');
    expect(resolveCommand('kaam band karo')).toBe('goOffline');
    expect(resolveCommand('آف لائن')).toBe('goOffline');
    expect(resolveCommand('chutti')).toBe('goOffline');
  });
});

describe('resolveCommand — ride actions', () => {
  it('recognises accepting a ride', () => {
    expect(resolveCommand('accept karo')).toBe('acceptRide');
    expect(resolveCommand('qabool')).toBe('acceptRide');
    expect(resolveCommand('le lo')).toBe('acceptRide');
    expect(resolveCommand('قبول کرو')).toBe('acceptRide');
  });

  it('recognises declining a ride', () => {
    expect(resolveCommand('reject karo')).toBe('declineRide');
    expect(resolveCommand('chor do')).toBe('declineRide');
    expect(resolveCommand('skip')).toBe('declineRide');
    expect(resolveCommand('رہنے دو')).toBe('declineRide');
  });

  it('recognises the remaining screen actions', () => {
    expect(resolveCommand('agli ride')).toBe('nextRequest');
    expect(resolveCommand('kahan jana hai')).toBe('readRequest');
    expect(resolveCommand('rasta batao')).toBe('navigate');
    expect(resolveCommand('call karo')).toBe('callPassenger');
    expect(resolveCommand('route khatam')).toBe('endRoute');
  });
});

describe('resolveCommand — safety', () => {
  it('returns null for anything unrecognised', () => {
    expect(resolveCommand('mausam acha hai')).toBeNull();
    expect(resolveCommand('')).toBeNull();
    expect(resolveCommand('   ')).toBeNull();
  });

  it('resolves a genuine accept/decline tie to declining', () => {
    // Mishearing "decline" as "accept" commits a driver to a job they refused;
    // the reverse merely costs them one fare. Ties go to the recoverable one.
    expect(resolveCommand('reject accept')).toBe('declineRide');
  });

  it('discards a negated command instead of acting on it', () => {
    // "accept mat karo" contains "accept" and means the opposite. Discarding it
    // costs the driver one repeat; acting on it puts them on a refused job.
    expect(resolveCommand('accept mat karo')).toBeNull();
    expect(resolveCommand('nahi accept mat karo')).toBeNull();
    expect(resolveCommand('online nahi karna')).toBeNull();
  });

  it('still resolves the surviving command when only one is negated', () => {
    expect(resolveCommand('online nahi karna offline karo')).toBe('goOffline');
  });

  it('never resolves a passenger booking sentence to a driver command', () => {
    // The two grammars share a screen-free mic; a passenger phrase reaching the
    // driver handler must do nothing rather than something arbitrary.
    expect(resolveCommand('mujhe clifton jana hai')).not.toBe('acceptRide');
    expect(resolveCommand('pool ride chahiye')).not.toBe('goOnline');
  });
});

describe('command metadata', () => {
  it('has an Urdu acknowledgement and an English label for every command', () => {
    const commands = Object.keys(COMMAND_ACK) as Array<keyof typeof COMMAND_ACK>;

    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(COMMAND_ACK[command]).toBeTruthy();
      expect(COMMAND_LABEL[command]).toBeTruthy();
    }
  });
});
