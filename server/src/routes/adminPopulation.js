// Admin Population / Demographics report (requireAuth + requireAdmin).
// Real-member (test/demo EXCLUDED) aggregate breakdowns of the CHOSEN profile
// fields — gender, orientation, seeking, relationship structure/goal, age bands,
// location, and top interests — for marketing/reporting. This is REAL member
// data (existing profile fields); pure aggregation, no new collection. It is
// DISTINCT from visitor telemetry (page_views), which is anonymous traffic.
//
// ── PRIVACY: small-cell masking (k-anonymity, k = 5) ────────────────────────
// This is identity data for a vulnerable population. Any single bucket whose
// real count is 1–4 is returned as { count: null, masked: true } (the client
// renders "<5") — NEVER the exact number. That way a rare identity (a lone
// "two-spirit" member, a small-town location, etc.) can't be used to point at a
// specific individual. The CATEGORY still appears (you can see the option is
// used) — only the tiny exact count is withheld. Buckets of 5+ show the real
// count; buckets of 0 (fixed enums like age bands) stay 0 (0 is not identifying).
// Masking happens HERE, in the backend — the exact small count never leaves the
// server. Single-dimension breakdowns ONLY: we deliberately do NOT build
// cross-tabs (e.g. location × identity), which de-anonymise far faster.
//
// Mounted at /admin alongside admin.js / adminTelemetry.js.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { ageFromDob } from '../utils/time.js';

const router = Router();

// Test/demo account exclusion (mirrors adminTelemetry.js:23-24).
const TEST_ACCOUNT_LIKE = '%@spectrum-test.dev';
const DEMO_ACCOUNT_LIKE = '%@sample.spectrum-dating.app';

const K_ANON = 5; // buckets with a count of 1..(K_ANON-1) are masked as "<5".
const TOP_N = 15; // location / interests: keep the top N, roll the rest into "Other".

// Fixed age bands (kept in this order — never re-sorted by count). max = null → "and up".
const AGE_BANDS = [
  { label: '18–24', min: 18, max: 24 },
  { label: '25–34', min: 25, max: 34 },
  { label: '35–44', min: 35, max: 44 },
  { label: '45–54', min: 45, max: 54 },
  { label: '55+', min: 55, max: null },
];

// ── Small-cell masking ──────────────────────────────────────────────────────
// The ONE place an exact count is turned into a client-safe bucket. 1..4 → masked
// (count withheld, count:null + masked:true → rendered "<5"). 0 and 5+ pass
// through with the real number. `label` is carried; `value` (optional) is the
// raw filter payload the frontend uses to drill into the member list — it is
// NOT sensitive (listing members is admin-detail; only the AGGREGATE count is
// masked), so it is always included when provided.
function maskBucket(label, count, value) {
  const masked = count >= 1 && count < K_ANON;
  const bucket = { label, count: masked ? null : count, masked };
  if (value !== undefined) bucket.value = value;
  return bucket;
}

// Turn a Map<label,count> into a masked, count-descending array. Sorting uses
// the RAW counts (before masking) so ordering is stable and deterministic; the
// tie-break is label ascending. Each label doubles as its own filter `value`
// unless the caller supplied an emptyLabel whose value should be '' (see below).
function serializeSorted(counts, { emptyLabel } = {}) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => {
      // The synthetic "unset" bucket's filter value is '' (not the label text).
      const value = emptyLabel && label === emptyLabel ? '' : label;
      return maskBucket(label, count, value);
    });
}

