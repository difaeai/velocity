/**
 * The daily face check — the first thing a driver sees each day.
 *
 * Papers prove whose account this is on the day it is approved. They prove
 * nothing about who picks the phone up four months later, and an account quietly
 * being driven by somebody else — a brother, a cousin, a buyer — is the fraud
 * this catches. So once per Pakistan day, the first time the app is opened, the
 * driver looks into the camera and the frames are compared with the face
 * enrolled when they were approved.
 *
 * Two seconds of prompts, selfie against selfie. That comparison is reliable
 * enough to act on, which is why this is the only face check in the product
 * allowed to stop somebody driving — and even then it stops the DAY, never the
 * account: no ban, no role change, no mark on their file. An undecided reading
 * lets them through and quietly tells an admin. See
 * backend/functions/src/domain/faceCheckIn.ts.
 *
 * Reached two ways, and it has to read correctly from both:
 *   · the driver layout, which sends them here on the first open of the day;
 *   · the home banner, for a driver who dismissed it or whose check failed.
 *
 * There is no way past this screen other than passing it when the check is
 * being enforced — `blocking` is the server's own switch, carried on the driver
 * document — and no way to be trapped by it when it is not.
 */
import { useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { faceCheckInStatus, useDriverProfile } from '../../src/hooks/driver';
import { FACE_CHECK_IN_WHY } from '../../src/domain/faceCheckIn';
import { FaceScanRunner } from '../../src/ui/FaceScanRunner';

export default function FaceCheckIn() {
  const router = useRouter();
  const { user } = useAuth();
  const profile = useDriverProfile(user?.uid);
  const check = faceCheckInStatus(profile);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/driver/home'));

  return (
    <FaceScanRunner
      purpose="daily"
      title="Face check"
      introTitle="Quick face check"
      introText={FACE_CHECK_IN_WHY[check.reason ?? 'new_day']}
      startLabel="Start face check"
      doneTitle="You are good to go"
      doneText="Thank you. That is the only check today — go online whenever you are ready."
      doneLabel="Start driving"
      onDone={leave}
      /**
       * The way out, and it depends on what is being withheld.
       *
       * While the check is NOT enforced, "Not now" is honest: nothing is
       * waiting on it. While it IS, "Not now" would be a button leading to an
       * Online toggle the security rules refuse — and dropping them back into
       * the driver stack only bounces them here again. So the escape is out of
       * the driver experience altogether: a driver whose camera is broken or
       * whose permission is refused is not trapped, and nothing was skipped.
       */
      later={
        check.blocking
          ? { label: 'Use passenger mode instead', onPress: () => router.replace('/passenger/home') }
          : { label: 'Not now', onPress: leave }
      }
    />
  );
}
