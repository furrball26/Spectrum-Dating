import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'spectrum.db');

let _db;
export function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    runMigrations(_db);
  }
  return _db;
}

const MIGRATIONS = [
  '001_init.sql',
  '002_matching.sql',
  '003_messaging.sql',
  '004_reactions_photos.sql',
  '005_profile_photos.sql',
  '006_push_subscriptions.sql',
  '007_token_version.sql',
  '008_read_cursors.sql',
  '009_email_verification.sql',
  '010_moderation.sql',
  '011_profile_photos_gallery.sql',
  '012_date_of_birth.sql',
  '013_backfill_demo_dob.sql',
  '014_dealbreakers.sql',
  '015_verification.sql',
  '016_backfill_demo_verified.sql',
  '017_pause.sql',
  '018_richer_profile.sql',
  '019_profile_prompts.sql',
  '020_feedback.sql',
  '021_backfill_demo_photos.sql',
  '022_phoenix_photos.sql',
  '023_search_radius.sql',
  '024_gender_seeking.sql',
  '025_backfill_demo_gender.sql',
  '026_age_pref.sql',
  '027_moderation_log.sql',
  '028_verification_requests.sql',
  '029_photo_alt_text.sql',
  '030_reports_preserve_evidence.sql',
  '031_attachment_review.sql',
];

// Migrations that rebuild a table (CREATE new / copy / DROP old / RENAME) can't
// be made idempotent purely by the per-statement runner — re-running them would
// churn the table every boot. They are GUARDED here: a predicate decides whether
// the file should run at all, and the whole file runs inside ONE transaction so
// a rebuild can never leave the DB half-migrated. Guard = "already applied?".
const GUARDED_MIGRATIONS = {
  // E6: skip once reports.reporter_id/reported_id are already ON DELETE SET NULL.
  '030_reports_preserve_evidence.sql': (db) => {
    const fks = db.pragma('foreign_key_list(reports)');
    // If the table doesn't exist yet (fks empty AND no table), let it run and
    // fail loudly — but 010 always creates it first, so fks will be non-empty.
    if (!fks.length) return true; // no FKs found → not yet the SET NULL shape
    // Run only while any user-referencing FK is still CASCADE (i.e. not applied).
    return fks.some(
      (fk) => (fk.from === 'reporter_id' || fk.from === 'reported_id') && fk.on_delete !== 'SET NULL'
    );
  },
  // E2: skip once message_attachments already accepts 'pending_review'. The 004
  // CHECK constraint hardcodes the allowed status set in the table's DDL, so we
  // inspect the stored CREATE TABLE sql. Run the rebuild only while the DDL does
  // NOT yet mention 'pending_review' (i.e. still the old 004/030 shape).
  '031_attachment_review.sql': (db) => {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'message_attachments'")
      .get();
    if (!row || !row.sql) return false; // table missing (004 always creates it) → nothing to rebuild
    return !/pending_review/.test(row.sql);
  },
};

// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so re-running a
// migration that adds a column throws "duplicate column name" on every boot
// after the first. Migrations are idempotent by design here (CREATE TABLE IF
// NOT EXISTS, etc.), so we tolerate that specific, safe-to-ignore error.
//
// CRITICAL: we execute each file STATEMENT-BY-STATEMENT (not as one `db.exec`
// batch). If we ran the whole file as one batch, the first "duplicate column
// name" would abort the batch and silently skip every later statement in the
// same file — so a column ADDed *after* an already-applied ADD (e.g. 005's
// `public_url`) would never actually apply on a re-migrated DB, surfacing later
// as `no such column`. Per-statement exec/catch guarantees each independent
// statement is attempted regardless of earlier already-applied ones.
function runMigrations(db) {
  for (const file of MIGRATIONS) {
    const guard = GUARDED_MIGRATIONS[file];
    if (guard) {
      // Guarded (table-rebuild) migration: run only if the predicate says it
      // hasn't been applied yet, and run the WHOLE file atomically in one
      // transaction so a rebuild can never leave the DB half-migrated. Foreign
      // key enforcement is deferred to COMMIT inside a transaction, so the
      // CREATE/copy/DROP/RENAME sequence is safe.
      if (!guard(db)) continue; // already applied → skip entirely
      const sql = readFileSync(join(__dirname, 'migrations', file), 'utf8');
      const statements = splitStatements(sql);
      const apply = db.transaction(() => {
        for (const statement of statements) db.exec(statement);
      });
      apply();
      continue;
    }

    const sql = readFileSync(join(__dirname, 'migrations', file), 'utf8');
    for (const statement of splitStatements(sql)) {
      try {
        db.exec(statement);
      } catch (err) {
        if (/duplicate column name/i.test(err.message)) {
          // Column already added on a prior boot — this statement is a no-op.
          continue;
        }
        throw err;
      }
    }
  }
}

// Split a .sql file into individual statements on semicolons, while respecting
// single/double-quoted string literals and `--` line comments (so a `;` inside
// a quoted string or comment never splits a statement). Our migrations don't
// use triggers/BEGIN...END blocks, so a simple top-level split is sufficient.
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") { inSingle = true; current += ch; continue; }
    if (ch === '"') { inDouble = true; current += ch; continue; }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
