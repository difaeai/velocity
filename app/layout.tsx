import type { Metadata, Viewport } from 'next';
import { Outfit, Work_Sans } from 'next/font/google';

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

const SITE = 'https://velocity--velocity-fe379.us-east4.hosted.app';

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
  icons: { icon: '/app/icon.png', apple: '/app/icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#04231A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${outfit.variable} ${workSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
