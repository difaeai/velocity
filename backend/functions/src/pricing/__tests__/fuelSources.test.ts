/**
 * The source adapters, tested against the bytes the sources actually serve.
 *
 * The PSO fixture below is not invented. It is the markup psopk.com served on
 * 2026-10-17, trimmed to the parts that matter and with nothing about their
 * shape changed: the same `fptitle` cells, the same accordion heading, the same
 * commented-out E10 row, the same per-city octane table with unitless prices,
 * the same 2022 block further down the page. Every trap listed in the comment
 * above `parsePsoPage` is in here, because every one of them is in the page.
 */
import { describe, expect, it } from 'vitest';

import { reconcileFuelPrices } from '../fuel';
import { DEFAULT_PRICING_CONFIG } from '../types';
import {
  autoOnes,
  matchProduct,
  matchPsoProduct,
  normaliseDate,
  oilPricesPk,
  parsePsoDate,
  parsePsoPage,
  psoPk,
} from '../fuelSources';

/** 2026-10-17 09:00 Pakistan time, the morning the page was captured. */
const FETCHED = Date.parse('2026-10-17T04:00:00.000Z');

/**
 * psopk.com/en/fuels/fuel-prices, as served on 2026-10-17.
 *
 * Five things here are load-bearing and all five are verbatim:
 *   · the POL table's date heading — including the newline and the thirty-odd
 *     spaces of template indentation PSO puts between the colon and the date,
 *     which is what defeated the first version of the parser
 *   · PSO's brand names — petrol is "PREMIER EURO 5", not "petrol"
 *   · the commented-out E10 row, which a regex cannot see is a comment
 *   · the octane table, per city, at 415.00 with no unit on the number
 *   · an unrelated 2022 block, one of nine other dates on that page
 */
const PSO_PAGE = `
<div class="tabsContainer">
  <ul class="uk-switcher tabSec">
    <li>
      <div class="accordList">
        <ul uk-accordion>
          <li class="uk-open">
            <a class="uk-accordion-title" href="javascript:;">Effective From:
                                    October 16, 2026
              <img class="minusIcon" src="/minus.svg" uk-svg /></a>
            <div class="uk-accordion-content">
              <div class="tableStyle">
                <table class="uk-table">
                  <thead><tr><th>Product Name</th><th>Rs./Litre</th></tr></thead>
                  <tbody>
                    <!-- <tr> <td>E10 GASOLINE</td> <td>--</td> </tr> -->
                    <tr> <td>PREMIER EURO 5</td> <td>Rs.390.23/Ltr</td> </tr>
                    <tr> <td>HI-CETANE DIESEL EURO 5</td> <td>Rs.396.96/Ltr</td> </tr>
                    <tr> <td>LDO</td> <td>Rs.266.41/Ltr</td> </tr>
                    <tr> <td>SKO</td> <td>Rs.330.41/Ltr</td> </tr>
                    <tr> <td>JP-1</td> <td>Rs.356.35/Ltr</td> </tr>
                  </tbody>
                </table>
                <p class="note"><b>Disclaimer:</b> Prices are exclusive of applicable freight charges.</p>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </li>
    <li>
      <a class="uk-accordion-title" href="javascript:;">Effective From: Oct 10, 2026</a>
      <table class="uk-table">
        <tbody>
          <tr> <td>Octane Euro 5 (Karachi)</td> <td>415.00</td> </tr>
          <tr> <td>Octane Euro 5 (Rawalpindi)</td> <td>415.00</td> </tr>
          <tr> <td>Octane Euro 5 (Gilgit)</td> <td>425.00</td> </tr>
        </tbody>
      </table>
    </li>
    <li>
      <a class="uk-accordion-title" href="javascript:;">Effective From:2022-08-16</a>
      <table class="uk-table">
        <tbody>
          <tr> <td>Morgah2</td> <td>188,908.20</td> </tr>
          <tr> <td>PREMIER EURO 5</td> <td>Rs.233.91/Ltr</td> </tr>
        </tbody>
      </table>
    </li>
    <li>
      <a class="uk-accordion-title" href="javascript:;">Effective From: 2026-10-01</a>
      <table class="uk-table">
        <tbody>
          <tr> <td>LPG (Domestic)</td> <td>Rs.279.34/KG</td> </tr>
        </tbody>
      </table>
    </li>
  </ul>
</div>
`;

