// Billing & entitlements tests. Boots a minimal app (auth middleware + context +
// the member /billing router, the admin entitlements router, and /profile) over a
// throwaway on-disk DB, mirroring admin_members.test.js.
//
// Covers: default is free (no row); admin grant → companion; a member cannot
// self-grant via any /billing/* route; requirePaid blocks free (402) and allows
// companion; cancel reverts an admin_demo grant to free; DELETE /admin/
// entitlements/demo clears only admin_demo rows; non-admin gets 403 on the admin
// routes; and /profile/me returns tier.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-billing-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-billing-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, requireAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const billingRouter = (await import('../src/routes/billing.js')).default;
const { adminEntitlementsRouter } = await import('../src/routes/billing.js');
const profileRouter = (await import('../src/routes/profile.js')).default;
const { getEntitlement, setEntitlement, isCompanion, requirePaid } = await import(
  '../src/billing/entitlements.js'
);
const { getProvider, StubProvider } = await import('../src/billing/provider.js');

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser({ email } = {}) {
  const id = `u${++uid}`;
  const em = email || `${id}@t.dev`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version) VALUES (?,?,?,?,0)')
    .run(id, em, 'x', Date.now());
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
    .run(id, `Name ${id}`, Date.now());
  return id;
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

let adminId;
const tok = (id) => signToken(id, 0);

