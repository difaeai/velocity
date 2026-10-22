import { describe, expect, it } from 'vitest';

import { callFromPush } from '../callPush';

const ring = { screen: 'call', callId: 'c1', callTitle: '📞 Sara is calling', callText: 'Your passenger' };

describe('callFromPush', () => {
  it('reads a ring sent straight through FCM', () => {
    expect(callFromPush({ data: ring, from: '123', messageId: 'm' })).toEqual({
      callId: 'c1',
      title: '📞 Sara is calling',
      text: 'Your passenger',
    });
  });

  it('reads a ring Expo’s push service wrapped as JSON in data.body', () => {
    const viaExpo = { data: { body: JSON.stringify(ring), title: '', experienceId: '@velocity/app' } };
    expect(callFromPush(viaExpo)?.callId).toBe('c1');
  });

  it('falls back to plain words when the title is missing', () => {
    expect(callFromPush({ data: { screen: 'call', callId: 'c2' } })).toEqual({
      callId: 'c2',
      title: '📞 Incoming call',
      text: 'Free call on Velocity Rides',
    });
  });

  it('ignores every other push, and broken JSON', () => {
    expect(callFromPush({ data: { screen: 'trip', tripId: 't1' } })).toBeNull();
    expect(callFromPush({ data: { body: '{not json' } })).toBeNull();
    expect(callFromPush({ data: { screen: 'call' } })).toBeNull();
    expect(callFromPush(null)).toBeNull();
  });
});