describe('parsePsoPage', () => {
  const rows = parsePsoPage(PSO_PAGE, FETCHED);

  /** The whole job, in one assertion: two products, right prices, right date. */
  it('reads petrol and diesel with the date printed above their own table', () => {
    expect(rows).toEqual([
      {
        product: 'petrol',
        pricePkr: 390.23,
        sourceId: 'psopk.com',
        effectiveDate: '2026-10-16',
        fetchedAt: FETCHED,
      },
      {
        product: 'diesel',
        pricePkr: 396.96,
        sourceId: 'psopk.com',
        effectiveDate: '2026-10-16',
        fetchedAt: FETCHED,
      },
    ]);
  });

  /**
   * TRAP 1. High octane is a premium product some 25 rupees above petrol.
   * Reading one of those rows as petrol would move every fare in the country.
   */
  it('never reads high octane as petrol', () => {
    expect(rows.some((r) => r.pricePkr === 415 || r.pricePkr === 425)).toBe(false);
  });

  /** TRAP 2. Per-kilogram LPG and per-tonne furnace oil are not litre prices. */
  it('takes only prices quoted per litre', () => {
    expect(rows.some((r) => r.pricePkr === 279.34)).toBe(false);
    expect(rows.some((r) => r.pricePkr > 1000)).toBe(false);
  });

  /**
   * TRAP 3. There are nine other "Effective From" headings on that page. A row
   * taking the wrong one is how the engine published a price nobody charged.
   */
  it('never lets a row inherit another table\'s date', () => {
    expect(rows.every((r) => r.effectiveDate === '2026-10-16')).toBe(true);
    // The 2022 block carries a PREMIER row at an old price. Same product name,
    // four years stale — it must not be read at all.
    expect(rows.some((r) => r.pricePkr === 233.91)).toBe(false);
  });

  /** TRAP 4. `<!-- <tr><td>E10 GASOLINE</td>…` is in the live markup. */
  it('cannot see a commented-out row', () => {
    expect(rows.some((r) => r.pricePkr === 0)).toBe(false);
    expect(rows.length).toBe(2);
  });

  /** TRAP 5. A page dated after today means we have read the wrong thing. */
  it('refuses a future-dated price', () => {
    const earlier = Date.parse('2026-10-15T04:00:00.000Z');
    expect(parsePsoPage(PSO_PAGE, earlier)).toEqual([]);
  });

  it('refuses a page that has frozen', () => {
    const muchLater = Date.parse('2028-10-17T04:00:00.000Z');
    expect(parsePsoPage(PSO_PAGE, muchLater)).toEqual([]);
  });

  it('returns nothing, and does not throw, on a page it cannot read', () => {
    expect(parsePsoPage('<html><body>Service unavailable</body></html>', FETCHED)).toEqual([]);
    expect(parsePsoPage('', FETCHED)).toEqual([]);
    // A 200 carrying an HTML error page is the normal failure mode.
    expect(psoPk.parse('<h1>502 Bad Gateway</h1>', FETCHED)).toEqual([]);
  });

  /** The adapter is handed a string; anything else is somebody else's bug. */
  it('ignores a body that is not text', () => {
    expect(psoPk.parse({ prices: [] }, FETCHED)).toEqual([]);
    expect(psoPk.parse(null, FETCHED)).toEqual([]);
  });
});

describe('matchPsoProduct', () => {
  it('knows PSO sells petrol under a brand name', () => {
    expect(matchPsoProduct('PREMIER EURO 5')).toBe('petrol');
    expect(matchPsoProduct('HI-CETANE DIESEL EURO 5')).toBe('diesel');
  });

  it('refuses everything else on the page', () => {
    for (const name of [
      'Octane Euro 5 (Rawalpindi)',
      'ALTRON X',
      'E10 GASOLINE',
      'LDO',
      'SKO',
      'JP-1',
      'LPG (Domestic)',
      'HSFO',
    ]) {
      expect(matchPsoProduct(name)).toBeNull();
    }
  });

  /** If PSO ever drops the branding, the shared matcher already knows. */
  it('still understands the plain product names', () => {
    expect(matchPsoProduct('High Speed Diesel (HSD)')).toBe('diesel');
    expect(matchPsoProduct('Motor Spirit')).toBe('petrol');
  });
});

describe('parsePsoDate', () => {
  it('reads the long and short month forms the page uses', () => {
    expect(parsePsoDate('October 16, 2026')).toBe('2026-10-16');
    expect(parsePsoDate('Oct 10, 2026')).toBe('2026-10-10');
    expect(parsePsoDate('Jan 1, 2027')).toBe('2027-01-01');
  });

  it('reads the ISO form the older blocks use', () => {
    expect(parsePsoDate('2022-08-16')).toBe('2022-08-16');
  });

  it('returns null rather than a guess', () => {
    expect(parsePsoDate('see archives')).toBeNull();
    expect(parsePsoDate('Octember 40, 2026')).toBeNull();
  });
});

