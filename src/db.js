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
];

// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so re-running a
// migration that adds a column throws "duplicate column name" on every boot
// after the first. Migrations are idempotent by design here (CREATE TABLE IF
// NOT EXISTS, etc.), so we tolerate that specific, safe-to-ignore error and
// keep going. Any other SQL error is a real problem and is re-thrown.
function runMigrations(db) {
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(__dirname, 'migrations', file), 'utf8');
    try {
      db.exec(sql);
    } catch (err) {
      if (/duplicate column name/i.test(err.message)) {
        // Column already added on a prior boot — migration already applied.
        continue;
      }
      throw err;
    }
  }
}
