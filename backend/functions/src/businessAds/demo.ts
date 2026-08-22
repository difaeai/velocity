/**
 * "Find your Customers" — the demo notification.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------
 * A business owner is being asked for 5,500 a month for something they have
 * never seen: a notification, on somebody else's phone, with their picture in
 * it. Describing it on the pitch screen is not the same as feeling it arrive.
 * This callable sends that exact notification to the person who tapped the
 * button, so they can lock their phone, pull the shade down, and see what they
 * would be buying.
 *
 * IT GOES TO ONE PHONE AND ONE PHONE ONLY
 * ---------------------------------------
 * The push is addressed to the CALLER'S OWN uid — `notifyUser(uid, …)` with the
 * uid from the auth token, never a uid from `req.data`. There is no path in here
 * that can reach another user, no radius sweep, and no token lookup other than
 * the caller's own. Someone hammering the demo button spams nobody but
 * themselves.
 *
 * IT IS OUTSIDE THE ACCOUNTING, DELIBERATELY
 * ------------------------------------------
 * Nothing here touches `businessAds`, `businessAdImpressions`,
 * `businessAdvertisers`, the daily rollups or the per-person notification
 * budget. A demo that spent someone's daily allowance would mean pressing the
 * button could stop a real paid offer from arriving; a demo that incremented
 * `notified` would put fake reach in an advertiser's results. So the demo is a
 * push and an in-app notification row, and that is all it is. The consequence to
 * remember: the demo also ignores the daily ceiling, which is fine precisely
 * because it can only ever reach the person asking for it.
 *
 * THE CREATIVE
 * ------------
 * A mock KFC offer — our own type on a red plate, carrying a DEMO chip
 * (see scripts/make-demo-ad-image.mjs). It is served from the admin web app's
 * public/ directory because the phone fetches the picture itself, with the app
 * closed and nobody signed in, so the URL has to be plain public https.
 *
 * The copy is duplicated in the app at apps/mobile/src/ads/demoOffer.ts, which
 * is what the screen the notification opens renders. Change one, change the
 * other — they are the same offer seen in the tray and then in full.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { hasPushToken, notifyUser } from '../lib/fcm';
import { invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';

/**
 * Public https image URL. Overridable by env so a staging project can point at
 * its own host without a code change.
 */
const DEMO_IMAGE_URL =
  process.env.BUSINESS_AD_DEMO_IMAGE_URL ??
  'https://velocityrides.app/demo/kfc-offer.jpg';

/**
 * The demo offer. `distanceKm` is a fixed, made-up number rather than the
 * caller's real distance to a real branch: the button has to behave the same for
 * a tester in Karachi as for one in Islamabad, and asking for a location
 * permission to decorate a demo is not a trade worth making.
 */
export const DEMO_OFFER = {
  businessName: 'KFC',
  title: '25% off every Sunday, 1–4 PM',
  branch: 'Gulberg Greens branch',
  address: 'Main Expressway, Gulberg Greens, Islamabad',
  city: 'Islamabad',
  distanceKm: 1.1,
  imageUrl: DEMO_IMAGE_URL,
} as const;

/**
 * The tray copy. Distance leads, because that is the line that makes someone
 * look — an offer 1.1 km away is a decision, an offer somewhere in the city is
 * an advertisement.
 *
 * Shaped like the real thing on purpose: title is `${business}: ${title}` and
 * the body is the offer text, exactly as nearby.ts sends it, so what the
 * advertiser sees in the demo is what their own offer will look like.
 */
export function demoPush(): { title: string; body: string } {
  const o = DEMO_OFFER;
  return {
    title: `${o.businessName}: ${o.title}`,
    body:
      `${o.distanceKm} km away · ${o.branch}, ${o.address}. ` +
      '25% off your whole bill every Sunday between 1 PM and 4 PM. Dine-in and takeaway.',
  };
}

const schema = z.object({
  /**
   * Seconds to hold the push back, so the tester can close Velocity and see it
   * arrive on a locked phone — which is the whole point of the feature and the
   * one thing an instantly-delivered push cannot show. Capped well under the
   * function's own timeout; the client waits out the delay.
   */
  delaySeconds: z.number().int().min(0).max(15).optional(),
});

export const sendBusinessAdDemoNotification = onCall(async (req) => {
  const { uid } = requireAuth(req);
  // Generous on purpose — the button is meant to be pressed as often as anyone
  // likes. This ceiling only exists so a stuck retry loop cannot dial Expo and
  // FCM in a tight circle; a person tapping a button never reaches it.
  await rateLimit(uid, 'businessAdDemo', 60, 3600);

  const parsed = schema.safeParse(req.data ?? {});
  if (!parsed.success) invalid('Invalid demo request.');
  const delaySeconds = parsed.data.delaySeconds ?? 0;

  // Checked BEFORE the delay, so someone who has notifications switched off is
  // told immediately instead of watching a ten-second countdown for nothing.
  const pushed = await hasPushToken(uid);

  if (delaySeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }

  const { title, body } = demoPush();

  // `screen: 'business-offer-demo'` and NOT 'business-offer': the real value
  // carries an adId into a Firestore-backed screen and records a click against
  // an advertiser. The demo has neither an ad doc nor a click to record.
  await notifyUser(uid, title, body, 'promo', { screen: 'business-offer-demo' }, {
    imageUrl: DEMO_OFFER.imageUrl,
  });

  logger.info('Business ad demo notification sent', { uid, delaySeconds, pushed });

  // `pushed: false` means the row was written to the in-app notifications list
  // but no phone will buzz — no registered token, which in practice means
  // notification permission was refused. The app says so plainly.
  return { ok: true, pushed, title, body, imageUrl: DEMO_OFFER.imageUrl };
});