/**
 * THE DAY PSO LAGGED, kept as a test because it is the whole argument for not
 * trusting a first-party source on its own.
 *
 * These are the three live readings taken on 2026-10-17: OGRA had cut petrol to
 * 386.30 effective the 17th, both independent mirrors had it, and PSO's own
 * page still showed 390.23 effective the 16th. The engine has to publish the
 * mirrors' number. A design that preferred the first party — the obvious way to
 * build this — would have priced every ride in the country off yesterday.
 *
 * The arithmetic lives in `reconcileFuelPrices`; this asserts the outcome, so
 * anybody tempted to give PSO a casting vote has to delete a test that explains
 * why they should not.
 */
describe('a stale first-party page does not beat two fresh mirrors', () => {
  const observations = [
    { product: 'petrol' as const, pricePkr: 390.23, sourceId: 'psopk.com', effectiveDate: '2026-10-16', fetchedAt: FETCHED },
    { product: 'petrol' as const, pricePkr: 386.3, sourceId: 'oilprices.pk', effectiveDate: '2026-10-17', fetchedAt: FETCHED },
    { product: 'petrol' as const, pricePkr: 386.3, sourceId: 'autoones.com', effectiveDate: '2026-10-17', fetchedAt: FETCHED },
  ];

  it('adopts the newest confirmed price, not the first-party one', () => {
    const out = reconcileFuelPrices(observations, {}, DEFAULT_PRICING_CONFIG.fuel, FETCHED);
    const petrol = out.outcomes.find((o) => o.product === 'petrol')!;
    expect(petrol.confirmed?.pricePkr).toBe(386.3);
    expect(petrol.confirmed?.effectiveDate).toBe('2026-10-17');
    expect(petrol.confirmed?.sources).toEqual(['autoones.com', 'oilprices.pk']);
  });

  /**
   * And the price is never a blend. 390.23 and 386.30 are 1.017% apart, just
   * outside the agreement tolerance, so PSO clusters alone here — but if a
   * smaller cut had put it inside, the median of a two-member cluster is its
   * midpoint, and a midpoint between yesterday and today is a price no
   * forecourt in the country is charging. That is the 2026-10-16 incident.
   */
  it('never publishes a midpoint between a stale and a current reading', () => {
    const closer = observations.map((o) =>
      o.sourceId === 'psopk.com' ? { ...o, pricePkr: 388.0 } : o,
    );
    const out = reconcileFuelPrices(closer, {}, DEFAULT_PRICING_CONFIG.fuel, FETCHED);
    const petrol = out.outcomes.find((o) => o.product === 'petrol')!;
    expect(petrol.confirmed?.pricePkr).toBe(386.3);
    expect(petrol.confirmed?.confirmations).toBe(3);
  });
});

// ── The JSON sources, unchanged by the PSO work but easy to break ───────────

describe('the json mirrors still parse', () => {
  it('reads oilprices.pk, and checks the unit before believing a number', () => {
    const body = {
      effectiveDate: '2026-10-16',
      products: [
        { product: 'Petrol', pricePkr: 390.23, unit: 'litre' },
        { product: 'High Speed Diesel (HSD)', pricePkr: 396.96, unit: 'litre' },
        // Per kilogram in the same array. A per-kg price in a per-litre field
        // would move every fare in the country.
        { product: 'LPG', pricePkr: 279.34, unit: 'kg' },
      ],
    };
    expect(oilPricesPk.parse(body, FETCHED).map((r) => [r.product, r.pricePkr])).toEqual([
      ['petrol', 390.23],
      ['diesel', 396.96],
    ]);
  });

  it('reads autoones.com', () => {
    const body = {
      prices: [
        { fuel: 'Petrol', slug: 'petrol', price_pkr: '390.23', effective_date: '2026-10-16' },
        { fuel: 'Light Diesel Oil', slug: 'ldo', price_pkr: '266.41', effective_date: '2026-10-16' },
      ],
    };
    expect(autoOnes.parse(body, FETCHED).map((r) => r.product)).toEqual(['petrol']);
  });

  it('keeps light diesel oil out of car fares', () => {
    expect(matchProduct('Light Diesel Oil')).toBeNull();
    expect(matchProduct('High Speed Diesel')).toBe('diesel');
  });

  it('will not store a date it cannot read', () => {
    expect(normaliseDate('16/10/2026')).toBeNull();
    expect(normaliseDate('2026-10-16')).toBe('2026-10-16');
  });
});
