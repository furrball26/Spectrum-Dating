// Returns a coarse label for a Unix epoch timestamp (ms).
// NEVER returns the raw timestamp.
export function coarseLabel(epochMs) {
  const date = new Date(epochMs);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const sixDaysAgo = new Date(today); sixDaysAgo.setDate(today.getDate() - 6);

  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= sixDaysAgo) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });  // e.g. "Mon"
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });  // e.g. "Jun 15"
}
