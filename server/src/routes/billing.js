// Billing & entitlements routes.
//
// TWO routers are exported and mounted separately in index.js:
//   • default `billingRouter`         → mounted at '/billing' (member-facing).
//   • named  `adminEntitlementsRouter` → mounted at '/admin' AFTER the
//     adminApiLimiter mount, so it inherits the admin rate limiter exactly like
//     the other /admin routers (see index.js).
//
// SECURITY INVARIANT: no member-reachable route ever calls setEntitlement. The
// only way a member's tier becomes 'companion' in this phase is an admin
// `admin_demo` grant (or, once wired, a real provider webhook). /billing/checkout
// with the stub grants NOTHING; /billing/cancel only ever downgrades to free.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import {
  TIERS,
  tierCatalog,
  getEntitlement,
  setEntitlement,
} from '../billing/entitlements.js';
import { getProvider } from '../billing/provider.js';

// ─────────────────────────────────────────────────────────────────────────────
// Member-facing routes (requireAuth). Mounted at '/billing'.
// ─────────────────────────────────────────────────────────────────────────────
const router = Router();

// GET /billing/tiers — the static tier catalog (free + companion, price, features).
router.get('/tiers', requireAuth, (_req, res) => {
  res.json({ tiers: tierCatalog() });
});

// GET /billing/me — the caller's own entitlement.
router.get('/me', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  res.json(getEntitlement(db, userId));
});

// POST /billing/checkout — start a checkout via the active provider.
// With the stub this returns { configured: false } and grants NOTHING (the UI
// shows "coming soon"). A member can pass any `tier` here; it is only ever
// forwarded to the provider, never written to the entitlement — so this is not a
// self-grant path.
router.post('/checkout', requireAuth, async (req, res) => {
  const { userId } = req.ctx;
  const tier = req.body?.tier;
  if (tier !== undefined && !TIERS.includes(tier)) {
    return res.status(400).json({ error: 'Unknown tier.' });
  }
  const result = await getProvider().createCheckoutSession({ db: req.ctx.db }, userId, tier || 'companion');
  res.json(result);
});

// POST /billing/cancel — cancel via the provider. For an `admin_demo` grant we
// revert the row to free locally so the cancel works in the demo (the stub
// provider has no external subscription to cancel). Never upgrades anyone.
router.post('/cancel', requireAuth, async (req, res) => {
  const { db, userId } = req.ctx;
  const providerResult = await getProvider().cancel({ db }, userId);
  const current = getEntitlement(db, userId);
  if (current.source === 'admin_demo') {
    // Revert the demo grant back to the free default.
    setEntitlement(db, userId, { tier: 'free', status: 'active', source: 'none' });
  }
  res.json({ ...providerResult, entitlement: getEntitlement(db, userId) });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin routes (requireAuth + requireAdmin). Mounted at '/admin', so paths are
// /admin/entitlements, /admin/entitlements/self, /admin/entitlements/demo. These
// run under the adminApiLimiter attached at the first '/admin' mount in index.js.
// ─────────────────────────────────────────────────────────────────────────────
const adminRouter = Router();

// POST /admin/entitlements — { userId, tier } → grant/revoke on a target user.
// source is forced to 'admin_demo' (a clearly separable, revocable demo grant).
adminRouter.post('/entitlements', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const { userId, tier } = req.body ?? {};
  if (typeof userId !== 'string' || !userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }
  if (!TIERS.includes(tier)) {
    return res.status(400).json({ error: 'Unknown tier.' });
  }
  // Validate the target user exists (never grant against a phantom id).
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!exists) {
    return res.status(404).json({ error: 'User not found.' });
  }
  try {
    const entitlement = setEntitlement(db, userId, { tier, status: 'active', source: 'admin_demo' });
    res.json(entitlement);
  } catch {
    res.status(400).json({ error: 'Could not set entitlement.' });
  }
});

// POST /admin/entitlements/self — { tier } → same, on the CALLING admin's own
// account, for live free↔companion demoing.
adminRouter.post('/entitlements/self', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  const { tier } = req.body ?? {};
  if (!TIERS.includes(tier)) {
    return res.status(400).json({ error: 'Unknown tier.' });
  }
  try {
    const entitlement = setEntitlement(db, userId, { tier, status: 'active', source: 'admin_demo' });
    res.json(entitlement);
  } catch {
    res.status(400).json({ error: 'Could not set entitlement.' });
  }
});

// DELETE /admin/entitlements/demo — clear ALL admin_demo grants (reset after a
// demo). Deletes only source='admin_demo' rows; never touches real provider rows.
adminRouter.delete('/entitlements/demo', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const { changes } = db.prepare("DELETE FROM subscriptions WHERE source = 'admin_demo'").run();
  res.json({ ok: true, cleared: changes });
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider webhook — the ONLY path (once a real provider is wired) that flips a
// member to a paid tier. Exported as a factory taking `db` because it is mounted
// in index.js BEFORE the global express.json() / contextMiddleware (it needs the
// RAW body Buffer for signature verification, and there is no req.ctx yet). It is
// UNAUTHENTICATED by design — the provider's signature IS the auth, verified
// inside handleWebhook over req.body (a Buffer, thanks to express.raw()).
//
// Ack semantics: a successfully-handled OR knowingly-ignored event returns 200 so
// the provider stops redelivering. A verification/parse failure returns 400 so
// the provider retries and its dashboard flags it — we never silently 200 an
// event we couldn't authenticate. With the stub (no provider) every call returns
// { ignored: true } → 200; no real webhooks arrive until BILLING_PROVIDER is set.
export function billingWebhookHandler(db) {
  return async (req, res) => {
    try {
      const result = await getProvider().handleWebhook({ db }, req.body, req.headers);
      return res.status(200).json(result || { ok: true });
    } catch {
      return res.status(400).json({ error: 'webhook_verification_failed' });
    }
  };
}

export default router;
export { adminRouter as adminEntitlementsRouter };
