/**
 * The closest known word to a search that found nothing — "Islambad" → "Islamabad".
 * Edit distance, case-insensitive; null when nothing is close enough to be worth
 * offering. Mirrors lib/didYouMean.ts in the web app.
 */
export function didYouMean(query: string, candidates: Iterable<string>): string | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const word = c.trim();
    if (!word || word.toLowerCase() === q) continue;
    const d = distance(q, word.toLowerCase().slice(0, q.length + 2));
    if (d < bestScore) {
      bestScore = d;
      best = word;
    }
  }
  // About one slip in four letters, at most three: past that it is a different word, not a typo.
  return best !== null && bestScore <= Math.min(3, Math.ceil(q.length / 4)) ? best : null;
}

/** Levenshtein distance. Every index read is inside the rows just built. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}
