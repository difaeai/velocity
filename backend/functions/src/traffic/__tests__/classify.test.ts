/**
 * The classifier's rules, written as the headlines that would break them.
 *
 * Every refusal case below is a real string taken from a live Pakistani news
 * feed on 2026-10-17, not an invented one. That is the point: these are the
 * sentences a keyword filter gets wrong, and the only way to know the rules
 * hold is to keep the actual text that defeats them.
 */
import { describe, expect, it } from 'vitest';

import { classify, cleanText, sentences } from '../classify';
import { matchRoads } from '../gazetteer';
import type { FeedItem } from '../types';

const NOW = Date.parse('2026-10-17T12:00:00Z');

function item(over: Partial<FeedItem> = {}): FeedItem {
  return {
    sourceId: 'dawn',
    sourceName: 'Dawn',
    title: '',
    summary: '',
    link: 'https://www.dawn.com/news/1',
    publishedAt: NOW - 60 * 60 * 1000,
    ...over,
  };
}

describe('cleanText', () => {
  it('unwraps CDATA, strips tags and decodes entities', () => {
    expect(cleanText('<![CDATA[<p>Mall Road &amp; Jail Road</p>]]>')).toBe('Mall Road & Jail Road.');
  });

  /** Dawn serves its summaries with the markup entity-encoded. */
  it('strips tags that only appear after the entities are decoded', () => {
    expect(cleanText('&lt;p&gt;ISLAMABAD: the meeting&lt;/p&gt;')).toBe('ISLAMABAD: the meeting.');
  });

  /**
   * The one that matters: paragraphs must stay separate claims. When </p>
   * collapsed to a space, a whole article became one sentence and the
   * road-and-event-in-the-same-sentence rule stopped protecting anything.
   */
  it('turns paragraph breaks into sentence breaks, not spaces', () => {
    const text = cleanText('&lt;p&gt;Jail Road is fine.&lt;/p&gt;&lt;p&gt;The inquiry was closed.&lt;/p&gt;');
    expect(sentences(text)).toHaveLength(2);
  });
});

describe('sentences', () => {
  it('splits on semicolons, because newspapers pack separate claims behind them', () => {
    const parts = sentences('Babusar Pass road closed to all traffic; police rescue tourists.');
    expect(parts).toHaveLength(2);
  });
});

describe('matchRoads', () => {
  it('reads the spellings Pakistani papers actually use', () => {
    for (const spelling of ['shahrah-e-faisal', 'sharea faisal', 'shahra-e-faisal']) {
      expect(matchRoads(`traffic on ${spelling} was blocked`)[0]?.entry.name).toBe('Shahrah-e-Faisal');
    }
  });

  it('prefers the more specific road when two aliases overlap', () => {
    const names = matchRoads('peshawar gt road was closed').map((m) => m.entry.name);
    expect(names).toContain('Peshawar GT Road');
    expect(names).not.toContain('N-5 National Highway');
  });

  it('will not match an alias inside a longer word', () => {
    expect(matchRoads('the cliftonville result')).toHaveLength(0);
  });
});

describe('classify — what it keeps', () => {
  it('keeps a named-road closure and places it in the right city', () => {
    const c = classify(
      item({
        title: 'Shahrah-e-Faisal closed for traffic after protest',
        summary: 'Police said Shahrah-e-Faisal was closed to all traffic in both directions.',
      }),
      NOW,
    );
    expect(c.kept).toBe(true);
    expect(c.alert?.cityCode).toBe('KHI');
    expect(c.alert?.scope).toBe('city');
    expect(c.alert?.roads).toContain('Shahrah-e-Faisal');
    expect(c.alert?.places[0]?.radiusM).toBeGreaterThan(0);
  });

  it('keeps a city-wide event that names no road at all', () => {
    const c = classify(
      item({
        title: 'Wheel-jam strike blocks roads across Lahore',
        summary: 'Traders blocked roads at several points in Lahore on Friday.',
      }),
      NOW,
    );
    expect(c.kept).toBe(true);
    expect(c.alert?.cityCode).toBe('LHE');
    // No gazetteer road matched, so there is nothing to put on a map — and the
    // alert says so by carrying no places, rather than guessing a coordinate.
    expect(c.alert?.places).toHaveLength(0);
  });

  it('files a motorway story as a highway alert, belonging to no city', () => {
    const c = classify(
      item({ title: 'M-2 Motorway closed in both directions near Kallar Kahar' }),
      NOW,
    );
    expect(c.kept).toBe(true);
    expect(c.alert?.scope).toBe('highway');
    expect(c.alert?.cityCode).toBeNull();
  });

  it('is not fooled by a road whose name contains a veto word', () => {
    const c = classify(
      item({ title: 'University Road Peshawar closed after accident' }),
      NOW,
    );
    expect(c.kept).toBe(true);
    expect(c.alert?.roads).toContain('University Road Peshawar');
  });

  it('reads the kind off the event, not off the road', () => {
    expect(classify(item({ title: 'Protesters block Murree Road in Rawalpindi' }), NOW).alert?.kind)
      .toBe('protest');
    expect(classify(item({ title: 'Tanker overturned on Korangi Road' }), NOW).alert?.kind)
      .toBe('accident');
    expect(classify(item({ title: 'Heavy rain leaves Shahrah-e-Pakistan waterlogged' }), NOW).alert?.kind)
      .toBe('weather');
  });

  it('escalates and de-escalates on the words that qualify the closure', () => {
    const hard = classify(item({ title: 'Jail Road sealed to all traffic until further notice' }), NOW);
    const soft = classify(item({ title: 'Jail Road partially closed for one lane' }), NOW);
    expect(hard.alert?.severity).toBe('high');
    expect(soft.alert?.severity).toBe('medium');
  });

  it('gives each kind its own lifetime', () => {
    const jam = classify(item({ title: 'Traffic jam on Canal Road', publishedAt: NOW }), NOW);
    const closed = classify(item({ title: 'Canal Road closed', publishedAt: NOW }), NOW);
    expect(closed.alert!.expiresAt).toBeGreaterThan(jam.alert!.expiresAt);
  });
});

