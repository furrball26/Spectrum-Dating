// Daily telemetry maintenance (reuses the scheduleBackups pattern in index.js):
//   1. Roll yesterday's raw page_views into visit_daily (views + unique
//      visitors, split by is_demo) — the long-term aggregate that survives prune.
//   2. Prune raw page_views older than 30 days (raw-retention limit).
//   3. Rotate the daily session-hash salt (fresh random today, drop >2 days).
// All three run in ONE transaction so a boot can never leave a half-rolled day.

import { utcDay, rotateSalt } from './salt.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RAW_RETENTION_DAYS = 30;

// Roll a single UTC day [start, start+DAY) of page_views into visit_daily.
export function rollupDay(db, day) {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  const end = start + DAY_MS;
  const rows = db.prepare(
    `SELECT is_demo,
            COUNT(*)                     AS views,
            COUNT(DISTINCT session_hash) AS uniques
       FROM page_views
      WHERE ts >= ? AND ts < ?
      GROUP BY is_demo`
  ).all(start, end);
  const upsert = db.prepare(
    `INSERT INTO visit_daily (day, is_demo, views, uniques)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(day, is_demo) DO UPDATE SET views = excluded.views,
                                             uniques = excluded.uniques`
  );
  for (const r of rows) upsert.run(day, r.is_demo, r.views, r.uniques);
  return rows;
}

export function runDailyMaintenance(db, now = Date.now()) {
  const yesterday = utcDay(now - DAY_MS);
  const pruneBefore = now - RAW_RETENTION_DAYS * DAY_MS;
  const txn = db.transaction(() => {
    rollupDay(db, yesterday);
    db.prepare('DELETE FROM page_views WHERE ts < ?').run(pruneBefore);
    rotateSalt(db, now);
  });
  txn();
}

export function scheduleTelemetryMaintenance(db) {
  // First pass shortly after boot (rolls yesterday + prunes + rotates), then
  // every 24h. rollupDay upserts by (day,is_demo) so re-runs are idempotent.
  const bootDelay = 90 * 1000; // 90s after start — after the app settles
  const t = setTimeout(() => {
    try { runDailyMaintenance(db); } catch (err) { console.error('[telemetry] maintenance failed —', err.message); }
    const iv = setInterval(() => {
      try { runDailyMaintenance(db); } catch (err) { console.error('[telemetry] maintenance failed —', err.message); }
    }, DAY_MS);
    iv.unref?.();
  }, bootDelay);
  t.unref?.();
  console.log('[telemetry] maintenance scheduled — first roll in 90s, then every 24h.');
}
