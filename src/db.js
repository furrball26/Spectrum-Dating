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

function runMigrations(db) {
  db.exec(readFileSync(join(__dirname, 'migrations', '001_init.sql'), 'utf8'));
  db.exec(readFileSync(join(__dirname, 'migrations', '002_matching.sql'), 'utf8'));
  db.exec(readFileSync(join(__dirname, 'migrations', '003_messaging.sql'), 'utf8'));
  db.exec(readFileSync(join(__dirname, 'migrations', '004_reactions_photos.sql'), 'utf8'));
  db.exec(readFileSync(join(__dirname, 'migrations', '005_profile_photos.sql'), 'utf8'));
  db.exec(readFileSync(join(__dirname, 'migrations', '006_push_subscriptions.sql'), 'utf8'));
}