describe('classify — a fact buried in the body', () => {
  const buried = () =>
    classify(
      item({
        title: "Dept told to complete Rawalpindi's underpasses by November",
        summary:
          '&lt;p&gt;The divisional administration reviewed progress.&lt;/p&gt;&lt;p&gt;Two routes of electric buses were suspended on the recommendation of City Traffic Police.&lt;/p&gt;',
      }),
      NOW,
    );

  it('leads with the sentence that carries the event, not the headline', () => {
    expect(buried().alert?.headline).toContain('suspended');
  });

  it('keeps the headline underneath as provenance', () => {
    expect(buried().alert?.detail).toContain('underpasses');
  });

  it('is one step less severe than the same fact in a headline', () => {
    const headlined = classify(item({ title: 'Jail Road closed to all traffic' }), NOW);
    expect(headlined.alert?.severity).toBe('high');
    expect(buried().alert?.severity).toBe('medium');
  });
});

describe('classify — what it refuses', () => {
  /** Every title here appeared in a live feed on 2026-10-17. */
  const realWorldNoise: { title: string; summary?: string; why: string }[] = [
    {
      title: 'A road is not a corridor',
      summary:
        'THE inauguration of a road through the Wakhan Corridor on October 4 has drawn more commentary than its size warrants.',
      why: 'an opinion column about Afghanistan',
    },
    {
      title: 'IHC grants more time in plea seeking the account’s closure',
      summary: 'The Islamabad High Court granted more time to respond to a petition seeking the account’s closure.',
      why: 'a court story that happens to contain "closure"',
    },
    {
      title: 'Islamabad’s H-9, G-6 weekly bazaars closed over fire safety',
      summary: 'The Directorate of Municipal Administration decided to keep the weekly bazaars closed on Friday.',
      why: 'the thing that closed is not a road',
    },
    {
      title: 'Karachi to Remove 2 Traffic Signals on Major Road',
      summary:
        'The Karachi Metropolitan Corporation plans to remove two traffic signals on Shahra-e-Quaideen and introduce U-turns to improve traffic flow.',
      why: 'a plan, not an event',
    },
    {
      title: 'First phase of Hinglaj road construction completed',
      summary: 'The first construction phase of Hinglaj Mandir Link Road project has been successfully completed.',
      why: 'finished work, and nowhere we serve',
    },
    {
      title: 'Communication and Works Dept told to complete Rawalpindi’s Peshawar Road underpasses by November',
      summary: 'The divisional administration asked the department to complete work on the underpasses by November.',
      why: 'a progress report on construction, with no live impact',
    },
  ];

  for (const { title, summary, why } of realWorldNoise) {
    it(`refuses: ${why}`, () => {
      expect(classify(item({ title, summary: summary ?? '' }), NOW).kept).toBe(false);
    });
  }

  it('refuses a maritime closure wearing road vocabulary', () => {
    // Published as an Islamabad road closure, from a Council of Islamic
    // Ideology story, off the phrase "maritime traffic due to the closure".
    const c = classify(
      item({
        title: 'Council of Islamic Ideology worried by law and order situation',
        summary:
          'ISLAMABAD: The council expressed concern about shipping lines and maritime traffic due to the closure of the Strait of Hormuz.',
      }),
      NOW,
    );
    expect(c.kept).toBe(false);
  });

  it('refuses a road that reopened — the same lie, inverted', () => {
    expect(classify(item({ title: 'Murree Road reopened after protest ends' }), NOW).kept).toBe(false);
  });

  it('refuses a real closure somewhere we cannot place', () => {
    const c = classify(item({ title: 'Road closed after landslide in Chitral' }), NOW);
    expect(c.kept).toBe(false);
    expect(c.reason).toBe('unplaceable');
  });

  it('refuses a road and an event that are in different sentences', () => {
    const c = classify(
      item({
        title: 'Mall Road traders meet commissioner',
        summary: 'They discussed parking. Separately, the inquiry into the bank account was closed.',
      }),
      NOW,
    );
    expect(c.kept).toBe(false);
  });

  it('refuses yesterday-plus news', () => {
    const c = classify(item({ title: 'Jail Road closed', publishedAt: NOW - 72 * 60 * 60 * 1000 }), NOW);
    expect(c.reason).toBe('too_old');
  });
});
