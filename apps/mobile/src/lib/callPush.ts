/**
 * The in-app call inside an incoming push, wherever the transport put it.
 *
 * The backend rings Android with a data push (lib/fcm.ts → sendCallToUser) that
 * reaches the phone two ways: straight through FCM, which leaves our fields in
 * `data`, and through Expo's push service, which JSON-encodes them into
 * `data.body`. Rather than trust one shape, this looks for the call wherever it
 * is, a few levels deep, through JSON strings too.
 */
export interface CallPush {
  callId: string;
  title: string;
  text: string;
}

export function callFromPush(payload: unknown, depth = 0): CallPush | null {
  if (depth > 4 || payload == null) return null;
  if (typeof payload === 'string') {
    if (!payload.trimStart().startsWith('{')) return null;
    try {
      return callFromPush(JSON.parse(payload), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  if (o.screen === 'call' && typeof o.callId === 'string' && o.callId) {
    return {
      callId: o.callId,
      title: typeof o.callTitle === 'string' && o.callTitle ? o.callTitle : '📞 Incoming call',
      text: typeof o.callText === 'string' && o.callText ? o.callText : 'Free call on Velocity Rides',
    };
  }
  for (const value of Object.values(o)) {
    const found = callFromPush(value, depth + 1);
    if (found) return found;
  }
  return null;
}
