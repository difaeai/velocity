import Link from 'next/link';

import { VelocityMark } from '@/components/BrandMark';
import { SUPPORT_EMAIL } from '@/lib/site';
import { VEXA_LEGAL_EFFECTIVE, type Clause } from '@/lib/vexaLegal';
import site from './site.module.css';
import s from './legal.module.css';

/**
 * The shell Vexa's three legal documents are printed in.
 *
 * They are her own, not the ride app's: her name in the bar, her three
 * documents linked from each of them, and a way back into her site. The words
 * live in lib/vexaLegal.ts, so the privacy policy printed here is the one the
 * section on her page shows.
 *
 * A legal page is read, not watched: no films, no narration and no assistant
 * in the corner — just the site's own colours, so it still looks like hers.
 */

const DOCS = [
  { href: '/vexa/privacy', label: 'Privacy Policy' },
  { href: '/vexa/terms', label: 'Terms of Service' },
  { href: '/vexa/delete-account', label: 'Delete your workspace' },
  { href: '/vexa/support', label: 'Support' },
];

export function LegalDoc({
  title,
  lede,
  clauses,
  current,
}: {
  title: string;
  lede: string;
  clauses: Clause[];
  current: string;
}) {
  return (
    <main className={site.site}>
      <header className={s.bar}>
        <div className={`${site.wrap} ${s.barInner}`}>
          <Link href="/vexa" className={s.brand}>
            <VelocityMark size={28} />
            Vexa
          </Link>
          <nav className={s.docs} aria-label="Vexa's documents">
            {DOCS.map((d) =>
              d.href === current ? (
                <span key={d.href} className={s.here} aria-current="page">
                  {d.label}
                </span>
              ) : (
                <Link key={d.href} href={d.href}>
                  {d.label}
                </Link>
              ),
            )}
          </nav>
        </div>
      </header>

      <article className={`${site.wrap} ${s.doc}`}>
        <h1 className={s.title}>{title}</h1>
        <p className={s.lede}>{lede}</p>
        <p className={s.meta}>
          <span>Effective {VEXA_LEGAL_EFFECTIVE}</span>
          <span>Berreto (Private) Limited</span>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>

        <ol className={s.clauses}>
          {clauses.map((c) => (
            <li key={c.t}>
              <h2>{c.t}</h2>
              <p>{c.d}</p>
            </li>
          ))}
        </ol>

        <p className={s.more}>
          This document is Vexa’s.{' '}
          {current !== '/vexa/support' && (
            <>
              Who we are, where we are and the number that is answered are on{' '}
              <Link href="/vexa/support">her support page</Link>.{' '}
            </>
          )}
          The Velocity Rides app is a different product, with its own <a href="/privacy">privacy policy</a>,{' '}
          <a href="/terms">terms</a> and <a href="/delete-account">account deletion</a>.
        </p>
      </article>

      <footer className={`${site.wrap} ${s.footer}`}>
        <span>Vexa — Your Social Media Virtual Assistant, by Berreto (Private) Limited</span>
        <span>
          <Link href="/vexa">Back to Vexa</Link> · <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </span>
      </footer>
    </main>
  );
}
