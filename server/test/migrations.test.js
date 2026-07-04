import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../src/db.js';

// The boot-DB-twice test that would have caught E1: run the REAL migration
// runner against a fresh temp DB twice and assert the second pass neither throws
// (idempotent) nor silently skips a column ADDed after an earlier ALTER.
let dbDir;

function freshDb() {
  dbDir = mkdtempSync(join(tmpdir(), 'spectrum-mig-'));
  const db = new Database(join(dbDir, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function columnExists(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}

afterEach(() => {
  if (dbDir) {
    rmSync(dbDir, { recursive: true, force: true });
    dbDir = undefined;
  }
});

describe('migration runner idempotency (E1 regression)', () => {
  it('runs cleanly on a fresh DB and creates the expected tail column', () => {
    const db = freshDb();
    try {
      expect(() => runMigrations(db)).not.toThrow();
      // public_url is the SECOND ALTER in migration 005 — the exact column that
      // would go missing if per-statement exec regressed to whole-file batching.
      expect(columnExists(db, 'message_attachments', 'public_url')).toBe(true);
      expect(columnExists(db, 'profiles', 'photo_url')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is idempotent: a second full run does not throw and preserves tail columns', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      expect(() => runMigrations(db)).not.toThrow();
      // After the 2nd migrate, the post-ALTER tail column must still be present.
      expect(columnExists(db, 'message_attachments', 'public_url')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('survives a third run too (stability under repeated boots)', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      runMigrations(db);
      expect(() => runMigrations(db)).not.toThrow();
      expect(columnExists(db, 'profiles', 'photo_url')).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('036 profile-photo review (SAFETY-2)', () => {
  it('adds review_status and BACKFILLS pre-existing rows to approved', () => {
    const db = freshDb();
    try {
      runMigrations(db); // full schema (036 already applied)
      expect(columnExists(db, 'profile_photos', 'review_status')).toBe(true);

      // Emulate a legacy DB: rebuild profile_photos WITHOUT the review columns and
      // seed a pre-existing photo, then re-run the migrator so the guarded 036
      // fires against existing data (the exact "don't disappear on upgrade" path).
      db.exec('DROP TABLE profile_photos');
      db.exec(`CREATE TABLE profile_photos (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        url TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        is_primary INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        created_at INTEGER NOT NULL
      )`);
      db.prepare(
        'INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, created_at) VALUES (?,?,?,?,?,?,?)'
      ).run('legacy1', 'u-legacy', 'k', 'https://x/p.jpg', 0, 1, Date.now());

      expect(() => runMigrations(db)).not.toThrow();

      const row = db.prepare('SELECT review_status FROM profile_photos WHERE id = ?').get('legacy1');
      expect(row.review_status).toBe('approved'); // backfilled, still servable
    } finally {
      db.close();
    }
  });

  it('a newly inserted photo defaults to pending_review (not auto-approved)', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      // FK is ON, so create a user first.
      db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)')
        .run('u-new', 'new@t.dev', 'x', Date.now());
      db.prepare(
        'INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, created_at) VALUES (?,?,?,?,?,?,?)'
      ).run('fresh1', 'u-new', 'k', 'https://x/n.jpg', 0, 1, Date.now());
      const row = db.prepare('SELECT review_status FROM profile_photos WHERE id = ?').get('fresh1');
      expect(row.review_status).toBe('pending_review');
    } finally {
      db.close();
    }
  });
});

describe('039 seed demo comm/sensory prefs (D-1 data fix)', () => {
  const COMM_COLS = [
    'comm_directness', 'comm_cadence', 'comm_literal',
    'sensory_environment', 'sensory_lighting', 'social_duration',
  ];

  function seedProfile(db, id, email) {
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)')
      .run(id, email, 'x', Date.now());
    db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
      .run(id, `Name ${id}`, Date.now());
  }

  function commFields(db, id) {
    return db.prepare(
      `SELECT ${COMM_COLS.join(', ')} FROM profiles WHERE user_id = ?`
    ).get(id);
  }

  it('backfills every comm/sensory field on a @sample demo persona and leaves real users untouched', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      seedProfile(db, 'demo1', 'ada@sample.spectrum-dating.app');
      seedProfile(db, 'real1', 'real@example.com');

      // Pre-condition: everything empty (columns default to '').
      const before = commFields(db, 'demo1');
      for (const c of COMM_COLS) expect(before[c]).toBe('');

      // Re-run migrations so the idempotent 039 fires against the seeded demo row.
      expect(() => runMigrations(db)).not.toThrow();

      const demo = commFields(db, 'demo1');
      for (const c of COMM_COLS) expect(demo[c]).not.toBe('');
      // 'either' would be dropped by the matcher — assert concrete signalling values.
      for (const c of COMM_COLS) expect(demo[c]).not.toBe('either');

      // A real (non-demo) user's fields must stay empty.
      const real = commFields(db, 'real1');
      for (const c of COMM_COLS) expect(real[c]).toBe('');
    } finally {
      db.close();
    }
  });

  it('is idempotent — a second re-run does not change already-seeded values', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      seedProfile(db, 'demo2', 'ben@sample.spectrum-dating.app');
      runMigrations(db);
      const first = commFields(db, 'demo2');
      runMigrations(db);
      const second = commFields(db, 'demo2');
      expect(second).toEqual(first);
    } finally {
      db.close();
    }
  });
});

describe('056 demo verifications pre-approved (queue-declutter, demo-scoped)', () => {
  const DEMO_EMAIL = 'telemetry-demo-42@sample.spectrum-dating.app';
  const REAL_EMAIL = 'real-applicant@example.com';

  function seedPendingVerification(db, id, email) {
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)')
      .run(id, email, 'x', Date.now());
    db.prepare('INSERT INTO profiles (user_id, display_name, identity_verified, updated_at) VALUES (?,?,0,?)')
      .run(id, `Name ${id}`, Date.now());
    db.prepare('INSERT INTO verification_requests (id, user_id, status, requested_at) VALUES (?,?,?,?)')
      .run(`vr-${id}`, id, 'pending', Date.now());
  }

  it('approves a pending DEMO request (+ badge) while leaving a NON-demo pending request untouched', () => {
    const db = freshDb();
    try {
      runMigrations(db); // full schema (056 already ran once against an empty table = no-op)

      // A demo applicant and a real applicant, both freshly PENDING.
      seedPendingVerification(db, 'demo-u', DEMO_EMAIL);
      seedPendingVerification(db, 'real-u', REAL_EMAIL);

      // Re-run so the idempotent, demo-scoped 056 fires against the seeded rows.
      expect(() => runMigrations(db)).not.toThrow();

      // Demo request approved + reviewed + profile badge set.
      const demoReq = db.prepare('SELECT status, reviewed_at FROM verification_requests WHERE user_id = ?').get('demo-u');
      expect(demoReq.status).toBe('approved');
      expect(demoReq.reviewed_at).toBeGreaterThan(0); // epoch-ms stamped
      expect(db.prepare('SELECT identity_verified FROM profiles WHERE user_id = ?').get('demo-u').identity_verified).toBe(1);

      // SEPARABILITY: the non-demo (real) applicant is untouched — still pending,
      // still unverified, still awaiting a human moderator's decision.
      const realReq = db.prepare('SELECT status, reviewed_at FROM verification_requests WHERE user_id = ?').get('real-u');
      expect(realReq.status).toBe('pending');
      expect(realReq.reviewed_at).toBeNull();
      expect(db.prepare('SELECT identity_verified FROM profiles WHERE user_id = ?').get('real-u').identity_verified).toBe(0);
    } finally {
      db.close();
    }
  });

  it('is idempotent — a second run leaves the approved demo row and the pending real row unchanged', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      seedPendingVerification(db, 'demo-u', DEMO_EMAIL);
      seedPendingVerification(db, 'real-u', REAL_EMAIL);
      runMigrations(db);
      const firstDemo = db.prepare('SELECT status, reviewed_at FROM verification_requests WHERE user_id = ?').get('demo-u');
      runMigrations(db);
      const secondDemo = db.prepare('SELECT status, reviewed_at FROM verification_requests WHERE user_id = ?').get('demo-u');
      expect(secondDemo).toEqual(firstDemo); // no churn on the already-approved row
      // Real applicant still pending across repeated boots.
      expect(db.prepare('SELECT status FROM verification_requests WHERE user_id = ?').get('real-u').status).toBe('pending');
    } finally {
      db.close();
    }
  });
});

describe('037 drop notification_preferences (F29)', () => {
  it('drops the orphaned table and re-running stays idempotent', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      const gone = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notification_preferences'")
        .get();
      expect(gone).toBeUndefined();
      expect(() => runMigrations(db)).not.toThrow();
    } finally {
      db.close();
    }
  });
});
