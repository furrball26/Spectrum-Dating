// Public liveness probe — GET /health.
//
// Always returns 200 with { status, sha, db } whenever the process is serving.
// The deploy guard reads `sha` to confirm the NEW build is live (not the old
// replica still serving during rollover); `status` stays 'ok' for backward
// compatibility. `db` is an application-layer liveness signal from a trivial
// `SELECT 1` — 'up' when the query succeeds, 'down' when it throws. A degraded
// database does NOT flip the HTTP status (the server itself is still reachable);
// callers surface the DB signal calmly, never as a blaring outage.
import { Router } from 'express';

export default function healthRouter(db, sha = null) {
  const router = Router();
  router.get('/health', (_req, res) => {
    let dbUp;
    try {
      db.prepare('SELECT 1').get();
      dbUp = true;
    } catch {
      dbUp = false;
    }
    res.json({ status: 'ok', sha, db: dbUp ? 'up' : 'down' });
  });
  return router;
}
