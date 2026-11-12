/**
 * og:image for Vexa's own site — /studio, and /vexa, which rewrites to it.
 *
 * Without this the root's card is inherited, and a shared Vexa link draws
 * "Name your fare. Split the ride." Same frame, her words: lib/og-card.tsx.
 */
import { renderShareCard } from '@/lib/og-card';

export { size, contentType } from '@/lib/og-card';

export const alt = 'Vexa — you do not need a social media team anymore';

export default function Image() {
  return renderShareCard('vexa');
}
