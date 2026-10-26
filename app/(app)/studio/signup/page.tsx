import type { Metadata } from 'next';

import { StudioAuth } from '../StudioAuth';

export const metadata: Metadata = { title: { absolute: 'Sign up · Velocity Studio' } };

/** A new Velocity Studio account; the first-run steps follow at /studio/start. */
export default function StudioSignupPage() {
  return <StudioAuth mode="signup" />;
}
