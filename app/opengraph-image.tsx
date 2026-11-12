/**
 * og:image for every indexable page. See lib/og-card.tsx for the drawing.
 *
 * File-convention route: Next emits the `og:image` tags and the absolute URL
 * itself, so nothing in app/layout.tsx has to name this file.
 *
 * The card is asked for by name rather than re-exported straight from the
 * drawing: Next calls this default with its own route argument, which lands in
 * the card's first parameter and asks for a card called `[object Object]`.
 */
import { renderShareCard } from '@/lib/og-card';

export { size, contentType } from '@/lib/og-card';

export const alt = 'Velocity Rides — name your fare, split the ride, keep the change';

export default function Image() {
  return renderShareCard('rides');
}
