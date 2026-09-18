/**
 * og:image for every indexable page. See lib/og-card.tsx for the drawing.
 *
 * File-convention route: Next emits the `og:image` tags and the absolute URL
 * itself, so nothing in app/layout.tsx has to name this file.
 */
export { size, contentType, renderShareCard as default } from '@/lib/og-card';

export const alt = 'Velocity Rides — name your fare, split the ride, keep the change';
