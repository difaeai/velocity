import type { Metadata } from 'next';

import { DoorPane } from '@/components/site/DoorPane';
import door from '@/components/site/door.module.css';
import {
  SITE_URL as SITE,
  SOCIAL_PROFILES,
  PLAY_URL,
  APP_STORE_URL,
} from '@/lib/site';
import { STUDIO_PLAN_IDS, STUDIO_PLANS } from '@/lib/studio';

/**
 * The front door.
 *
 * Velocity is two products with two websites — Velocity Rides at /rides and
 * Vexa at /vexa — and the owner asked for the address itself to be the choice
 * between them: the screen split down the middle, each half the real site,
 * live, with its own header, scrolling on its own, and a "Tap me to open" to
 * go inside. Vexa stands in her corner of her own half and speaks there, as
 * she does on her page, because that half *is* her page.
 *
 * Each half is an iframe of the page it opens (components/site/DoorPane), so
 * there is no second copy of either site to keep in step, and no screenshot to
 * go stale. The door itself holds the structured data for the company and both
 * apps; the FAQ's lives on /vexa, where the questions are actually shown.
 *
 * The page never scrolls — the halves do.
 */
export const metadata: Metadata = {
  title: { absolute: 'Velocity — Velocity Rides and Vexa' },
  description:
    'Two products, one company. Velocity Rides: book a ride and share it with people going your way. Vexa: your Social Media Virtual Assistant, who plans, posts, advertises and sells for your business.',
  alternates: { canonical: '/' },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE}#org`,
      name: 'Velocity Rides',
      legalName: 'Berreto (Private) Limited',
      parentOrganization: { '@type': 'Organization', name: 'Berreto (Private) Limited', url: 'https://berreto.com' },
      url: SITE,
      logo: `${SITE}/app/icon.png`,
      areaServed: { '@type': 'Country', name: 'Pakistan' },
      sameAs: SOCIAL_PROFILES,
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Vexa — Your Social Media Virtual Assistant',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: `${SITE}/vexa`,
      publisher: { '@id': `${SITE}#org` },
      offers: STUDIO_PLAN_IDS.map((id) => ({
        '@type': 'Offer',
        name: STUDIO_PLANS[id].name,
        price: String(STUDIO_PLANS[id].usd),
        priceCurrency: 'USD',
      })),
    },
    {
      '@type': 'MobileApplication',
      name: 'Velocity Rides',
      operatingSystem: 'Android 7.0+',
      applicationCategory: 'TravelApplication',
      installUrl: PLAY_URL,
      publisher: { '@id': `${SITE}#org` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'PKR' },
    },
    {
      '@type': 'MobileApplication',
      name: 'Velocity Rides',
      operatingSystem: 'iOS 16.4+',
      applicationCategory: 'TravelApplication',
      installUrl: APP_STORE_URL,
      publisher: { '@id': `${SITE}#org` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'PKR' },
    },
  ],
};

export default function Door() {
  return (
    <div className={door.door}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* The two frames are pictures to a crawler and to a screen reader; this is the page in words. */}
      <h1 className={door.srOnly}>
        Velocity — two websites: Velocity Rides, the ride app for Pakistan, and Vexa, your Social Media Virtual
        Assistant.
      </h1>

      <DoorPane href="/rides" name="Velocity Rides" line="Name your fare. Split the ride. Pay in cash." />
      <DoorPane href="/vexa" name="Vexa" line="Your Social Media Virtual Assistant" />
    </div>
  );
}
