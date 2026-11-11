/**
 * The public origin of Velocity on the web.
 *
 * The site used to answer only on the App Hosting default domain
 * (velocity--velocity-fe379.us-east4.hosted.app), and legal documents lived on
 * a separate Firebase Hosting site (velocity-fe379.web.app). Both now point at
 * the custom domain, and every outward-facing link — Play Console listing,
 * share links, franchise portal links, structured data — is built from the
 * constants below so a future domain change is a one-line edit.
 *
 * The old origins still resolve: App Hosting serves both domains from the same
 * backend, and the legacy Hosting site 301-redirects here (see firebase.json).
 */
export const SITE_URL = 'https://velocityrides.app';

/** Play Console listing URLs. Both are served by the Next app — see next.config.ts. */
export const PRIVACY_URL = `${SITE_URL}/privacy`;
export const DELETE_ACCOUNT_URL = `${SITE_URL}/delete-account`;

/** Terms of Service. Served by the same rewrite mechanism as the two above. */
export const TERMS_URL = `${SITE_URL}/terms`;

/**
 * The two stores the app actually ships on.
 *
 * Both live here for the same reason every other outward link does: the
 * homepage names them in five places (hero, availability cards, the sticky
 * install bar, the nav button and the structured data) and four of those were
 * wrong the day iOS shipped. One constant each.
 *
 * The Play id is the registered package name and the Apple id is the App Store
 * Connect app id — neither is a display name, and neither changes when the
 * brand does. Do not "tidy" them.
 */
export const PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.velocityridzpk.app';
export const APP_STORE_URL = 'https://apps.apple.com/pk/app/velocity-rides/id6810774199';

/** What each store's listing requires, for the availability cards. */
export const IOS_REQUIREMENT = 'iPhone · iOS 16.4 or later';
export const ANDROID_REQUIREMENT = 'Phones & tablets · Android 7.0+';

/**
 * Where support mail goes. Kept here so the legal pages and the site agree.
 *
 * This is a domain mailbox, not a personal inbox: it has to keep working when
 * someone else answers support. Point it wherever mail should actually land.
 */
export const SUPPORT_EMAIL = 'business@velocityrides.app';

/**
 * The business behind the product, published rather than buried.
 *
 * A card network requires a shop to name itself, say where it is and give a
 * number that is answered before it may take a card, and the /support page is
 * where that lives (public/legal/support.html). These constants are the one
 * copy of it: the footers, that page and anything Stripe is shown must agree,
 * because a mismatch between the site and the gateway is exactly what a review
 * stops on.
 *
 * `BUSINESS_LEGAL_NAME` is the company; `Velocity Rides` is what it trades as
 * and what a customer sees. The support address and phone are the ones on file
 * with the gateway — change them in both places or in neither.
 */
export const BUSINESS_LEGAL_NAME = 'Berreto (Private) Limited';
export const SUPPORT_PHONE = '+66 92 884 5564';
export const SUPPORT_ADDRESS = '241/32 Rat-u-Thit 200 Pi Road, Pa Tong, Kathu, Phuket 83150, Thailand';

/** Business name, address, phone and how to reach a person. Served by the same rewrite mechanism as the pages above. */
export const SUPPORT_URL = `${SITE_URL}/support`;

/**
 * Official profiles, emitted as schema.org `sameAs` on the homepage.
 *
 * Google has no Search Console field for social accounts; `sameAs` is the
 * signal it actually reads to tie a site to its profiles. Only add URLs that
 * are verifiably ours — a wrong entry associates someone else's account.
 */
export const FACEBOOK_URL = 'https://www.facebook.com/velocityridesapp/';
export const INSTAGRAM_URL = 'https://www.instagram.com/velocityrides.app/';

export const SOCIAL_PROFILES = [FACEBOOK_URL, INSTAGRAM_URL];
