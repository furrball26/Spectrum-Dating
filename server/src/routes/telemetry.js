// Public telemetry ingest — POST /telemetry/pageview.
//
// PUBLIC + fire-and-forget: no auth, never blocks the tab, never surfaces an
// error, always 204. The privacy-critical pipeline (DNT/GPC short-circuit,
// coarse geo, referrer-domain, non-reversible session_hash, raw ip/ua discard)
// lives in telemetry/ingest.js. This route just wires it up.
//
// Body: { path, referrer }. Accepts application/json (global express.json) OR
// text/plain (sendBeacon-style keepalive beacons) — parsed defensively.

import express, { Router } from 'express';
import { telemetryLimiter } from '../middleware/rateLimits.js';
import { ingestPageview, ownHostsFromEnv } from '../telemetry/ingest.js';

const router = Router();

// Capture own-origin hostnames once at module load (env is fixed per process).
const OWN_HOSTS = ownHostsFromEnv();

// text/plain beacons arrive as a raw string; JSON beacons are already parsed by
// the global express.json. This parser ONLY handles text/plain (json is a no-op
// here because its Content-Type doesn't match), so it never double-consumes.
const textBeacon = express.text({ type: 'text/plain', limit: '1mb' });

router.post('/pageview', telemetryLimiter, textBeacon, (req, res) => {
  try {
    ingestPageview({
      db: req.ctx.db,
      headers: req.headers,
      ip: req.ip,
      body: req.body,
      ownHosts: OWN_HOSTS,
    });
  } catch {
    // Swallow everything — a telemetry beacon must NEVER affect the client.
  }
  // Always 204, whether we recorded, dropped (DNT/GPC/bot), or errored.
  res.status(204).end();
});

export default router;
