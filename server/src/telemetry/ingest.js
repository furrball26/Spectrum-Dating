// Telemetry ingest pipeline + in-process write buffer.
//
// PRIVACY (enforce exactly — audit/TELEMETRY_DASHBOARD.md §Privacy):
//   - Raw IP is used ONLY for the coarse geo lookup and the session hash, then
//     goes out of scope in the same request tick. It is NEVER stored or logged.
//   - User-agent feeds the session hash + bot drop only; never stored.
//   - DNT:1 / Sec-GPC:1 → record NOTHING.
//   - Cookieless: the unique-visitor key is a daily-rotating, non-reversible
//     HMAC — there is no cookie, no localStorage id, no member↔browsing link.
//   - Stored per row: coarse country/region, app path, referrer DOMAIN, the
//     session_hash, and a timestamp. Nothing else.

import { lookupGeo } from './geo.js';
import { computeSessionHash } from './salt.js';

// Buffer cap — beyond this we silently shed load (protects the process under a
// beacon flood; the dashboard is approximate by design).
const BUFFER_CAP = 5000;
const FLUSH_MS = 3000;

let _buffer = [];
let _flushTimer = null;

// Bot / non-browser user-agents we drop (never counted as a visit). An empty UA
// is treated as noise and dropped too.
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|pinterest|headless|phantomjs|puppeteer|playwright|python-requests|curl\/|wget|axios|node-fetch|go-http|scrapy|okhttp|libwww|httpclient/i;

export function isBotUa(ua) {
  if (!ua || typeof ua !== 'string') return true;
  return BOT_RE.test(ua);
}

// Strip a raw path to a bare pathname: query + fragment removed, leading slash
// enforced, length-capped. (Query is dropped so we never capture parameters.)
export function normalizePath(p) {
  if (!p || typeof p !== 'string') return '/';
  let path = p.trim();
  // If a full URL slipped through, keep only its pathname.
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { /* fall through */ }
  }
  const q = path.search(/[?#]/);
  if (q !== -1) path = path.slice(0, q);
  if (!path.startsWith('/')) path = `/${path}`;
  return path.slice(0, 256) || '/';
}

// Reduce a referrer URL to its hostname only (query stripped implicitly). An
// own-origin referrer (a first-party in-app navigation) is normalized to '' so
// we don't record ourselves as a traffic source.
export function referrerHostname(referrer, ownHosts = new Set()) {
  if (!referrer || typeof referrer !== 'string') return '';
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (!host) return '';
    if (ownHosts.has(host)) return '';
    return host.slice(0, 253);
  } catch {
    return '';
  }
}

// Own-origin hostnames — a referrer matching one of these is first-party → ''.
export function ownHostsFromEnv() {
  const hosts = new Set();
  const add = (u) => {
    if (!u) return;
    try { hosts.add(new URL(u).hostname.toLowerCase()); } catch { /* not a URL */ }
  };
  add(process.env.ALLOWED_ORIGIN);
  add(process.env.PUBLIC_ORIGIN);
  hosts.add('spectrum-dating-eta.vercel.app');
  hosts.add('localhost');
  return hosts;
}

// Parse the beacon body defensively — accept an already-parsed JSON object
// (application/json via the global express.json) OR a text/plain string (sent
// by sendBeacon-style keepalive beacons). Never throws.
export function parseBeaconBody(body) {
  let b = body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { b = {}; }
  }
  if (!b || typeof b !== 'object') b = {};
  return { path: b.path, referrer: b.referrer };
}

// The privacy-critical pipeline. Takes the RAW ip/ua transiently, derives coarse
// signals, discards ip/ua, and pushes ONE coarse row to the buffer. Returns the
// buffered event (for tests) or null when the request is dropped (DNT/GPC/bot).
// NEVER stores or logs ip/ua. NEVER throws to the caller.
export function ingestPageview({ db, headers = {}, ip = '', body, ownHosts }) {
  // (1) Honor Do-Not-Track / Global Privacy Control — record NOTHING.
  if (headers.dnt === '1' || headers['sec-gpc'] === '1') return null;

  const ua = headers['user-agent'] || '';
  // (bot drop) — non-browser / empty UAs are not real visits.
  if (isBotUa(ua)) return null;

  const { path, referrer } = parseBeaconBody(body);

  // (2) Coarse geo from the raw IP (offline, sync). country/region codes only.
  const geo = lookupGeo(ip);

  // (3) Referrer reduced to hostname; own-origin → ''.
  const referrer_domain = referrerHostname(referrer, ownHosts || ownHostsFromEnv());

  // (4) Non-reversible unique-visitor hash from ip+ua, THEN discard ip+ua.
  const session_hash = computeSessionHash(db, ip, ua);
  // ip and ua are not referenced again — they leave scope when this fn returns.

  const event = {
    ts: Date.now(),
    path: normalizePath(path),
    referrer_domain,
    country: geo.country,
    region: geo.region,
    session_hash,
  };

  // (5) Buffer for a batched flush; shed load past the cap.
  if (_buffer.length < BUFFER_CAP) _buffer.push(event);
  return event;
}

// Flush the buffer in ONE better-sqlite3 transaction. Returns rows written.
export function flushBuffer(db) {
  if (!_buffer.length) return 0;
  const batch = _buffer;
  _buffer = [];
  const insert = db.prepare(
    `INSERT INTO page_views (ts, path, referrer_domain, country, region, session_hash, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  );
  const writeAll = db.transaction((rows) => {
    for (const r of rows) {
      insert.run(r.ts, r.path, r.referrer_domain, r.country, r.region, r.session_hash);
    }
  });
  try {
    writeAll(batch);
  } catch (err) {
    // Never crash the flusher; drop this batch rather than wedge the buffer.
    console.error('[telemetry] flush failed —', err.message);
  }
  return batch.length;
}

export function startTelemetryFlush(db, intervalMs = FLUSH_MS) {
  if (_flushTimer) return _flushTimer;
  _flushTimer = setInterval(() => flushBuffer(db), intervalMs);
  _flushTimer.unref?.();
  return _flushTimer;
}

// Test-only: inspect / reset the buffer without waiting on the timer.
export function _bufferSize() { return _buffer.length; }
export function _resetBuffer() { _buffer = []; }
