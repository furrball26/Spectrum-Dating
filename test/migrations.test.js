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
