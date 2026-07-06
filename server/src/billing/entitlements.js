// Entitlements — the single source of truth for "what tier is this user on?".
//
// Design law (see audit/BILLING_ARCHITECTURE.md + audit/MONETIZATION_STRATEGY.md):
//   • NO row in `subscriptions` = free. Never assume a row exists.
//   • Safety + accessibility + matching + messaging + see-who-liked-you +
//     verification + data export are FREE FOREVER — Companion only ever ADDS
//     comfort/capability on top, never gates the core act of connecting.
//   • The ONLY way to become Companion in this phase is an admin `admin_demo`
//     grant (no real provider is wired). A member can never self-grant — every
//     write path that sets tier='companion' is admin-gated at the route layer,
//     and setEntitlement here is not reachable from any member `/billing/*` route.
//
// All functions take the better-sqlite3 `db` handle as their first argument, the
// same convention the rest of server/src uses.

// ── Tiers ────────────────────────────────────────────────────────────────────
export const TIERS = ['free', 'companion'];

// Allowed `source` values (who granted the tier). 'none' = default/free,
// 'admin_demo' = a revocable demo grant, the rest are future real providers.
// Validated on every write so a bad/unknown source can never be persisted.
export const SOURCES = ['none', 'admin_demo', 'stripe', 'paddle'];

// Allowed subscription statuses.
export const STATUSES = ['active', 'canceled', 'past_due'];

// ── Static tier catalog (feeds GET /billing/tiers) ───────────────────────────
// Copied from audit/MONETIZATION_STRATEGY.md §4. ONE honest published price for
// Companion; NO dynamic/age pricing, NO fake discounts, NO countdowns. The free
// tier's feature list is the marketing — it is deliberately generous.
export const TIER_CATALOG = {
  free: {
    id: 'free',
    name: 'Spectrum (Free)',
    price: 'Free',
    priceNote: 'Free forever — and genuinely enough to date.',
    tagline: 'Everything you need to meet someone safely and calmly.',
    features: [
      'All safety and accessibility features',
      'Full compatibility matching and "why you match" reasons',
      'See who liked you — no counter, no urgency',
      'Messaging, screened intros, and conversation scaffolding',
      'Base Discover filters (age, radius, seeking)',
      'Up to 6 photos, identity verification, and data export',
    ],
  },
  companion: {
    id: 'companion',
    name: 'Spectrum Companion',
    price: '$8.99/mo',
    priceNote: 'or $54/yr (about $4.50/mo). One honest price. Cancel in one tap.',
    tagline: 'Companion helps you — it never ranks you. Pure comfort and capability.',
    // HONESTY (product law): this list is exactly the three capabilities the paid
    // tier actually gates today — advanced filters (matching.js requirePaid),
    // the best-fits shortlist (GET /best-fits requirePaid), and recording audio
    // answers (audio.js requirePaid). Items that were advertised but NOT built —
    // AI draft/tone help, a higher photo cap, short-video answers, relocation
    // matching — were removed so we never charge for something that doesn't ship.
    // Add a line back here only when the matching capability is genuinely live.
    features: [
      'Deeper compatibility filters and saved filter sets',
      'A considered selection — a small, calm shortlist of higher-fit people (no expiry, no countdown)',
      'Audio prompt answers — record short, spoken answers on your profile (opt-in; playback stays free for everyone)',
    ],
  },
};

// Public shape for GET /billing/tiers: an ordered list (free first).
export function tierCatalog() {
  return [TIER_CATALOG.free, TIER_CATALOG.companion];
}

// ── Read ─────────────────────────────────────────────────────────────────────
// Returns { tier, status, source }. Defaults to free/active/none when no row
// exists — the "no row = free" invariant lives here so callers never branch.
export function getEntitlement(db, userId) {
  const row = db
    .prepare('SELECT tier, status, source FROM subscriptions WHERE user_id = ?')
    .get(userId);
  if (!row) return { tier: 'free', status: 'active', source: 'none' };
  return { tier: row.tier, status: row.status, source: row.source };
}

// ── Write (upsert) ───────────────────────────────────────────────────────────
// Validates tier/source/status against the allowlists and throws on bad input
// (the caller turns the throw into a 400). Stamps updated_at. This is the ONLY
// function that grants a tier — it is never reachable from a member route.
export function setEntitlement(db, userId, { tier, status = 'active', source, provider = null, providerRef = null } = {}) {
  if (!TIERS.includes(tier)) {
    throw new Error(`invalid tier: ${tier}`);
  }
  if (!SOURCES.includes(source)) {
    throw new Error(`invalid source: ${source}`);
  }
  if (!STATUSES.includes(status)) {
    throw new Error(`invalid status: ${status}`);
  }
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO subscriptions (user_id, tier, status, source, provider, provider_ref, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       tier = excluded.tier,
       status = excluded.status,
       source = excluded.source,
       provider = excluded.provider,
       provider_ref = excluded.provider_ref,
       updated_at = excluded.updated_at`
  ).run(userId, tier, status, source, provider, providerRef, updatedAt);
  return getEntitlement(db, userId);
}

// ── Webhook idempotency ──────────────────────────────────────────────────────
// Record a provider webhook event exactly once. Returns TRUE if this is the
// first time we've seen (provider, eventId) — the caller should then apply the
// event — or FALSE if it's a redelivery already processed, which the caller must
// treat as a no-op (ack 200, change nothing). Providers redeliver on any non-2xx
// or timeout, so this is the rail that stops a double grant/revoke. The INSERT is
// the atomic claim: a UNIQUE/PK violation means "already processed" — we catch
// exactly that and return false, and re-throw anything else (e.g. a real DB
// error) so a genuine failure surfaces instead of silently swallowing the event.
export function recordBillingEvent(db, provider, eventId, eventType = null) {
  if (!provider || !eventId) {
    throw new Error('recordBillingEvent requires provider and eventId');
  }
  try {
    db.prepare(
      'INSERT INTO billing_events (provider, event_id, event_type, received_at) VALUES (?, ?, ?, ?)'
    ).run(provider, eventId, eventType, new Date().toISOString());
    return true;
  } catch (e) {
    // better-sqlite3 surfaces a UNIQUE/PK collision as SQLITE_CONSTRAINT_PRIMARYKEY.
    if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')) {
      return false;
    }
    throw e;
  }
}

// ── Convenience ──────────────────────────────────────────────────────────────
export function isCompanion(db, userId) {
  const { tier, status } = getEntitlement(db, userId);
  return tier === 'companion' && status === 'active';
}

// ── requirePaid middleware (for FUTURE paid endpoints only) ──────────────────
// Runs AFTER requireAuth. Blocks non-Companion callers with 402 so paid features
// can plug in without their own gating logic. NOT attached to any existing
// endpoint in this phase — exported for the paid features that come later.
export function requirePaid(req, res, next) {
  const db = req.ctx?.db;
  const userId = req.ctx?.userId || req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!isCompanion(db, userId)) {
    return res.status(402).json({ error: 'upgrade_required', upgrade: true });
  }
  next();
}
