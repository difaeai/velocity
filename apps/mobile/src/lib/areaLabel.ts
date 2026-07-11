/**
 * Privacy-preserving area name from a saved place label.
 *
 * Saved travel locations come from Places autocomplete, so their labels can be
 * house-precise ("House 12, Street 5, F-7/4, Islamabad, Pakistan"). Other
 * users should only ever get the AREA — enough to judge "do our routes
 * overlap?", never an address:
 *
 *   "House 12, Street 5, F-7/4, Islamabad"  → "F-7"
 *   "Bahria Town Phase 1, Rawalpindi"       → "Bahria Town Phase 1"
 *   "Shop 3, Main Blvd, DHA Phase 2, Lahore"→ "DHA Phase 2"
 *
 * Own-profile screens (travel-locations editor) keep the full label — this is
 * only for what OTHERS see.
 */

// Leading tokens that identify house/street/plot-level parts.
const STREET_LEVEL_RE =
  /^(house|home|flat|apt|apartment|suite|shop|office|floor|basement|plot|street|st[.\s]|road|rd[.\s]|lane|gali|mohalla|h[\s#.-]?no|no[.\s]|#|\d)/i;

// Parts that name a road rather than an area ("Main Boulevard", "GT Road").
const ROAD_RE = /(boulevard|blvd|avenue|highway|hwy|expressway|underpass|flyover|chowk|roundabout|\broad\b|\brd\b)\s*$/i;

const COUNTRY_RE = /^pakistan$/i;

/** Extracts a coarse area name from a full place label. */
export function areaLabel(raw: string): string {
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);

  // First part that is not street/road-level and not the country. Falls back
  // to the last part (usually the city) so we always show something area-sized.
  const candidate =
    parts.find(p => !STREET_LEVEL_RE.test(p) && !ROAD_RE.test(p) && !COUNTRY_RE.test(p))
    ?? parts[parts.length - 1]
    ?? raw;

  // Sub-sector → sector: "F-7/4" → "F-7", "G 11/3" → "G 11".
  return candidate.replace(/\s*\/\s*\d+\w*$/, '').trim();
}

/** Joins the first `max` locations of a list as coarse area names. */
export function areaSummary(
  points: { label: string }[] | undefined,
  max = 2,
): string | null {
  if (!points || points.length === 0) return null;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const p of points) {
    const a = areaLabel(p.label);
    if (!seen.has(a.toLowerCase())) {
      seen.add(a.toLowerCase());
      names.push(a);
    }
    if (names.length >= max) break;
  }
  return names.join(' · ');
}
