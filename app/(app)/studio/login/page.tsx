import type { Metadata } from 'next';

import { StudioAuth } from '../StudioAuth';

export const metadata: Metadata = { title: { absolute: 'Log in · Velocity Studio' } };

/** A Velocity Studio customer's way back in. Velocity's own admins keep /login. */
export default function StudioLoginPage() {
  return <StudioAuth mode="login" />;
}
