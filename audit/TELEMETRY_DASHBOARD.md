# Spectrum Dating — Telemetry + Member-Management Admin Dashboard (build spec)

**Architected 2026-07-04** from a read-only pass. Customer ask: grow the moderation panel
into a full admin/ops dashboard — uptime board, visitor counts + locations, site visits,
domain-level stats (BOTH referrer traffic sources AND member email-domains), full member
listing with statuses + report counts + tap-in detail, populated for a live demo.

## Owner decisions (locked)
- **Real telemetry**, not mock (seed demo data so the live demo is populated from day one).
- **Domain stats = BOTH** referrer traffic sources (real, from visits) + member email-domain
  breakdown (real, from users).
- **Privacy: hardened design approved.** Build BRANCH-ONLY; **HOLD the live deploy of the
  visitor-tracking piece until the owner confirms the privacy policy is updated** with the
  language we provide. (Member management + uptime don't track visitors and are not gated.)
- **"Last active" = admin-only, DATE only** (not timestamp), lazily updated, shown only in the
  admin member drawer. Adds `046_last_active.sql` + a privacy-policy line. NOT public
  (public last-seen violates calm-by-design).

## Privacy posture (highest-sensitivity — enforce exactly)
NEVER store: raw IP (derive coarse geo then discard same tick), precise geo (no city/coords),
user-agent (transient, only feeds the hash), full referrer URL (domain only), any
member↔browsing link. Store: coarse country/region, app path, referrer domain, per-day
rotating `session_hash`, timestamp. Cookieless. Honor `DNT:1` / `Sec-GPC:1` (record nothing).
30-day raw retention → aggregate-only after. Admin-only endpoints. Non-reversible session
hash = `HMAC(dailySalt, ip+ua)` with daily salt rotation (old salt discarded → no
cross-day tracking possible by construction). **Owner must publish a privacy-policy
disclosure before Phase-0 visitor capture goes live** (first-party, cookieless, no third
party, IP never stored, coarse country only, 30-day retention, DNT/GPC honored,
"we do not track individuals").

## Data model — `045_telemetry.sql` (CREATE TABLE IF NOT EXISTS, idempotent, no backfill)
- `page_views(id, ts, path, referrer_domain, country, region, session_hash, is_demo)` +
  `idx_pv_ts`, `idx_pv_session(session_hash, ts)`. Raw, pruned to 30d.
- `visit_daily(day, is_demo, views, uniques)` PK `(day, is_demo)` — long-term rollup.
- `service_heartbeat(id CHECK id=1, last_beat_at, process_started_at)` — one row.
- `uptime_incident(id, started_at, ended_at, duration_ms, kind, note, is_demo)` +
  `idx_incident_window`.
- `telemetry_salt(day, salt)` — rotating daily salt; keep ~2 days.
- Member coarse city = reuse `profiles.dist_city` (no new column).
- `046_last_active.sql`: `ALTER TABLE users ADD COLUMN last_active_at TEXT NOT NULL DEFAULT ''`
  (YYYY-MM-DD, admin-only, lazily updated only when the day changes on an authed request).

## Ingest (`POST /telemetry/pageview`, public, `optionalAuth` global)
Body `{path, referrer}`. Per request: (1) if `DNT:1`/`Sec-GPC:1` → record nothing; (2)
`geoip.lookup(req.ip)` (offline, `trust proxy=1` gives real IP at `index.js:54`) → country/region;
(3) `referrer_domain = new URL(referrer).hostname` (own-origin → ''); (4) `session_hash =
HMAC(todaySalt, ip+ua)`, then DISCARD ip+ua; (5) push to in-process buffer, flush every ~3s in
ONE better-sqlite3 transaction (buffer cap to shed load). Guards: `express-rate-limit` per IP
(reuse `middleware/rateLimits.js`), drop bot UAs, 1mb body cap (global). Beacon note: use
`fetch(url,{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body})`
(NOT bare `sendBeacon` — text/plain won't parse) or accept text/plain + JSON.parse.
Fire-and-forget from the tab→URL effect (`App.jsx:763`); never block nav, never surface errors.

## Geo — `geoip-lite` (offline, bundled MaxMind country/region DB, zero egress, sync lookup).
Store country + region ONLY. ~40MB deploy size — acceptable.

## Uptime writer (in `index.js` after boot + `setInterval` 60s)
On boot: upsert `service_heartbeat`, set `process_started_at=now`; if `now - last_beat_at >
3×interval`, insert an `uptime_incident` for the gap. Every 60s: same gap check, then
`UPDATE last_beat_at=now`. O(1) storage. Board label: "measured at the application layer"
(heartbeat = app+DB liveness, not edge/network — never present as fabricated 100%).

## Scheduler (reuse `scheduleBackups` pattern, `index.js:141`), daily txn
Roll yesterday's `page_views` → `visit_daily` (views, uniques=COUNT(DISTINCT session_hash),
split by is_demo); `DELETE page_views WHERE ts < now-30d`; rotate `telemetry_salt` (new random
salt, drop >2d old). Lazy `last_active_at`: on an authed request, if stored date != today, set
today (one cheap write/day/user).

## Admin endpoints (all requireAuth+requireAdmin; real queries hardcode `is_demo=0` / test-demo
exclusion; `?demo=1` admin-gated flips telemetry to include is_demo=1 for the live demo)
- `GET /admin/telemetry/overview?window=24h|7d|30d&demo=` → visits series, total views, unique
  visitors (distinct session_hash), top paths.
