import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Outfit, Work_Sans } from 'next/font/google';

import { SITE_URL as SITE } from '@/lib/site';

import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
});

const workSans = Work_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

// Telemetry face. Every figure on the marketing site — fares, percentages,
// chapter numbers, the speed readout on the supercar stage — is set in this,
// which is what gives the page its instrument-cluster character. Two weights
// only: it is never used for running text.
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: 'Velocity — ride-hailing built for Pakistan',
    template: '%s · Velocity',
  },
  description:
    'Offer your own fare, split a ride with people going your way, and pay in cash. City rides, intercity seats, couriers and more — in one app.',
  applicationName: 'Velocity',
  keywords: [
    'ride hailing Pakistan',
    'car pooling Pakistan',
    'intercity travel',
    'courier delivery',
    'Velocity app',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Velocity',
    title: 'Velocity — ride-hailing built for Pakistan',
    description:
      'Offer your own fare, split a ride with people going your way, and pay in cash. One app for city rides, intercity seats and couriers.',
    url: SITE,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Velocity — ride-hailing built for Pakistan',
    description: 'Name your fare. Split the ride. Pay in cash.',
  },
  // No `icons` entry on purpose: an explicit one overrides Next's file
  // convention, and the tab then kept serving the stock app/favicon.ico. The
  // icons now come from app/icon.png, app/apple-icon.png and app/favicon.ico,
  // all generated from the app icon by scripts/generate-brand-assets.mjs.
};

export const viewport: Viewport = {
  themeColor: '#04120C',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${outfit.variable} ${workSans.variable} ${jetBrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
