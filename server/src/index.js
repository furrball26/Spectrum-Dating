import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { mkdirSync } from 'fs';
import { createServer } from 'http';
import { setupSocketIO } from './socket/index.js';
import { getDb } from './db.js';
import { contextMiddleware } from './middleware/context.js';
import { optionalAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import matchingRouter from './routes/matching.js';
import messagingRouter from './routes/messaging.js';
import reactionsRouter from './routes/reactions.js';
import photosRouter from './routes/photos.js';
import exportRouter from './routes/export.js';
import startersRouter from './routes/starters.js';
import pushRouter from './routes/push.js';
import accountRouter from './routes/account.js';
import adminRouter from './routes/admin.js';
import adminTelemetryRouter from './routes/adminTelemetry.js';
import adminPopulationRouter from './routes/adminPopulation.js';
import telemetryRouter from './routes/telemetry.js';
import feedbackRouter from './routes/feedback.js';
import healthRouter from './routes/health.js';
import { lastActiveMiddleware } from './middleware/lastActive.js';
import { startHeartbeat } from './telemetry/heartbeat.js';
import { startTelemetryFlush } from './telemetry/ingest.js';
import { scheduleTelemetryMaintenance } from './telemetry/scheduler.js';
import { configurePush } from './push/webpush.js';
import { r2Configured, backupConfigured } from './storage/r2.js';
import { emailConfigured } from './email/resend.js';
import { scheduleBackups } from './backup/scheduler.js';
import { scheduleWeeklyDigest } from './email/digest-scheduler.js';
import { maybeResetPassword } from './maintenance/reset-password.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Deployed build SHA — stamped into build-info.json by scripts/deploy.mjs at
// upload time (Railway doesn't inject git metadata for CLI deploys). Lets the
// deploy guard confirm the NEW build is live, not the old replica.
const BUILD_SHA = (() => {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) return process.env.RAILWAY_GIT_COMMIT_SHA;
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), 'build-info.json');
    return JSON.parse(readFileSync(p, 'utf8')).sha || null;
  } catch {
    return null;
  }
})();

// Ensure data directory exists
mkdirSync('data', { recursive: true });

const app = express();
const db = getDb();
const PORT = process.env.PORT || 3001;

// Trust Railway's reverse proxy so express-rate-limit reads the real client IP
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Security headers — HSTS, X-Content-Type-Options, frameguard, referrer policy,
// etc. CSP is disabled (this is a JSON API, not an HTML origin); CORP set to
// cross-origin so the separate frontend can call it.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' })); // cap request bodies
app.use(optionalAuth);
app.use(contextMiddleware(db));
// Lazy admin-only "last active" date stamp (one write per user per day max).
app.use(lastActiveMiddleware(db));

app.use('/auth', authRouter);
app.use('/profile', profileRouter);
app.use('/matching', matchingRouter);
app.use('/messaging', messagingRouter);
app.use('/reactions', reactionsRouter);
app.use('/photos', photosRouter);
app.use('/export', exportRouter);
app.use('/starters', startersRouter);
app.use('/push', pushRouter);
app.use('/account', accountRouter);
app.use('/admin', adminRouter);
app.use('/admin', adminTelemetryRouter);
app.use('/admin', adminPopulationRouter);
app.use('/telemetry', telemetryRouter);
app.use('/feedback', feedbackRouter);

// /health includes the deployed git SHA so the deploy script can confirm the
// NEW build is live (not the old replica still serving during rollover), plus a
// cheap application-layer DB liveness signal (SELECT 1) for the admin Site-health
// panel. Always 200 while serving; see routes/health.js.
app.use(healthRouter(db, BUILD_SHA));

// 404 for unmatched routes (JSON API).
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler — log it, never leak stack traces to clients.
// NOTE: Express identifies error handlers by their 4-arg arity, so `_next`
// must stay in the signature even though it's unused (lint ignores `_`-prefix).
app.use((err, req, res, _next) => {
  console.error('[error]', req.method, req.originalUrl, '-', err?.message, '\n', err?.stack);
  if (res.headersSent) return;
  res.status(err?.status && err.status < 600 ? err.status : 500).json({ error: 'Something went wrong.' });
});

// Last-resort process guards so an async slip never silently corrupts state.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1); // undefined state — let the platform restart cleanly
});

const httpServer = createServer(app);
const io = setupSocketIO(httpServer, db);

// Make io available to route handlers via app.locals
app.locals.io = io;
const pushConfigured = configurePush();

// E21: fail LOUD, not silent, on missing production config. Previously an unset
// ALLOWED_ORIGIN / VAPID / R2 env just produced a silent CORS fallback, a no-op
// push, or a runtime 503 with no boot-time signal — so a misconfigured deploy
// looked healthy. We warn (never crash) so the outage-shaped symptom is
// traceable to config in the logs. In production (NODE_ENV=production) a missing
// value is a real problem; in dev the localhost fallbacks are expected, so we
// only note them at info level there.
(function warnMissingProdEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const level = isProd ? 'warn' : 'log';
  const say = (msg) => console[level](msg);
  if (!process.env.ALLOWED_ORIGIN) {
    say(`[boot] ${isProd ? 'WARNING: ' : ''}ALLOWED_ORIGIN is not set — CORS is falling back to http://localhost:5173. The deployed frontend will be blocked in production.`);
  }
  if (!pushConfigured) {
    say(`[boot] ${isProd ? 'WARNING: ' : ''}Web Push is not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY unset) — push notifications will be silently skipped and /push/vapid-public-key returns 503.`);
  }
  if (!r2Configured()) {
    say(`[boot] ${isProd ? 'WARNING: ' : ''}R2 object storage is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_PUBLIC_URL unset) — photo upload presign returns 503 and uploads will fail.`);
  }
  if (!backupConfigured()) {
    say(`[boot] ${isProd ? 'WARNING: ' : ''}Database backups are not configured (R2_BACKUP_BUCKET unset) — scheduled DB backups will be skipped.`);
  }
  if (!emailConfigured()) {
    say(`[boot] ${isProd ? 'WARNING: ' : ''}Email sending is not configured — verification / reset / digest emails will be skipped.`);
  }
})();

scheduleBackups(db);
scheduleWeeklyDigest(db);
maybeResetPassword(db);

// Telemetry infra: app-layer uptime heartbeat, the ~3s batched page_views
// flush, and the daily rollup/prune/salt-rotation maintenance.
startHeartbeat(db);
startTelemetryFlush(db);
scheduleTelemetryMaintenance(db);

httpServer.listen(PORT, () => console.log(`Spectrum Dating server on :${PORT}`));

