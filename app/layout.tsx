import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import { SITE_URL as SITE } from '@/lib/site';

import './globals.css';

// The three faces are self-hosted (app/fonts) instead of pulled through
// next/font/google. A build that downloads them from fonts.gstatic.com fails
// whenever that fetch does — it took CI down on 2026-10-17 with a
// module-not-found on the generated @font-face — and a font has no business in
// the build's network path. These are the same latin variable cuts Google serves.
const outfit = localFont({
  src: './fonts/outfit-latin.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
});

const workSans = localFont({
  src: './fonts/work-sans-latin.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-body',
  display: 'swap',
});

// Telemetry face. Every figure on the marketing site — fares, percentages,
// chapter numbers, the speed readout on the supercar stage — is set in this,
// which is what gives the page its instrument-cluster character. Two weights
// only: it is never used for running text.
const jetBrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-mono',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: 'Velocity Rides — ride-hailing built for Pakistan',
    template: '%s · Velocity Rides',
  },
  description:
    'Offer your own fare, split a ride with people going your way, and pay in cash. City rides, intercity seats, couriers and more — in one app.',
  applicationName: 'Velocity Rides',
  keywords: [
    'ride hailing Pakistan',
    'car pooling Pakistan',
    'intercity travel',
    'courier delivery',
    'Velocity Rides app',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Velocity Rides',
    title: 'Velocity Rides — ride-hailing built for Pakistan',
    description:
      'Offer your own fare, split a ride with people going your way, and pay in cash. One app for city rides, intercity seats and couriers.',
    url: SITE,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Velocity Rides — ride-hailing built for Pakistan',
    description: 'Name your fare. Split the ride. Pay in cash.',
  },
  // Meta (Facebook) domain verification. It has to be a real <meta> in the
  // server-rendered <head> — Meta's scraper does not run our JavaScript — so
  // it lives in the root layout's metadata and therefore on every page,
  // including the home page it checks.
  verification: {
    other: {
      'facebook-domain-verification': 'eny730jcnowu1dtiqfc086mtxtd243',
    },
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