beforeAll(async () => {
  adminId = makeUser({ email: 'admin@t.dev' });
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/billing', billingRouter);
  app.use('/admin', adminEntitlementsRouter);
  app.use('/profile', profileRouter);
  // A throwaway paid-only endpoint to exercise requirePaid in isolation.
  app.get('/paid-only', requireAuth, requirePaid, (_req, res) => res.json({ ok: true }));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe('entitlements module', () => {
  it('defaults to free/active/none when no row exists', () => {
    const u = makeUser();
    expect(getEntitlement(db, u)).toEqual({ tier: 'free', status: 'active', source: 'none' });
    expect(isCompanion(db, u)).toBe(false);
  });

  it('upsert grants companion and isCompanion reflects it', () => {
    const u = makeUser();
    setEntitlement(db, u, { tier: 'companion', status: 'active', source: 'admin_demo' });
    expect(getEntitlement(db, u)).toEqual({ tier: 'companion', status: 'active', source: 'admin_demo' });
    expect(isCompanion(db, u)).toBe(true);
  });

  it('a canceled companion is NOT an active companion', () => {
    const u = makeUser();
    setEntitlement(db, u, { tier: 'companion', status: 'canceled', source: 'admin_demo' });
    expect(isCompanion(db, u)).toBe(false);
  });

  it('rejects an unknown tier or source', () => {
    const u = makeUser();
    expect(() => setEntitlement(db, u, { tier: 'gold', source: 'admin_demo' })).toThrow();
    expect(() => setEntitlement(db, u, { tier: 'companion', source: 'self' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('provider (stub default)', () => {
  it('getProvider returns the stub and checkout does not charge', async () => {
    expect(getProvider()).toBe(StubProvider);
    expect(getProvider().name).toBe('stub');
    expect(await getProvider().createCheckoutSession('u', 'companion')).toEqual({ configured: false });
    expect(await getProvider().handleWebhook('', {})).toEqual({ ignored: true });
  });
});

// ---------------------------------------------------------------------------
describe('member /billing/* routes', () => {
  it('GET /billing/tiers returns the free + companion catalog', async () => {
    const u = makeUser();
    const { status, json } = await api('/billing/tiers', { token: tok(u) });
    expect(status).toBe(200);
    const ids = json.tiers.map((t) => t.id);
    expect(ids).toEqual(['free', 'companion']);
    const companion = json.tiers.find((t) => t.id === 'companion');
    expect(companion.price).toContain('8.99');
    expect(companion.features.length).toBeGreaterThan(0);
  });

  it('GET /billing/tiers requires auth (401 unauthenticated)', async () => {
    const { status } = await api('/billing/tiers');
    expect(status).toBe(401);
  });

  it('GET /billing/me returns the caller entitlement (free by default)', async () => {
    const u = makeUser();
    const { status, json } = await api('/billing/me', { token: tok(u) });
    expect(status).toBe(200);
    expect(json).toEqual({ tier: 'free', status: 'active', source: 'none' });
  });

  it('POST /billing/checkout with the stub returns configured:false and grants nothing', async () => {
    const u = makeUser();
    const { status, json } = await api('/billing/checkout', {
      token: tok(u),
      method: 'POST',
      body: { tier: 'companion' },
    });
    expect(status).toBe(200);
    expect(json).toEqual({ configured: false });
    // Critically: no self-grant happened.
    expect(getEntitlement(db, u).tier).toBe('free');
  });

  it('a member CANNOT self-grant companion through any /billing/* route', async () => {
    const u = makeUser();
    // checkout (any tier), cancel — none may elevate the member.
    await api('/billing/checkout', { token: tok(u), method: 'POST', body: { tier: 'companion' } });
    await api('/billing/cancel', { token: tok(u), method: 'POST' });
    expect(getEntitlement(db, u).tier).toBe('free');
    // There is no member route that reaches setEntitlement with a paid tier.
    // The admin routes are the only grant path and are requireAdmin (tested below).
  });

  it('POST /billing/cancel reverts an admin_demo companion grant to free', async () => {
    const u = makeUser();
    setEntitlement(db, u, { tier: 'companion', status: 'active', source: 'admin_demo' });
    expect(isCompanion(db, u)).toBe(true);
    const { status, json } = await api('/billing/cancel', { token: tok(u), method: 'POST' });
    expect(status).toBe(200);
    expect(json.entitlement.tier).toBe('free');
    expect(getEntitlement(db, u)).toEqual({ tier: 'free', status: 'active', source: 'none' });
  });
});

// ---------------------------------------------------------------------------
describe('requirePaid middleware', () => {
  it('blocks a free user with 402 upgrade_required', async () => {
    const u = makeUser();
    const { status, json } = await api('/paid-only', { token: tok(u) });
    expect(status).toBe(402);
    expect(json).toEqual({ error: 'upgrade_required', upgrade: true });
  });

  it('allows an active companion', async () => {
    const u = makeUser();
    setEntitlement(db, u, { tier: 'companion', status: 'active', source: 'admin_demo' });
    const { status, json } = await api('/paid-only', { token: tok(u) });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
describe('admin entitlement routes', () => {
  it('POST /admin/entitlements grants companion (source admin_demo) to a target user', async () => {
    const target = makeUser();
    const { status, json } = await api('/admin/entitlements', {
      token: tok(adminId),
      method: 'POST',
      body: { userId: target, tier: 'companion' },
    });
    expect(status).toBe(200);
    expect(json).toEqual({ tier: 'companion', status: 'active', source: 'admin_demo' });
    expect(isCompanion(db, target)).toBe(true);
  });

  it('POST /admin/entitlements 404s on a non-existent target user', async () => {
    const { status } = await api('/admin/entitlements', {
      token: tok(adminId),
      method: 'POST',
      body: { userId: 'nope-does-not-exist', tier: 'companion' },
    });
    expect(status).toBe(404);
  });

  it('POST /admin/entitlements 400s on an unknown tier', async () => {
    const target = makeUser();
    const { status } = await api('/admin/entitlements', {
      token: tok(adminId),
      method: 'POST',
      body: { userId: target, tier: 'platinum' },
    });
    expect(status).toBe(400);
  });

  it('POST /admin/entitlements/self flips the calling admin own tier', async () => {
    const { status, json } = await api('/admin/entitlements/self', {
      token: tok(adminId),
      method: 'POST',
      body: { tier: 'companion' },
    });
    expect(status).toBe(200);
    expect(json.tier).toBe('companion');
    expect(isCompanion(db, adminId)).toBe(true);
    // revert self so later assertions aren't polluted
    await api('/admin/entitlements/self', { token: tok(adminId), method: 'POST', body: { tier: 'free' } });
  });

  it('a NON-admin gets 403 on every admin entitlement route', async () => {
    const u = makeUser();
    const target = makeUser();
    const grant = await api('/admin/entitlements', {
      token: tok(u), method: 'POST', body: { userId: target, tier: 'companion' },
    });
    expect(grant.status).toBe(403);
    const self = await api('/admin/entitlements/self', {
      token: tok(u), method: 'POST', body: { tier: 'companion' },
    });
    expect(self.status).toBe(403);
    const clear = await api('/admin/entitlements/demo', { token: tok(u), method: 'DELETE' });
    expect(clear.status).toBe(403);
    // The non-admin was never elevated by any of these.
    expect(getEntitlement(db, u).tier).toBe('free');
    expect(getEntitlement(db, target).tier).toBe('free');
  });

  it('DELETE /admin/entitlements/demo clears ONLY admin_demo rows', async () => {
    const demoUser = makeUser();
    const realUser = makeUser();
    setEntitlement(db, demoUser, { tier: 'companion', status: 'active', source: 'admin_demo' });
    // Simulate a real (non-demo) provider grant that must survive the wipe.
    setEntitlement(db, realUser, { tier: 'companion', status: 'active', source: 'stripe', provider: 'stripe' });

    const { status, json } = await api('/admin/entitlements/demo', { token: tok(adminId), method: 'DELETE' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.cleared).toBeGreaterThanOrEqual(1);

    // admin_demo grant gone → back to free; real stripe grant untouched.
    expect(getEntitlement(db, demoUser).tier).toBe('free');
    expect(getEntitlement(db, realUser)).toEqual({ tier: 'companion', status: 'active', source: 'stripe' });
    // No admin_demo rows remain.
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE source = 'admin_demo'").get().n;
    expect(remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('/profile/me carries tier', () => {
  it('returns tier free by default and companion after an admin_demo grant', async () => {
    const u = makeUser();
    const free = await api('/profile/me', { token: tok(u) });
    expect(free.status).toBe(200);
    expect(free.json.tier).toBe('free');

    setEntitlement(db, u, { tier: 'companion', status: 'active', source: 'admin_demo' });
    const paid = await api('/profile/me', { token: tok(u) });
    expect(paid.json.tier).toBe('companion');
  });
});