// Count a SINGLE-value column (gender, relationship_goal). Empty → emptyLabel.
function countSingle(rows, field, emptyLabel) {
  const counts = new Map();
  for (const r of rows) {
    const v = (r[field] || '').trim();
    const label = v || emptyLabel;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return counts;
}

// Count a MULTI-value comma-joined column (orientation, seeking,
// relationship_structure). A member counts ONCE PER SELECTED TOKEN, so the sum
// of buckets can exceed totalMembers (the frontend labels this clearly). Splits
// on ',', trims, drops empties — identical to how candidates.js splits `seeking`
// (matching/candidates.js:156-160), so we count exactly the tokens the app
// stores. A member with NO tokens (the column is '') counts once under
// emptyLabel (for `seeking`, '' is semantically "open to everyone").
function countMultiValue(rows, field, emptyLabel) {
  const counts = new Map();
  for (const r of rows) {
    const tokens = (r[field] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (tokens.length === 0) {
      counts.set(emptyLabel, (counts.get(emptyLabel) || 0) + 1);
    } else {
      for (const tok of tokens) counts.set(tok, (counts.get(tok) || 0) + 1);
    }
  }
  return counts;
}

// Age bands from DOB (computed with the shared ageFromDob so the bands agree
// with every other age calculation in the app). Members with no/invalid DOB are
// skipped (they contribute to no band). Bands stay in fixed order; a 0-count
// band is shown honestly as 0. Each band carries {min,max} as its filter value.
function ageBandBuckets(rows) {
  const counts = new Map(AGE_BANDS.map((b) => [b.label, 0]));
  for (const r of rows) {
    const age = ageFromDob(r.date_of_birth);
    if (age === null) continue;
    const band = AGE_BANDS.find((b) => age >= b.min && (b.max === null || age <= b.max));
    if (band) counts.set(band.label, counts.get(band.label) + 1);
  }
  return AGE_BANDS.map((b) => maskBucket(b.label, counts.get(b.label), { ageMin: b.min, ageMax: b.max }));
}

// Location breakdown: GROUP BY the coarse dist_city (already the coarse field),
// top N by count, the remainder rolled into a single non-drillable "Other".
// Empty city → "Not specified" (non-drillable). The kept city labels equal the
// stored value so the city member-filter (exact match) drills in correctly.
function locationBuckets(rows) {
  const counts = new Map();
  for (const r of rows) {
    const city = (r.dist_city || '').trim();
    const label = city || 'Not specified';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, TOP_N);
  const rest = sorted.slice(TOP_N);
  const out = top.map(([label, count]) =>
    // "Not specified" is a real city-less bucket, not drillable to one city.
    maskBucket(label, count, label === 'Not specified' ? undefined : label)
  );
  if (rest.length > 0) {
    const otherTotal = rest.reduce((sum, [, c]) => sum + c, 0);
    out.push(maskBucket('Other', otherTotal)); // aggregate of many cities — not drillable
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /admin/population — real-member demographic breakdowns.
// Each breakdown is [{ label, count|null, masked, value? }]. totalMembers is the
// real-member denominator (test/demo excluded). Multi-select breakdowns can sum
// to more than totalMembers (one count per chosen token) — the client says so.
// ---------------------------------------------------------------------------
router.get('/population', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;

  // One pass over real member profiles; every profile-field breakdown is derived
  // from this in JS (splitting + age + masking all need row-level control).
  const rows = db.prepare(
    `SELECT p.gender, p.orientation, p.seeking, p.relationship_structure,
            p.relationship_goal, p.date_of_birth, p.dist_city
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.email NOT LIKE ? AND u.email NOT LIKE ?`
  ).all(TEST_ACCOUNT_LIKE, DEMO_ACCOUNT_LIKE);

  const totalMembers = rows.length;

  // Top interests: GROUP BY interest in SQL (test/demo excluded via the join),
  // top N, then mask. No "Other" bucket — a long tail of niche interests isn't
  // a useful single row, and masking already protects the small ones.
  const interestRows = db.prepare(
    `SELECT ui.interest AS label, COUNT(*) AS count
       FROM user_interests ui
       JOIN users u ON u.id = ui.user_id
      WHERE u.email NOT LIKE ? AND u.email NOT LIKE ?
      GROUP BY ui.interest
      ORDER BY count DESC, label ASC
      LIMIT ?`
  ).all(TEST_ACCOUNT_LIKE, DEMO_ACCOUNT_LIKE, TOP_N);

  res.json({
    totalMembers,
    gender: serializeSorted(countSingle(rows, 'gender', 'Not specified'), { emptyLabel: 'Not specified' }),
    orientation: serializeSorted(countMultiValue(rows, 'orientation', 'Not specified'), { emptyLabel: 'Not specified' }),
    seeking: serializeSorted(countMultiValue(rows, 'seeking', 'Open to everyone'), { emptyLabel: 'Open to everyone' }),
    relationshipStructure: serializeSorted(countMultiValue(rows, 'relationship_structure', 'Not specified'), { emptyLabel: 'Not specified' }),
    relationshipGoal: serializeSorted(countSingle(rows, 'relationship_goal', 'Not specified'), { emptyLabel: 'Not specified' }),
    ageBands: ageBandBuckets(rows),
    location: locationBuckets(rows),
    interests: interestRows.map((r) => maskBucket(r.label, r.count)),
  });
});

export default router;
