// Transparency report (GET /admin/transparency) backend tests.
//
// Proves the aggregate enforcement report: enforcement-actions-by-type (from
// moderation_log) + notices-by-kind (enforcement_notices); reports-by-reason and
// reports-by-outcome; the period filter (rows outside the window are excluded);
// time-to-resolution (avg/median); safety-signal counts; and — first-class — that
// the payload is PII-FREE (no user ids, names, emails, report details, moderator
// notes, or message bodies ever appear).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-transp-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-transparency-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminTelemetryRouter = (await import('../src/routes/adminTelemetry.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;
let adminId;

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const inWindow = now - 2 * DAY_MS; // inside 7d/30d/90d
const at50d = now - 50 * DAY_MS; // outside 7d & 30d, inside 90d
const at120d = now - 120 * DAY_MS; // outside all fixed windows, inside 'all'

// Distinctive PII strings that must NEVER surface in the aggregate payload.
const SECRET_EMAIL = 'victim-pii@secret.example';
const SECRET_NAME = 'ZZDistinctiveDisplayName';
const SECRET_DETAILS = 'PIILEAK_report_details_freetext';
const SECRET_NOTE = 'PIILEAK_moderator_note_freetext';
const SECRET_MOD_DETAIL = 'PIILEAK_modlog_detail_freetext';

function makeUser({ email } = {}) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, email || `${id}@t.dev`, 'x', now);
  return id;
}

function insertModLog({ action, targetId = null, detail = '', createdAt = inWindow }) {
  db.prepare('INSERT INTO moderation_log (id, actor_id, action, target_id, detail, created_at) VALUES (?,?,?,?,?,?)')
    .run(`ml${++uid}`, adminId, action, targetId, detail, createdAt);
}

function insertNotice({ userId, kind, reason = '', createdAt = inWindow }) {
  db.prepare('INSERT INTO enforcement_notices (id, user_id, kind, reason, created_at) VALUES (?,?,?,?,?)')
    .run(`en${++uid}`, userId, kind, reason, createdAt);
}

