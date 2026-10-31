/**
 * The sales agent's pure parts: what it will fetch, what it reads off a page,
 * what it asks the map for, and what it will refuse to send.
 */
import { describe, expect, it } from 'vitest';

import { leadId } from '../index';
import { fromOsm, osmQuery } from '../find';
import { assertPublicUrl, contactLink, privateAddress, readSite } from '../site';
import { callScriptFallback, emailProblems, withFooter } from '../write';

describe('callScriptFallback — the call script with no model', () => {
  const seller = { product: 'Reels that bring customers in', offer: 'a free first reel', senderCompany: 'Velocity Studio' };
  const caller = { name: 'Sana', language: 'mixed' as const, goal: 'a 10-minute meeting this week', opener: '', points: 'We post daily\n\nNo contract' };

  it('builds an opener, a pitch from the setup, and the ask', () => {
    const s = callScriptFallback(caller, seller, { name: 'Bake House' });
    expect(s.opener).toContain('Sana from Velocity Studio');
    expect(s.opener).toContain('Bake House');
    expect(s.pitch).toEqual([
      'We help businesses like Bake House: Reels that bring customers in',
      'We post daily',
      'No contract',
      'For a new customer: a free first reel',
    ]);
    expect(s.close).toBe('Ask for: a 10-minute meeting this week');
  });

  it("keeps the owner's own opener, and greets in English when the caller speaks English", () => {
    expect(callScriptFallback({ ...caller, opener: 'Hi, quick one!' }, seller, { name: 'X' }).opener).toBe('Hi, quick one!');
    expect(callScriptFallback({ ...caller, language: 'english' }, seller, { name: 'X' }).opener).toMatch(/^Hello, Sana/);
  });
});

describe('privateAddress — the SSRF guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1'])(
    'refuses %s',
    (ip) => expect(privateAddress(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '104.16.1.1', '2606:4700::1111'])('allows %s', (ip) => expect(privateAddress(ip)).toBe(false));

  it('refuses non-web schemes and internal names before any lookup', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicUrl('http://localhost:8080/')).rejects.toThrow();
    await expect(assertPublicUrl('http://metadata.google.internal/')).rejects.toThrow();
    await expect(assertPublicUrl('http://169.254.169.254/latest')).rejects.toThrow();
  });
});

describe('readSite', () => {
  const html = `<html><head><title>Bake House | Fresh Bread Lahore</title>
    <meta name="description" content="Baked at 5am, delivered by noon.">
    <script>!function(f,b,e,v,n,t,s){fbq('init','1')}</script></head>
    <body><a href="mailto:Orders@BakeHouse.pk">Email</a> design by <a>hello@agency.com</a>
    <img src="logo@2x.png"> info&#64;bakehouse.pk
    <a href="tel:+92 300 1234567">Call</a> <a href="https://instagram.com/bakehouse">IG</a>
    <a href="https://wa.me/923001234567">WhatsApp</a></body></html>`;
  const read = readSite(html, 'https://www.bakehouse.pk/');

  it('finds their own addresses first and drops junk', () => {
    expect(read.emails.slice(0, 2).sort()).toEqual(['info@bakehouse.pk', 'orders@bakehouse.pk']);
    expect(read.emails).toContain('hello@agency.com');
    expect(read.emails.some((e) => e.includes('2x'))).toBe(false);
  });

  it('reads the title, description and phone', () => {
    expect(read.title).toBe('Bake House | Fresh Bread Lahore');
    expect(read.description).toBe('Baked at 5am, delivered by noon.');
    expect(read.phones).toEqual(['+923001234567']);
  });

  it('turns what it saw into plain observations', () => {
    expect(read.signals).toContain('runs Meta (Facebook/Instagram) ads — the Meta pixel is on the site');
    expect(read.signals).toContain('links to an Instagram account');
    expect(read.signals).toContain('takes orders or questions on WhatsApp');
    expect(read.signals).toContain('no way to book or order online on the home page');
  });

  it('reads a WordPress title as words and an encoded mailto as the address', () => {
    // Both as production stored them on 2026-10-28: "&amp; … &#8211;" in the title, "%20info@…" as the email.
    const wp = readSite(
      '<title>The 1 Properties &amp; Services Islamabad &#8211; Your Number 1</title><a href="mailto:%20info@time2rent.net">Mail</a>',
      'https://time2rent.net/',
    );
    expect(wp.title).toBe('The 1 Properties & Services Islamabad – Your Number 1');
    expect(wp.emails).toEqual(['info@time2rent.net']);
  });

  it('takes the WhatsApp number when a shop gives no other', () => {
    const wa = readSite('<a href="https://api.whatsapp.com/send?phone=923331112222&text=hi">Order</a>', 'https://shop.pk/');
    expect(wa.phones).toEqual(['+923331112222']);
  });
});

