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
