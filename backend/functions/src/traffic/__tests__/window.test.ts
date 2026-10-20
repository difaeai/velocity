/**
 * Reading hours off a sentence, and the gate that decides who sees it.
 *
 * The cases below are the two failures this feature exists to stop, written as
 * tests rather than as a comment:
 *
 *   · a protest announced in the morning for the afternoon, shown at breakfast
 *   · a morning jam reported in the evening, shown as if it were live
 *
 * Everything else here is a guard on the parser's appetite. A window read
 * wrongly is worse than no window at all, because the failure is silent: the
 * alert simply never appears, and nobody is told it did not.
 */
import { describe, expect, it } from 'vitest';

import { classify } from '../classify';
import { showingNow } from '../functions';
import type { FeedItem, TrafficAlert } from '../types';
import { dateFromLink } from '../sources';
import { dayAnchor, durationMs, findClocks, pktMs, readWindow } from '../window';

/** Saturday 17 October 2026, 09:00 Pakistan time. */
const NOW = pktMs(2026, 10, 17, 9, 0);
const HOUR = 60 * 60 * 1000;

const at = (h: number, mi = 0, day = 17): number => pktMs(2026, 10, day, h, mi);

describe('pkt arithmetic', () => {
  it('treats Pakistan as a fixed +5 with no daylight saving', () => {
    expect(new Date(pktMs(2026, 10, 17, 9, 0)).toISOString()).toBe('2026-10-17T04:00:00.000Z');
    // Midsummer, when a DST-aware zone would have shifted by an hour.
    expect(new Date(pktMs(2026, 7, 1, 12, 0)).toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });
});

describe('findClocks', () => {
  it('reads the three shapes a Pakistani paper uses', () => {
    expect(findClocks('from 9am to 5pm').map((c) => [c.h, c.mi])).toEqual([
      [9, 0],
      [17, 0],
    ]);
    expect(findClocks('closed at 9.30 am')[0]).toMatchObject({ h: 9, mi: 30 });
    expect(findClocks('diverted from 21:00 hours')[0]).toMatchObject({ h: 21, mi: 0 });
    expect(findClocks('effective 0900 hrs')[0]).toMatchObject({ h: 9, mi: 0 });
  });

  /** Noon and midnight are the two the obvious arithmetic gets backwards. */
  it('puts 12am at midnight and 12pm at noon', () => {
    expect(findClocks('12am')[0]).toMatchObject({ h: 0 });
    expect(findClocks('12pm')[0]).toMatchObject({ h: 12 });
  });

  /**
   * The 24-hour branch takes a colon only. It used to accept a full stop too,
   * which made "Rs 1.50 per litre" ten to two in the morning.
   */
  it('does not read a decimal number as a time', () => {
    expect(findClocks('petrol up by rs 1.50 per litre')).toEqual([]);
    expect(findClocks('a 13.5 km stretch')).toEqual([]);
  });

  it('drops impossible clocks rather than clamping them', () => {
    expect(findClocks('25:99')).toEqual([]);
    expect(findClocks('19pm')).toEqual([]);
  });
});

describe('readWindow', () => {
  it('reads a range', () => {
    const w = readWindow('Murree Road closed from 2pm to 6pm', NOW);
    expect(w).toMatchObject({ startsAt: at(14), endsAt: at(18) });
  });

  it('reads "between 9am and 11am"', () => {
    const w = readWindow('Traffic diverted between 9am and 11am', NOW);
    expect(w).toMatchObject({ startsAt: at(9), endsAt: at(11) });
  });

  it('carries a range over midnight rather than ending before it starts', () => {
    const w = readWindow('The road will stay shut from 11pm to 2am', NOW);
    expect(w!.startsAt).toBe(at(23));
    expect(w!.endsAt).toBe(at(2, 0, 18));
  });

  it('reads an end on its own', () => {
    const w = readWindow('IJP Road blocked till 6pm', NOW);
    expect(w).toMatchObject({ startsAt: null, endsAt: at(18) });
  });

  it('reads a start on its own', () => {
    const w = readWindow('Containers placed from 3pm', NOW);
    expect(w).toMatchObject({ startsAt: at(15), endsAt: null });
  });

  it('allows the filler a newspaper puts in front of a time', () => {
    expect(readWindow('closed from around 4pm', NOW)).toMatchObject({ startsAt: at(16) });
    expect(readWindow('reopens till about 7pm', NOW)).toMatchObject({ endsAt: at(19) });
  });

  /**
   * THE ONE THAT KEEPS THE FEATURE HONEST.
   *
   * A bare clock is ignored. Reading "told reporters at 4pm" as a start time
   * would hide a live closure all morning, and there is no way to tell that
   * sentence from a real one with a regex — so the window is simply not read
   * and the alert keeps its kind's lifetime, exactly as before.
   */
  it('ignores a clock with no preposition in front of it', () => {
    expect(readWindow('Police confirmed the 9pm deadline for Jail Road', NOW)).toBeNull();
  });

  it('says nothing about "today", which tells it nothing', () => {
    expect(readWindow('Murree Road is closed today', NOW)).toBeNull();
  });

  it('gives a named future day its commuting hours', () => {
    const w = readWindow('Expressway to be closed on Sunday', NOW);
    expect(w!.startsAt).toBe(at(6, 0, 18));
    expect(w!.endsAt).toBe(at(23, 0, 18));
  });

  it('reads "tomorrow"', () => {
    const w = readWindow('Protest planned tomorrow', NOW);
    expect(w!.startsAt).toBe(at(6, 0, 18));
  });

  it('reads an explicit date, in either order', () => {
    expect(readWindow('shut on 19 October', NOW)!.startsAt).toBe(at(6, 0, 19));
    expect(readWindow('shut on October 19', NOW)!.startsAt).toBe(at(6, 0, 19));
  });

  /**
   * A BARE MONTH AND YEAR IS NOT A DATE, and reading it as one hides live
   * closures. Found by running the parser over 300 live headlines: "Canada
   * Hockey team to tour Pakistan in February 2027" produced a window on 20
   * February, because `february\s+(\d{1,2})` had taken the "20" out of "2027".
   *
   * The story that matters is the road one: "closed since March 2026" would
   * have put the window months out and the alert would have been refused as
   * `not_yet` — gone, with nothing in the logs to say a real closure had been
   * dropped. Both assertions below are about that.
   */
  it('does not read the year as a day of the month', () => {
    expect(readWindow('Canada Hockey team to tour Pakistan in February 2027', NOW)).toBeNull();
    expect(readWindow('The underpass has been closed since March 2026', NOW)).toBeNull();
    // A real date still reads, with or without the year attached.
    expect(readWindow('closed on 19 October 2026', NOW)!.startsAt).toBe(at(6, 0, 19));
  });

  /** "last Friday" and "on Friday" point in opposite directions. */
  it('sends "last Friday" backwards', () => {
    const w = readWindow('The accident last Friday blocked Murree Road', NOW);
    expect(w!.startsAt).toBeLessThan(NOW);
    expect(w!.endsAt).toBeLessThan(NOW);
  });

  it('keeps "tonight" to the evening', () => {
    const w = readWindow('Road to be washed tonight', NOW);
    expect(w!.startsAt).toBe(at(18));
    expect(w!.endsAt).toBe(at(23));
  });

  it('turns a duration into an end', () => {
    expect(readWindow('closed from 2pm for three hours', NOW)).toMatchObject({
      startsAt: at(14),
      endsAt: at(17),
    });
  });

  it('runs a bare duration from publication', () => {
    const w = readWindow('The bridge is closed for two days', NOW);
    expect(w!.startsAt).toBe(NOW);
    expect(w!.endsAt).toBe(NOW + 48 * HOUR);
  });

  it('caps a very long stated window at a week', () => {
    const w = readWindow('closed for three weeks', NOW);
    expect(w!.endsAt! - w!.startsAt!).toBe(7 * 24 * HOUR);
  });

  it('keeps the phrase it read, so a wrong window is explicable', () => {
    expect(readWindow('closed from 2pm to 6pm', NOW)!.phrase).toContain('2pm');
  });
});

describe('durationMs', () => {
  it('reads digits and words', () => {
    expect(durationMs('for 3 hours')!.ms).toBe(3 * HOUR);
    expect(durationMs('for three hours')!.ms).toBe(3 * HOUR);
    expect(durationMs('for the next 48 hours')!.ms).toBe(48 * HOUR);
    expect(durationMs('for two days')!.ms).toBe(48 * HOUR);
  });

  it('is not fooled by other uses of "for"', () => {
    expect(durationMs('closed for repairs')).toBeNull();
    expect(durationMs('for the people of Rawalpindi')).toBeNull();
  });
});

describe('dayAnchor', () => {
  it('falls back to the publication day and says it was not explicit', () => {
    expect(dayAnchor('a road is closed', NOW)).toMatchObject({ explicit: false });
  });

  it('prefers an explicit date over a weekday in the same sentence', () => {
    // "Sunday 19 October" — the date is the more specific of the two and must
    // win, or a story filed on the 17th about the 19th lands on the wrong day.
    expect(dayAnchor('on sunday 19 october', NOW).base).toBe(at(0, 0, 19));
  });
});

// ── The gate, end to end through the classifier ─────────────────────────────

function item(over: Partial<FeedItem> = {}): FeedItem {
  return {
    sourceId: 'app',
    sourceName: 'APP',
    title: '',
    summary: '',
    link: 'https://www.app.com.pk/national/1/',
    publishedAt: NOW,
    ...over,
  };
}

/** The alert `classify` produced, as the read path would see it. */
const stored = (f: FeedItem, now = NOW): TrafficAlert | null => {
  const v = classify(f, now);
  return v.alert ? ({ ...v.alert, id: 'x', createdAt: now } as TrafficAlert) : null;
};

describe('the window gate', () => {
  /**
   * FAILURE 1. Announced at 9am for 2pm. Until windows existed this was on the
   * booking screen from the moment we read it, over a road that was clear.
   */
  it('holds an afternoon protest back until the afternoon', () => {
    const alert = stored(
      item({
        title: 'Protest to block Murree Road from 2pm to 6pm',
        summary: 'Traffic will be diverted from 2pm to 6pm on Murree Road.',
      }),
    );
    expect(alert).not.toBeNull();
    expect(alert!.window).toMatchObject({ basis: 'stated', startsAt: at(14), endsAt: at(18) });

    expect(showingNow(alert!, at(9))).toBe(false);   // breakfast: nothing to see
    expect(showingNow(alert!, at(13))).toBe(true);   // inside the 90-min lead
    expect(showingNow(alert!, at(15))).toBe(true);   // happening
    expect(showingNow(alert!, at(19))).toBe(false);  // over
  });

  /**
   * FAILURE 2. A morning jam filed in the evening. Every other gate passes it
   * — it is a real road, a real event, a real city — and it is still not an
   * alert, because the thing it describes has finished.
   */
  it('refuses a story whose own hours have already run out', () => {
    const verdict = classify(
      item({
        title: 'Traffic diverted on IJP Road till 11am',
        summary: 'Traffic was diverted on IJP Road till 11am.',
        publishedAt: at(7),
      }),
      at(19),
    );
    expect(verdict.kept).toBe(false);
    expect(verdict.reason).toBe('over');
  });

  it('refuses an event too far ahead to be about today', () => {
    // `now` is passed for the same reason it is in every other case here: the
    // fixture's publishedAt is pinned to NOW, and left to the real clock this
    // one started failing 48 hours after that date — on the age gate, two
    // gates before the one it is about.
    const verdict = classify(
      item({
        title: 'Islamabad Expressway to be closed on 19 December',
        summary: 'The Islamabad Expressway will be closed on 19 December.',
      }),
      NOW,
    );
    expect(verdict.kept).toBe(false);
    expect(verdict.reason).toBe('not_yet');
  });

  /** A story that states no hours keeps exactly the behaviour it always had. */
  it('falls back to the kind lifetime, and says that is what it did', () => {
    const alert = stored(
      item({
        title: 'Murree Road closed after protest',
        summary: 'Murree Road was closed after a protest.',
      }),
    );
    expect(alert!.window).toMatchObject({ basis: 'kind', phrase: null });
    expect(alert!.window.startsAt).toBe(NOW);
    expect(showingNow(alert!, NOW)).toBe(true);
  });

  /**
   * The expiry has to follow the window, not the kind. A Friday story about a
   * Sunday closure whose document is swept on Saturday is an alert nobody ever
   * sees — which is exactly how this would fail quietly.
   */
  it('keeps the document alive until the window closes', () => {
    const friday = pktMs(2026, 10, 16, 10, 0);
    const alert = stored(
      item({
        title: 'Srinagar Highway to be closed on Sunday',
        summary: 'Srinagar Highway will be closed on Sunday.',
        publishedAt: friday,
      }),
      friday,
    );
    expect(alert!.expiresAt).toBe(alert!.window.endsAt);
    expect(alert!.expiresAt).toBeGreaterThan(friday + 24 * HOUR);
  });

  /**
   * Documents written before windows existed have no `window` field, and the
   * live collection is full of them for as long as the oldest one survives a
   * deploy. They must behave exactly as they did yesterday.
   */
  it('reads a pre-window document by its publication and expiry', () => {
    const legacy = {
      publishedAt: NOW,
      expiresAt: NOW + 5 * HOUR,
    } as unknown as TrafficAlert;
    expect(showingNow(legacy, NOW + HOUR)).toBe(true);
    expect(showingNow(legacy, NOW + 6 * HOUR)).toBe(false);
  });

  /**
   * The live ITP advisory that prompted the APP feed being added, taken off
   * app.com.pk on 2026-10-17. It names two corridors the gazetteer knows and
   * states no hours, so it is the ordinary path: kept, with a kind window.
   */
  it('keeps a real ITP diversion advisory', () => {
    const alert = stored(
      item({
        title:
          'Cricket Teams’ movement: ITP announces traffic diversions on Islamabad Expressway, Srinagar Highway',
        summary:
          'ISLAMABAD, Oct 17 (APP):Islamabad Traffic Police (ITP) on Saturday issued a traffic advisory announcing temporary diversions at different points on the Islamabad Expressway and Srinagar Highway during the movement of cricket teams in the federal capital. An ITP official told APP that traffic would be diverted at different locations on Srinagar Highway between Serena Chowk and Zero Point.',
      }),
    );
    expect(alert).not.toBeNull();
    expect(alert!.cityCode).toBe('ISB');
    expect(alert!.roads.length).toBeGreaterThan(0);
    expect(showingNow(alert!, NOW)).toBe(true);
  });
});

describe('dateFromLink', () => {
  /**
   * The Nation's Islamabad feed ships a hundred items with no date field of any
   * kind. Undated, every one of them reads as "published now" and the 48-hour
   * age gate waves four-day-old closures through.
   */
  it('reads The Nation\'s dated permalink', () => {
    expect(dateFromLink('https://www.nation.com.pk/17-Oct-2026/ihc-dismisses-38-petitions')).toBe(
      pktMs(2026, 10, 17, 12),
    );
  });

  it('reads a WordPress dated permalink', () => {
    expect(dateFromLink('https://example.pk/2026/10/17/a-story/')).toBe(pktMs(2026, 10, 17, 12));
  });

  it('returns null rather than guessing at an undated URL', () => {
    expect(dateFromLink('https://www.app.com.pk/national/some-story/')).toBeNull();
    expect(dateFromLink('https://tribune.com.pk/story/2610514/dar-quashes-rumours')).toBeNull();
  });
});