describe('contactLink', () => {
  it('finds the site’s own contact page and ignores other sites', () => {
    const html = '<a href="https://facebook.com/contact">FB</a> <a href="/pages/contact-us">Contact us</a>';
    expect(contactLink(html, 'https://www.bakehouse.pk/')).toBe('https://www.bakehouse.pk/pages/contact-us');
    expect(contactLink('<a href="/menu">Menu</a>', 'https://www.bakehouse.pk/')).toBeNull();
  });
});

describe('the map', () => {
  it('asks for known kinds by tag and unknown ones by name, inside the box', () => {
    expect(osmQuery('bakery', [31.4, 74.2, 31.6, 74.5])).toContain('nwr["shop"="bakery"]["name"](31.4,74.2,31.6,74.5);');
    const odd = osmQuery('solar"]; out; //', [1, 2, 3, 4]);
    expect(odd).toContain('["name"~"solar out ",i]');
    expect(odd).not.toContain('"];');
  });

  it('keeps named places someone can reach, once each', () => {
    const out = fromOsm([
      { tags: { name: 'Bake House', website: 'bakehouse.pk', phone: '+92 300' } },
      { tags: { name: 'bake house', email: 'x@y.pk' } },
      { tags: { name: 'No Contact Bakery' } },
      { tags: { website: 'nameless.pk' } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Bake House', website: 'https://bakehouse.pk', source: 'map' });
  });
});

describe('emailProblems', () => {
  const good = {
    subject: 'your 5am bake',
    body: 'Saw that Bake House bakes at 5am and delivers by noon across Lahore — that is a story most bakeries never tell. We make short daily videos for food businesses that show exactly that, without you filming anything. Would a free sample reel of your morning bake be useful?',
  };

  it('passes a short, specific email with one question', () => expect(emailProblems(good)).toEqual([]));

  it('catches the tells and the dangers', () => {
    const bad = emailProblems({
      subject: '',
      body: 'I hope this finds you well! I wanted to reach out about our cutting-edge solution for {{company}}. Visit https://x.com now.',
    });
    expect(bad).toContain('no subject');
    expect(bad).toContain('a link in a first email');
    expect(bad).toContain('an unfilled placeholder');
    expect(bad).toContain('"i hope this finds you well"');
    expect(bad).toContain('no question to answer');
  });
});

describe('withFooter', () => {
  it('always says who, where, and how to say no', () => {
    const out = withFooter('Hello there?', { senderName: 'Sana', senderCompany: 'Bloom Media', senderAddress: '12 Mall Rd, Lahore' });
    expect(out).toMatch(/Sana, Bloom Media\n12 Mall Rd, Lahore\nNot interested\? Reply "no"/);
  });
});

describe('leadId', () => {
  it('is the same business whichever source found it', () => {
    expect(leadId({ name: 'Bake House', website: 'https://www.bakehouse.pk/menu', email: null })).toBe(
      leadId({ name: 'BAKE HOUSE PK', website: 'http://bakehouse.pk', email: 'a@b.c' }),
    );
    expect(leadId({ name: 'A', website: null, email: 'Info@X.pk' })).toBe(leadId({ name: 'B', website: null, email: 'info@x.pk' }));
  });
});
