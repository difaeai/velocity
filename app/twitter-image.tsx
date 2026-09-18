/**
 * The same card as og:image, emitted as `twitter:image`.
 *
 * X falls back to og:image when this is absent, but the summary_large_image
 * card declared in app/layout.tsx is only honoured reliably when the image is
 * named explicitly — and other readers of twitter:* tags do not fall back.
 */
export { size, contentType, renderShareCard as default } from '@/lib/og-card';

export const alt = 'Velocity Rides — name your fare, split the ride, keep the change';
