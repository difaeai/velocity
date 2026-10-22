/**
 * Android's side of in-app calls: keep a call alive outside the app, and ring a
 * phone that is locked or closed. Native code: ./android.
 *
 * On iPhone, and on any build without the module, every call is a no-op — calls
 * there stay foreground-only (CallKit + VoIP push would be the iOS version).
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

interface VelocityCallsNative {
  startOngoingCall(title: string, text: string): boolean;
  stopOngoingCall(): void;
  showIncomingCall(callId: string, title: string, text: string): boolean;
  dismissIncomingCall(callId: string): void;
  showOverLockScreen(enable: boolean): boolean;
}

const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<VelocityCallsNative>('VelocityCalls') : null;

export const callSystem = {
  /** A foreground service, so the microphone survives Google Maps and a dark screen. Needs the mic permission first. */
  startOngoing: (title: string, text: string) => native?.startOngoingCall(title, text) ?? false,
  stopOngoing: () => native?.stopOngoingCall(),
  /** A full-screen, looping call notification with Answer and Decline. */
  showIncoming: (callId: string, title: string, text: string) =>
    native?.showIncomingCall(callId, title, text) ?? false,
  dismissIncoming: (callId: string) => native?.dismissIncomingCall(callId),
  /** Lets the call screen sit over the lock screen; off again when the call is over. */
  showOverLockScreen: (enable: boolean) => native?.showOverLockScreen(enable) ?? false,
};
