/** Compact relative timestamp for feed cards / chat rows ("2h ago"). */
export function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - seconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(seconds * 1000);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Joined Jul 2026" style label from a Firestore timestamp. */
export function joinedLabel(seconds?: number): string | null {
  if (!seconds) return null;
  const d = new Date(seconds * 1000);
  return `Joined ${d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
}
