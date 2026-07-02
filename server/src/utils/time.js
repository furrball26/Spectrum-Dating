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

// Returns integer age in years for a 'YYYY-MM-DD' date-of-birth string,
// handling month/day so the birthday hasn't-happened-yet case is correct.
// Returns null if the input is missing or not a valid 'YYYY-MM-DD' real date.
export function ageFromDob(dob) {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const birth = new Date(y, m - 1, d);
  // Reject impossible/rolled-over dates (e.g. 2020-02-30 -> Mar 1).
  if (birth.getFullYear() !== y || birth.getMonth() !== m - 1 || birth.getDate() !== d) {
    return null;
  }
  const now = new Date();
  let age = now.getFullYear() - y;
  const mDiff = now.getMonth() - (m - 1);
  if (mDiff < 0 || (mDiff === 0 && now.getDate() < d)) age -= 1;
  return age;
}
