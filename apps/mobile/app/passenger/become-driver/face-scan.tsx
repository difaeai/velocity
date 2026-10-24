/**
 * The last step of a driver application: show us your face.
 *
 * Reached straight after the documents have been uploaded, never before — the
 * whole value of taking it last is that the frames are then compared with the
 * photographs on the CNIC and the licence that were stored a second ago. A scan
 * taken first can only prove somebody live was holding the phone, which was
 * never the question. The backend refuses to start an onboarding scan until
 * both documents are there, so this order is a rule and not a convention.
 *
 * Passing it is also what SUBMITS the application: the engine is deliberately
 * waiting for this, and `submitted` on the verdict means it has gone off to
 * decide. So on the way out this screen goes to the status screen, not back to
 * the checklist — the driver has finished.
 *
 * Everything about the camera lives in src/ui/FaceScanRunner.tsx, which the
 * daily face check shares.
 */
import { useRouter } from 'expo-router';

import { FaceScanRunner } from '../../../src/ui/FaceScanRunner';

export default function FaceScanScreen() {
  const router = useRouter();

  return (
    <FaceScanRunner
      purpose="onboarding"
      title="Face scan"
      introTitle="Let us see you"
      introText="This proves you are a real person and that the documents you uploaded are yours. It takes a few seconds."
      startLabel="Start face scan"
      doneTitle="Face scan complete"
      doneText="That is everything. Your application is with us now — we will let you know as soon as it is checked."
      doneLabel="Continue"
      onDone={(result) => {
        // The scan started the engine, so the status screen is where the driver
        // belongs: it streams the verdict and sends them to the driver home the
        // moment they are approved. Without that (a scan done outside an
        // application, or one that passed the camera without settling who it
        // was) the checklist is still the right place to land.
        if (result?.submitted) {
          router.replace('/passenger/become-driver/submitted');
          return;
        }
        if (router.canGoBack()) router.back();
        else router.replace('/passenger/become-driver/checklist');
      }}
      later={{
        label: 'Do this later',
        onPress: () => {
          if (router.canGoBack()) router.back();
          else router.replace('/passenger/become-driver/checklist');
        },
      }}
    />
  );
}