- `GET /admin/telemetry/geo?window=&demo=` → GROUP BY country(+region) ranked.
- `GET /admin/telemetry/referrers?window=&demo=` → GROUP BY referrer_domain ranked.
- `GET /admin/telemetry/uptime?demo=` → {processStartedAt, currentUptimeMs, windows:{24h,7d,30d
  pct}, incidents}. pct = (windowMs − Σ overlap(incident,window))/windowMs.
- `GET /admin/telemetry/member-domains` → member email-domain breakdown (reuse test/demo
  exclusion `admin.js:373`): `substr(email, instr(email,'@')+1) GROUP BY … ORDER BY count`.
- `GET /admin/members?query=&status=active|suspended|verified&page=&pageSize=&sort=joined|reports&includeTest=&includeDemo=`
  → paginated {id,email,displayName,distCity,createdAt,suspended,verified,reportCount,
  actionedCount,blockedByCount,lastActiveAt} + total. Reuse correlated-count SQL `admin.js:75-77`,
  exclusion `admin.js:25-26`, LIMIT/OFFSET.
- `GET /admin/members/:id` → detail: `userContext()` (`admin.js:788`) + reports-against list +
  reportsAgainst/reportsActioned/distinctBlockers (`/users/:id/history` body) + verified,
  suspended, accountAge, lastActiveAt.

## Frontend (reuse tokens + StatCard + useAdminList + "Updated HH:MM" freshness; NO live ticker)
- `<Sparkline points>` inline-SVG area/line (static, reduced-motion-safe) — visits-over-time.
- `<RankedBars rows={{label,count}}>` horizontal bars (single `t.accentFill`) — geo, referrers,
  member email-domains.
- **Overview tab:** uptime board (windows + incident list, "application layer" label) + visits
  sparkline + unique-visitor stat + geo/referrer/domain ranked bars.
- **Members tab:** searchable/filterable table (status filter, sort by joined/reports) + a
  detail drawer/modal (status, report history, block count, verification, account age,
  last active date). Reuse the existing report-count + history serialization.
- Beacon: fire from `App.jsx:763` tab→URL effect. No chart lib. No cookies.

## Seed / demo (`server/scripts/seed-telemetry.mjs`, NOT a migration)
Insert page_views/visit_daily/uptime_incident with `is_demo=1` spread over 30d (realistic geo/
referrer/uptime-gap). Demo members on the existing `@sample.spectrum-dating.app` domain (already
excluded from real counts + purgeable). `--wipe` flag deletes is_demo=1 + purges demo members.
Real dashboard queries hardcode `is_demo=0`; furnished demo view = explicit `?demo=1`. Add a
smoke assertion that the default (non-demo) overview ignores is_demo=1 rows.

## Migrations (Railway): `045_telemetry.sql`, `046_last_active.sql` (both idempotent, no rebuild).

## Build order (serialized builders; backend branch-only + coordinator review; visitor-capture
DEPLOY gated on owner's privacy-policy confirmation)
0. Backend capture + infra (045/046, geoip-lite, ingest endpoint, heartbeat, scheduler, lazy
   last_active) — branch-only.
1. Backend admin endpoints (telemetry aggregations + member listing/detail) — branch-only.
2. Frontend (beacon + Overview + Members tabs + Sparkline/RankedBars).
3. Seed + `?demo=1` demo mode + smoke assertion.
(0+1 may be one backend builder. Deploy sequence: review → provide privacy-policy language →
owner confirms policy live → Railway deploy → Vercel frontend → seed → owner visual check.)

## Biggest risks
1. **Privacy** (highest) — non-reversible session hash, never log raw IP, coarse geo, DNT/GPC,
   policy live BEFORE capture ships. 2. **Demo-vs-real-count pollution** — is_demo on all
   telemetry + demo members on @sample + real queries hardcode is_demo=0 + smoke assertion.
   3. **Beacon abuse/perf** — batched-txn flush, per-IP rate-limit, bot-UA drop, buffer cap;
   dashboard reads on indexed GROUP BY/rollups, cache ~30-60s. 4. **Uptime honesty** — app-layer
   label. 5. geoip-lite deploy size (~40MB, fine).