function insertReport({ reporterId, reportedId, reason, status = 'open', createdAt = inWindow, resolvedAt = null, details = '', note = '' }) {
  db.prepare(
    `INSERT INTO reports (id, reporter_id, reported_id, conversation_id, reason, details, status, moderator_note, created_at, resolved_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(`rp${++uid}`, reporterId, reportedId, null, reason, details, status, note, createdAt, resolvedAt);
}

function insertSignal({ userId, kind, createdAt = inWindow }) {
  db.prepare('INSERT INTO chat_safety_signals (id, user_id, conversation_id, message_id, signal_kind, created_at) VALUES (?,?,?,?,?,?)')
    .run(`cs${++uid}`, userId, null, null, kind, createdAt);
}

async function api(path, { token } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const adminToken = () => signToken(adminId, 0);

beforeAll(async () => {
  adminId = makeUser({ email: 'admin@t.dev' });
  const reporter = makeUser();
  // The reported member carries the PII we assert never leaks.
  const reported = makeUser({ email: SECRET_EMAIL });
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?, ?, ?)').run(reported, SECRET_NAME, now);

  // ── Enforcement actions (moderation_log) ────────────────────────────────
  // In-window: 2 warn, 1 suspend, 1 ban, 1 resolve_report (with PII detail).
  insertModLog({ action: 'warn', targetId: reported });
  insertModLog({ action: 'warn', targetId: reported });
  insertModLog({ action: 'suspend', targetId: reported });
  insertModLog({ action: 'ban', targetId: reported });
  insertModLog({ action: 'resolve_report', targetId: 'rpX', detail: SECRET_MOD_DETAIL });
  // Out-of-window (50d): 1 warn — excluded from 7d/30d, included in 90d/all.
  insertModLog({ action: 'warn', targetId: reported, createdAt: at50d });
  // Ancient (120d): 1 nuke_intros — only 'all' sees it.
  insertModLog({ action: 'nuke_intros', targetId: reported, createdAt: at120d });

  // ── Due-process notices (enforcement_notices) ───────────────────────────
  insertNotice({ userId: reported, kind: 'warn' });
  insertNotice({ userId: reported, kind: 'ban', reason: SECRET_NOTE });
  insertNotice({ userId: reported, kind: 'warn', createdAt: at50d }); // out of 30d

  // ── Reports ─────────────────────────────────────────────────────────────
  // In-window: harassment (open), harassment (actioned+resolved), spam (dismissed+resolved).
  insertReport({ reporterId: reporter, reportedId: reported, reason: 'harassment', status: 'open', details: SECRET_DETAILS });
  insertReport({ reporterId: reporter, reportedId: reported, reason: 'harassment', status: 'actioned', createdAt: inWindow, resolvedAt: inWindow + 3 * DAY_MS, note: SECRET_NOTE });
  insertReport({ reporterId: reporter, reportedId: reported, reason: 'spam', status: 'dismissed', createdAt: inWindow, resolvedAt: inWindow + 1 * DAY_MS });
  // Out-of-window (50d): a harassment report that must NOT count in 7d/30d.
  insertReport({ reporterId: reporter, reportedId: reported, reason: 'harassment', status: 'actioned', createdAt: at50d, resolvedAt: at50d + DAY_MS });

  // ── Chat safety signals ─────────────────────────────────────────────────
  insertSignal({ userId: reported, kind: 'off_platform' });
  insertSignal({ userId: reported, kind: 'off_platform' });
  insertSignal({ userId: reported, kind: 'money' });
  insertSignal({ userId: reported, kind: 'money', createdAt: at50d }); // out of 30d

  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/admin', adminTelemetryRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

// Helper: turn [{label,count}] into { label: count }.
const asMap = (rows) => Object.fromEntries((rows || []).map((r) => [r.label, r.count]));

describe('GET /admin/transparency — auth', () => {
  it('rejects unauthenticated callers', async () => {
    const { status } = await api('/admin/transparency');
    expect(status).toBe(401);
  });
});

describe('GET /admin/transparency — 30d aggregates', () => {
  it('groups enforcement actions by type from moderation_log', async () => {
    const { status, json } = await api('/admin/transparency?period=30d', { token: adminToken() });
    expect(status).toBe(200);
    expect(json.period).toBe('30d');
    expect(json.scope).toBe('platform');
    const byAction = asMap(json.enforcement.byAction);
    expect(byAction.warn).toBe(2);
    expect(byAction.suspend).toBe(1);
    expect(byAction.ban).toBe(1);
    expect(byAction.resolve_report).toBe(1);
    expect(byAction.nuke_intros).toBeUndefined(); // 120d — out of 30d window
    expect(json.enforcement.totalActions).toBe(5);
  });

  it('groups due-process notices by kind', async () => {
    const { json } = await api('/admin/transparency?period=30d', { token: adminToken() });
    const byKind = asMap(json.enforcement.byNoticeKind);
    expect(byKind.warn).toBe(1); // the 50d warn notice is excluded
    expect(byKind.ban).toBe(1);
    expect(json.enforcement.totalNotices).toBe(2);
  });

  it('breaks reports down by reason and by outcome', async () => {
    const { json } = await api('/admin/transparency?period=30d', { token: adminToken() });
    expect(json.reports.filed).toBe(3); // 50d report excluded
    const byReason = asMap(json.reports.byReason);
    expect(byReason.harassment).toBe(2);
    expect(byReason.spam).toBe(1);
    const byOutcome = asMap(json.reports.byOutcome);
    expect(byOutcome.open).toBe(1);
    expect(byOutcome.actioned).toBe(1);
    expect(byOutcome.dismissed).toBe(1);
  });

  it('computes avg/median time-to-resolution over resolved reports', async () => {
    const { json } = await api('/admin/transparency?period=30d', { token: adminToken() });
    expect(json.reports.resolvedCount).toBe(2); // 3d and 1d
    // median of [1d, 3d] = 2d; avg = 2d.
    expect(json.reports.medianResolutionMs).toBe(2 * DAY_MS);
    expect(json.reports.avgResolutionMs).toBe(2 * DAY_MS);
  });

  it('counts chat safety signals in the window', async () => {
    const { json } = await api('/admin/transparency?period=30d', { token: adminToken() });
    expect(json.safetySignals.total).toBe(3); // 4th is 50d, excluded
    const byKind = asMap(json.safetySignals.byKind);
    expect(byKind.off_platform).toBe(2);
    expect(byKind.money).toBe(1);
  });
});

describe('GET /admin/transparency — period filter', () => {
  it('7d excludes the 50d rows', async () => {
    const { json } = await api('/admin/transparency?period=7d', { token: adminToken() });
    expect(asMap(json.enforcement.byAction).warn).toBe(2);
    expect(json.reports.filed).toBe(3);
  });

  it('90d includes the 50d rows but not the 120d row', async () => {
    const { json } = await api('/admin/transparency?period=90d', { token: adminToken() });
    const byAction = asMap(json.enforcement.byAction);
    expect(byAction.warn).toBe(3); // 2 in-window + 1 at 50d
    expect(byAction.nuke_intros).toBeUndefined(); // 120d still excluded
    expect(json.reports.filed).toBe(4); // includes the 50d report
    expect(asMap(json.enforcement.byNoticeKind).warn).toBe(2); // includes 50d notice
    expect(json.safetySignals.total).toBe(4); // includes 50d signal
  });

  it("'all' includes every row regardless of age", async () => {
    const { json } = await api('/admin/transparency?period=all', { token: adminToken() });
    expect(json.period).toBe('all');
    expect(asMap(json.enforcement.byAction).nuke_intros).toBe(1); // the 120d row
  });

  it('defaults to 30d for a missing/invalid period', async () => {
    const { json } = await api('/admin/transparency?period=bogus', { token: adminToken() });
    expect(json.period).toBe('30d');
  });
});

describe('GET /admin/transparency — PII-free payload', () => {
  it('never leaks ids, names, emails, report details, or moderator notes', async () => {
    const { json } = await api('/admin/transparency?period=all', { token: adminToken() });
    const raw = JSON.stringify(json);
    for (const secret of [SECRET_EMAIL, SECRET_NAME, SECRET_DETAILS, SECRET_NOTE, SECRET_MOD_DETAIL]) {
      expect(raw).not.toContain(secret);
    }
    // No user/actor/target id fields anywhere in the payload.
    expect(raw).not.toMatch(/"(user_?id|actor_?id|target_?id|reporter_?id|reported_?id)"/i);
    // The seeded reported user's id must not appear either.
    // (uid counter assigned it 'u3'; assert no bare id-shaped leak of members.)
    expect(raw).not.toContain('"u3"');
  });
});
