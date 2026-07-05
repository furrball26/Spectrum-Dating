// adminFormat.js — pure formatting helpers for the Moderation Console.
//
// Extracted so the "oldest-age → 'waiting N days'" copy and the past-SLA/amber
// threshold are unit-tested in isolation (scripts/qa/adminFormat.test.mjs) and
// can't silently drift. Calm-by-design: these produce grounded, static duration
// labels ("waiting 3 days", "oldest 5 hours") — never a ticking countdown.
//
// No React / token imports here — keep it a pure module.

// A queue past this age is flagged amber (backlog past SLA). NEVER red, never a
// live number — the dashboard reads amber only when a queue is both non-empty
// AND older than this. 48h is the moderation service-level target.
export const SLA_MS = 48 * 60 * 60 * 1000;

// Turn a millisecond span into a calm, coarse duration phrase. Coarse on
// purpose (no "3 days 4 hours") — one unit, rounded down, so the label stays
// stable and unalarming. Negative/NaN/nullish spans yield "" (caller hides it).
export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  const clamped = Math.max(0, ms);
  const sec = Math.floor(clamped / 1000);
  if (sec < 60) return "less than a minute";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"}`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"}`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? "" : "s"}`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"}`;
}

// "waiting 3 days" — the age chip on an unresolved queue item. Null epoch → "".
export function waitingLabel(epochMs, now = Date.now()) {
  if (epochMs == null) return "";
  return `waiting ${formatDuration(now - epochMs)}`;
}

// "oldest 3 days" — the oldest-pending subtext under a Needs-attention count.
// Null epoch (empty queue) → null so the caller can render "All clear" instead.
export function oldestLabel(epochMs, now = Date.now()) {
  if (epochMs == null) return null;
  return `oldest ${formatDuration(now - epochMs)}`;
}

// "3 months" — account age for the repeat-offender line. Null epoch → "".
export function accountAgeLabel(epochMs, now = Date.now()) {
  if (epochMs == null) return "";
  return formatDuration(now - epochMs);
}

// True only when there IS an oldest item and it is older than the SLA. Drives
// the amber tone — so an empty queue (null epoch) is never amber.
export function isPastSla(epochMs, now = Date.now(), sla = SLA_MS) {
  if (epochMs == null) return false;
  return now - epochMs > sla;
}

// The oldest (smallest) of several pending-epoch values — used when several
// sub-queues merge into one triage card (e.g. Media review = message photos +
// profile photos + profile audio) and need a single oldest-pending timestamp
// for their "oldest N days" subtext and amber SLA tone. Null/undefined entries
// (empty sub-queues) are ignored; all-empty → null so the card reads "All clear".
export function oldestEpoch(epochs) {
  let oldest = null;
  for (const e of epochs) {
    if (e == null) continue;
    if (oldest == null || e < oldest) oldest = e;
  }
  return oldest;
}
