-- Telemetry + uptime capture infrastructure (Phase 0).
--
-- PRIVACY (highest-sensitivity — see audit/TELEMETRY_DASHBOARD.md §Privacy):
-- These tables store ONLY coarse, non-identifying, cookieless signals. Raw IP
-- and user-agent are NEVER persisted — they are derived (coarse geo + a daily
-- rotating, non-reversible session_hash) and discarded in the same request tick.
-- No user_id column exists here by design: there is NO member↔browsing link.
--
-- All statements are CREATE ... IF NOT EXISTS — idempotent, no backfill, no
-- table rebuild (safe under the per-statement migration runner in src/db.js).

-- Raw page views (pruned to 30 days by the daily scheduler). One row per beacon.
--   country/region : coarse ISO codes only (never city/lat/long).
--   referrer_domain: hostname only, query stripped, own-origin normalized to ''.
--   session_hash   : HMAC(dailySalt, ip+ua) — unique-visitor key, non-reversible,
--                    cannot correlate across days (salt rotates daily + is dropped).
--   is_demo        : 1 for seeded demo rows; real dashboard queries hardcode 0.
CREATE TABLE IF NOT EXISTS page_views (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,           -- Unix epoch ms
  path            TEXT    NOT NULL DEFAULT '',
  referrer_domain TEXT    NOT NULL DEFAULT '',
  country         TEXT    NOT NULL DEFAULT '',
  region          TEXT    NOT NULL DEFAULT '',
  session_hash    TEXT    NOT NULL DEFAULT '',
  is_demo         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pv_ts ON page_views (ts);
CREATE INDEX IF NOT EXISTS idx_pv_session ON page_views (session_hash, ts);

-- Long-term daily rollup — survives the 30-day raw prune. Aggregate-only.
CREATE TABLE IF NOT EXISTS visit_daily (
  day     TEXT    NOT NULL,                   -- YYYY-MM-DD (UTC)
  is_demo INTEGER NOT NULL DEFAULT 0,
  views   INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,         -- COUNT(DISTINCT session_hash)
  PRIMARY KEY (day, is_demo)
);

-- Single-row app-layer liveness heartbeat. The uptime board reads this to show
-- current process uptime; the 60s writer updates last_beat_at each tick.
CREATE TABLE IF NOT EXISTS service_heartbeat (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  last_beat_at      INTEGER NOT NULL DEFAULT 0,
  process_started_at INTEGER NOT NULL DEFAULT 0
);

-- Detected downtime gaps (a boot with a stale last_beat_at, or a missed tick).
-- "measured at the application layer" — app+DB liveness, not edge/network.
CREATE TABLE IF NOT EXISTS uptime_incident (
  id          TEXT    PRIMARY KEY,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  kind        TEXT    NOT NULL DEFAULT 'gap',
  note        TEXT    NOT NULL DEFAULT '',
  is_demo     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incident_window ON uptime_incident (started_at, ended_at);

-- Daily-rotating HMAC salt for the session_hash. Old salts are dropped (>2 days)
-- so a session_hash is non-reversible AND cannot be correlated across days by
-- construction (the key that produced it no longer exists).
CREATE TABLE IF NOT EXISTS telemetry_salt (
  day  TEXT NOT NULL PRIMARY KEY,             -- YYYY-MM-DD (UTC)
  salt TEXT NOT NULL
);
