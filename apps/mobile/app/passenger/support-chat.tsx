import { useEffect } from 'react';
import { useRouter } from 'expo-router';

/**
 * The old single-thread support chat, now a redirect.
 *
 * Support moved to the Velocity Rapid Response System at `/support`: a ticket
 * per complaint, answered by the AI agent first and handed to a person on
 * request. This route stays because a route is not a link — a push notification
 * from an older build, a back-stack entry, or a deep link can still land here,
 * and landing on a dead screen when you are trying to report a problem is the
 * worst possible moment for it.
 *
 * `replace`, not `push`: nobody should be able to press back into a support
 * screen that no longer sends anything anywhere.
 */
export default function SupportChatRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/support');
  }, [router]);
  return null;
}
