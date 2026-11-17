/**
 * Vexa's SEO agent — the audit itself (pure, no network).
 *
 * What matters here is not "did it find something" but that every finding
 * carries the thing a developer pastes and the place it goes, and that the
 * three things which stop a site ranking outright are called CRITICAL and not
 * buried under cosmetics.
 */
import { describe, it, expect } from 'vitest';

import { auditHtml } from '../seoAgent';

const GOOD = `<!doctype html>
<html lang="en">
<head>
  <title>Book cheap rides in Islamabad | Velocity</title>
  <meta name="description" content="Share a car with people going your way in Islamabad and Rawalpindi. Fixed fares, no surge, and a seat booked in under a minute.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://example.com/">
  <meta property="og:title" content="Book cheap rides">
  <meta property="og:image" content="https://example.com/og.jpg">
  <script type="application/ld+json">{"@type":"LocalBusiness"}</script>
</head>
<body>
  <h1>Book a ride</h1>
  <img src="a.jpg" alt="A car">
  <p>${'word '.repeat(400)}</p>
</body>
</html>`;

const ok = (over: Partial<Parameters<typeof auditHtml>[0]> = {}) =>
  auditHtml({
    url: 'https://example.com/',
    html: GOOD,
    status: 200,
    robotsTxt: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml',
    sitemapOk: true,
    ...over,
  });

const ids = (f: ReturnType<typeof auditHtml>) => f.map((x) => x.id);

describe('a site that is already done properly', () => {
  it('is left alone', () => {
    expect(ok()).toEqual([]);
  });
});

describe('the things that stop a site ranking at all', () => {
  it('calls a noindex tag critical, because nothing else matters while it is there', () => {
    const f = ok({ html: GOOD.replace('<head>', '<head><meta name="robots" content="noindex">') });
    expect(f.find((x) => x.id === 'noindex')?.severity).toBe('critical');
  });

  it('stops at a 4xx rather than listing cosmetics on a page nobody can reach', () => {
    const f = ok({ status: 404 });
    expect(ids(f)).toEqual(['status']);
  });

  it('calls a whole-site robots.txt block critical', () => {
    const f = ok({ robotsTxt: 'User-agent: *\nDisallow: /' });
    expect(f.find((x) => x.id === 'robots-blocks')?.severity).toBe('critical');
  });

  it('calls a missing viewport critical — Google indexes mobile first', () => {
    const f = ok({ html: GOOD.replace(/<meta name="viewport"[^>]*>/, '') });
    expect(f.find((x) => x.id === 'viewport')?.severity).toBe('critical');
  });

  it('calls plain http critical', () => {
    const f = ok({ url: 'http://example.com/' });
    expect(f.find((x) => x.id === 'https')?.severity).toBe('critical');
  });
});

describe('every finding tells the developer what to do', () => {
  it('names a place for all of them, and gives the exact snippet where one exists', () => {
    const f = auditHtml({
      url: 'https://example.com/',
      html: '<html><body><p>hi</p></body></html>',
      status: 200,
      robotsTxt: null,
      sitemapOk: false,
    });
    expect(f.length).toBeGreaterThan(5);
    for (const finding of f) {
      expect(finding.where.trim()).not.toBe('');
      expect(finding.why.trim()).not.toBe('');
      expect(finding.title.trim()).not.toBe('');
    }
    // The ones whose fix is a paste must actually carry it.
    const canonical = f.find((x) => x.id === 'canonical');
    expect(canonical?.fix).toContain('rel="canonical"');
    expect(canonical?.fix).toContain('https://example.com/');
    expect(f.find((x) => x.id === 'robots')?.fix).toContain('Sitemap: https://example.com/sitemap.xml');
    expect(f.find((x) => x.id === 'sitemap')?.fix).toContain('<urlset');
  });

  it('builds the social tags from the page’s own title and description', () => {
    const f = ok({ html: GOOD.replace(/<meta property="og:image"[^>]*>/, '') });
    const og = f.find((x) => x.id === 'og');
    expect(og?.fix).toContain('Book cheap rides in Islamabad');
  });
});

describe('the ordinary checks', () => {
  it('flags a missing title, description and h1', () => {
    const f = auditHtml({
      url: 'https://example.com/',
      html: '<html lang="en"><head><meta name="viewport" content="a"></head><body></body></html>',
      status: 200,
      robotsTxt: 'Sitemap: x',
      sitemapOk: true,
    });
    expect(ids(f)).toEqual(expect.arrayContaining(['title', 'description', 'h1']));
  });

  it('flags a title that is too long to show in a result', () => {
    const f = ok({ html: GOOD.replace(/<title>[^<]*<\/title>/, `<title>${'x'.repeat(90)}</title>`) });
    expect(ids(f)).toContain('title-length');
  });

  it('counts images with no alt text, and gets louder past five', () => {
    const few = ok({ html: GOOD.replace('<img src="a.jpg" alt="A car">', '<img src="a.jpg">') });
    expect(few.find((x) => x.id === 'alt')?.severity).toBe('polish');

    const many = ok({
      html: GOOD.replace('<img src="a.jpg" alt="A car">', '<img src="a.jpg">'.repeat(6)),
    });
    expect(many.find((x) => x.id === 'alt')?.severity).toBe('important');
  });

  it('flags more than one h1', () => {
    const f = ok({ html: GOOD.replace('<h1>Book a ride</h1>', '<h1>A</h1><h1>B</h1>') });
    expect(ids(f)).toContain('h1-many');
  });

  it('flags a thin page, counting only the words a reader sees', () => {
    const f = ok({
      html: GOOD.replace(
        `<p>${'word '.repeat(400)}</p>`,
        `<p>short</p><script>${'junk '.repeat(500)}</script>`,
      ),
    });
    expect(ids(f)).toContain('thin');
  });

  it('does not call robots.txt missing when it is merely sitemap-less', () => {
    const f = ok({ robotsTxt: 'User-agent: *\nAllow: /' });
    expect(ids(f)).toContain('robots-sitemap');
    expect(ids(f)).not.toContain('robots');
  });
});
