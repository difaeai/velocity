/**
 * The one demo offer behind the "See it on your phone" button on the
 * Find-your-Customers screen.
 *
 * The push text is built server-side (backend/functions/src/businessAds/demo.ts)
 * because the notification has to arrive with the app closed. This file is the
 * same offer as the screen the notification opens renders it — the tray shows
 * two lines, the screen shows the whole thing.
 *
 * Keep the two in step. If the branch, the discount or the picture changes here,
 * change it there too, or the notification will promise one offer and the screen
 * will show another.
 */
export const DEMO_OFFER = {
  businessName: 'KFC',
  title: '25% off every Sunday, 1–4 PM',
  branch: 'Gulberg Greens branch',
  address: 'Main Expressway, Gulberg Greens, Islamabad',
  city: 'Islamabad',
  /**
   * Fixed and made-up, matching the backend. A demo has to read the same for a
   * tester in Karachi as for one in Islamabad, and a real distance would have
   * cost a location permission to decorate a preview.
   */
  distanceKm: 1.1,
  hours: 'Every Sunday · 1 PM – 4 PM',
  offerDetails:
    '25% off your whole bill every Sunday between 1 PM and 4 PM at KFC Gulberg Greens. ' +
    'Dine-in and takeaway. Show this offer at the counter before you pay.',
  imageUrl:
    process.env.EXPO_PUBLIC_DEMO_AD_IMAGE_URL ??
    'https://velocityrides.app/demo/kfc-offer.jpg',
  /** Gulberg Greens, Islamabad — used only for the directions link. */
  center: { lat: 33.6152, lng: 73.1489 },
} as const;

/**
 * What the tray notification will say, for the mock notification drawn on the
 * pitch screen before anything has been sent.
 *
 * The server composes the real copy, and the callable returns it — so once the
 * button has been pressed, the card shows THAT and this stops being used. Which
 * is why a small wording drift here is cosmetic rather than a lie.
 */
export function demoPreview(): { title: string; body: string } {
  const o = DEMO_OFFER;
  return {
    title: `${o.businessName}: ${o.title}`,
    body: `${o.distanceKm} km away · ${o.branch}, ${o.address}. ${o.offerDetails}`,
  };
}
