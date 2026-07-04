// App-layer uptime heartbeat. On boot we stamp process_started_at and, if the
// previous last_beat_at is stale (gap > 3× the beat interval), record an
// uptime_incident for the downtime window. Every tick we repeat the gap check
// then advance last_beat_at. O(1) storage per tick.
//
// Honesty note: this measures app+DB liveness (the process is up AND can write
// SQLite), NOT edge/network reachability — the board is labelled "measured at
// the application layer" so we never present a fabricated 100%.

import { newId } from '../utils/ids.js';

const BEAT_MS = 60 * 1000;

function recordIncident(db, startedAt, endedAt, note) {
  db.prepare(
    `INSERT INTO uptime_incident (id, started_at, ended_at, duration_ms, kind, note, is_demo)
     VALUES (?, ?, ?, ?, 'gap', ?, 0)`
  ).run(newId(), startedAt, endedAt, Math.max(0, endedAt - startedAt), note);
}

export function startHeartbeat(db, intervalMs = BEAT_MS) {
  const now = Date.now();
  const existing = db.prepare('SELECT last_beat_at FROM service_heartbeat WHERE id = 1').get();

  // A stale prior heartbeat on boot ⇒ the process was down for that gap.
  if (existing && existing.last_beat_at && now - existing.last_beat_at > 3 * intervalMs) {
    recordIncident(db, existing.last_beat_at, now, 'process gap (detected on boot)');
  }

  // Upsert the single row; process_started_at is re-stamped every boot.
  db.prepare(
    `INSERT INTO service_heartbeat (id, last_beat_at, process_started_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_beat_at = excluded.last_beat_at,
                                   process_started_at = excluded.process_started_at`
  ).run(now, now);

  const timer = setInterval(() => {
    try {
      const t = Date.now();
      const row = db.prepare('SELECT last_beat_at FROM service_heartbeat WHERE id = 1').get();
      if (row && row.last_beat_at && t - row.last_beat_at > 3 * intervalMs) {
        recordIncident(db, row.last_beat_at, t, 'missed heartbeat');
      }
      db.prepare('UPDATE service_heartbeat SET last_beat_at = ? WHERE id = 1').run(t);
    } catch (err) {
      console.error('[heartbeat] tick failed —', err.message);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
