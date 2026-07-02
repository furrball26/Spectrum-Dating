// scheduler.js — periodic SQLite backups to a private R2 bucket.
//
// Uses better-sqlite3's online .backup() API, which produces a consistent
// snapshot even while the database is being written to (safe with WAL).
// The snapshot is uploaded to R2_BACKUP_BUCKET under backups/YYYY-MM-DD/.
//
// Degrades gracefully: if R2_BACKUP_BUCKET / R2 creds are absent, backups are
// disabled with a single log line and the server runs normally.

import { backupConfigured, putBackup } from '../storage/r2.js';
import { readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION = 14; // keep ~14 daily snapshots (informational; R2 lifecycle
                      // rules are the real retention mechanism — see RUNBOOK)

function stamp(d) {
  // YYYY-MM-DDTHH-mm — safe for object keys
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}-${p(d.getUTCMinutes())}`;
}

async function runBackup(db) {
  const tmpDir = join(__dirname, '..', '..', 'data', 'backups-tmp');
  try {
    mkdirSync(tmpDir, { recursive: true });
  } catch {}

  const now = new Date();
  const fileStamp = stamp(now);
  const tmpPath = join(tmpDir, `spectrum-${fileStamp}.db`);

  try {
    // Online backup — consistent snapshot without locking out writers.
    await db.backup(tmpPath);

    const buf = readFileSync(tmpPath);
    const day = fileStamp.slice(0, 10); // YYYY-MM-DD
    const key = `backups/${day}/spectrum-${fileStamp}.db`;

    await putBackup(key, buf, 'application/x-sqlite3');
    console.log(`[backup] uploaded ${key} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.error('[backup] FAILED:', err.message);
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

export function scheduleBackups(db) {
  if (!backupConfigured()) {
    console.log('[backup] disabled — set R2_BACKUP_BUCKET (+ R2 creds) to enable DB backups.');
    return;
  }

  // First backup shortly after boot (gives the app time to settle), then daily.
  const bootDelay = 60 * 1000; // 1 min after start
  setTimeout(() => {
    runBackup(db);
    setInterval(() => runBackup(db), DAY_MS);
  }, bootDelay);

  console.log(`[backup] enabled — first snapshot in ${bootDelay / 1000}s, then every 24h. Retention target: ${RETENTION} days (enforce via R2 lifecycle rule).`);
}
